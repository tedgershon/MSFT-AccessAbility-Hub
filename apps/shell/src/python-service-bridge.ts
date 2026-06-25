import type { BridgeMessage, BridgeTransport } from '@aah/kernel';

/**
 * The narrow slice of a Node child process the NDJSON transport needs. Typed
 * structurally (not against `child_process`) so the framing logic stays unit-
 * testable with a fake and the file needs no Node type dependency.
 */
export interface ChildProcessLike {
  readonly stdin: { write(chunk: string): void } | null;
  readonly stdout: {
    on(event: 'data', listener: (chunk: string | Uint8Array) => void): void;
  } | null;
  kill(): void;
}

/**
 * Bridges a {@link BridgeTransport} onto a Python child process's stdio using
 * newline-delimited JSON. Partial reads are buffered until a full line arrives;
 * malformed frames are dropped rather than crashing the host.
 */
export class NdjsonChildProcessTransport implements BridgeTransport {
  readonly #child: ChildProcessLike;
  readonly #decoder = new TextDecoder();
  #handler: ((message: BridgeMessage) => void) | undefined;
  #buffer = '';

  constructor(child: ChildProcessLike) {
    this.#child = child;
    this.#child.stdout?.on('data', (chunk) => this.#onData(chunk));
  }

  send(message: BridgeMessage): void {
    this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#child.kill();
  }

  #onData(chunk: string | Uint8Array): void {
    this.#buffer += typeof chunk === 'string' ? chunk : this.#decoder.decode(chunk);
    let newlineIndex = this.#buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line) this.#dispatch(line);
      newlineIndex = this.#buffer.indexOf('\n');
    }
  }

  #dispatch(line: string): void {
    let message: BridgeMessage;
    try {
      message = JSON.parse(line) as BridgeMessage;
    } catch {
      return; // Drop a malformed frame; a partial/garbled line must not crash the host.
    }
    this.#handler?.(message);
  }
}
