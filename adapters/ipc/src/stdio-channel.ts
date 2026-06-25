/**
 * StdioChannel — a real {@link Channel} over newline-delimited JSON on byte streams.
 *
 * This is the first concrete transport behind the abstract `Channel` interface: it
 * carries {@link Frame} objects across an OS process boundary by serializing each one
 * (via {@link encodeFrame}) as a single line on the writable `output` and parsing each
 * complete line read from the readable `input` (via {@link decodeFrame}).
 *
 * ## Framing
 * The wire format is NDJSON: one JSON frame per line, `\n`-terminated. Reads are
 * byte-oriented and arbitrarily chunked by the OS, so this channel buffers partial
 * input and only dispatches once a full line (terminator seen) is available:
 * - multiple frames in a single chunk are all dispatched, in order;
 * - a frame split across chunks is held until its terminating `\n` arrives;
 * - a trailing partial line stays buffered until completed (or dropped on close).
 * Empty lines are ignored. A decode error on one line is routed to `onError` and does
 * NOT tear down the stream — subsequent valid frames still arrive.
 *
 * The channel does not own the streams it is handed; `close()` only detaches its own
 * listeners and stops dispatching, leaving externally-owned streams intact.
 */

import type { Channel } from './channel.js';
import { decodeFrame, encodeFrame, type Frame } from './frame.js';

type FrameHandler = (frame: Frame) => void;

export interface StdioChannelOptions {
  /** Called when a line fails to decode. Default: log to `console.error`. */
  onError?: (error: unknown, line: string) => void;
}

export class StdioChannel implements Channel {
  readonly #input: NodeJS.ReadableStream;
  readonly #output: NodeJS.WritableStream;
  readonly #handlers = new Set<FrameHandler>();
  readonly #onError: (error: unknown, line: string) => void;
  /** Bytes read but not yet terminated by a newline. */
  #buffer = '';
  #closed = false;
  readonly #onData: (chunk: Buffer | string) => void;

  constructor(
    input: NodeJS.ReadableStream,
    output: NodeJS.WritableStream,
    opts: StdioChannelOptions = {},
  ) {
    this.#input = input;
    this.#output = output;
    this.#onError =
      opts.onError ??
      ((error, line) => {
        // Keep a bad line from killing the stream; surface it without throwing.
        console.error('[StdioChannel] failed to decode frame', { line, error });
      });

    this.#input.setEncoding('utf8');
    this.#onData = (chunk) => this.#ingest(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    this.#input.on('data', this.#onData);
  }

  send(frame: Frame): void {
    if (this.#closed) return;
    this.#output.write(encodeFrame(frame) + '\n');
  }

  onMessage(handler: FrameHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#input.removeListener('data', this.#onData);
    this.#handlers.clear();
    this.#buffer = '';
  }

  /** Buffer a chunk and dispatch every complete `\n`-terminated line within it. */
  #ingest(chunk: string): void {
    if (this.#closed) return;
    this.#buffer += chunk;

    let newlineIndex = this.#buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      this.#dispatchLine(line);
      if (this.#closed) return; // a handler may have closed us
      newlineIndex = this.#buffer.indexOf('\n');
    }
  }

  #dispatchLine(rawLine: string): void {
    // Tolerate CRLF transports by stripping a trailing '\r'.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) return; // ignore blank lines

    let frame: Frame;
    try {
      frame = decodeFrame(line);
    } catch (error) {
      this.#onError(error, line);
      return;
    }

    // Copy so a handler that (un)subscribes during delivery can't mutate mid-loop.
    for (const handler of [...this.#handlers]) handler(frame);
  }
}
