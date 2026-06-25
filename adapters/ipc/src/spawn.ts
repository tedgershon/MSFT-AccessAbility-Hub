/**
 * spawnServiceChannel — host-side helper that launches a child process and wraps its
 * stdio in a {@link StdioChannel}.
 *
 * This is how the TS host will later start an out-of-process service (e.g.
 * `uv run python -m <service>`): the child speaks the NDJSON frame protocol on its
 * stdin/stdout, and the returned {@link StdioChannel} plugs straight into a
 * {@link ProcessServiceProxy} / {@link BusBridge} like any other channel.
 *
 * The child is spawned with `stdio: ['pipe','pipe','pipe']`. The channel reads frames
 * from the child's stdout and writes frames to its stdin; stderr is text-decoded and
 * forwarded to `onStderr` (default: log) so it is never silently lost. This module
 * does NOT know or care what command it runs — the caller supplies it.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { StdioChannel } from './stdio-channel.js';

export interface SpawnServiceOptions {
  /** Working directory for the child. */
  cwd?: string;
  /** Environment for the child (defaults to the parent's). */
  env?: NodeJS.ProcessEnv;
  /** Receives decoded stderr text from the child. Default: `console.error`. */
  onStderr?: (chunk: string) => void;
  /** Called when the child exits, with its exit code (or `null` if signalled). */
  onExit?: (code: number | null) => void;
}

export interface SpawnedServiceChannel {
  /** Framed channel over the child's stdout (in) and stdin (out). */
  channel: StdioChannel;
  /** The underlying child process handle. */
  child: ChildProcess;
  /** Close the channel and terminate the child. */
  kill(): void;
}

export function spawnServiceChannel(
  command: string,
  args: string[],
  opts: SpawnServiceOptions = {},
): SpawnedServiceChannel {
  const onStderr =
    opts.onStderr ?? ((chunk: string) => console.error('[spawnServiceChannel] stderr:', chunk));

  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (!child.stdout || !child.stdin) {
    throw new Error('spawnServiceChannel: child was spawned without piped stdio');
  }

  const channel = new StdioChannel(child.stdout, child.stdin);

  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => onStderr(chunk));
  }

  if (opts.onExit) {
    child.on('exit', (code) => opts.onExit?.(code));
  }

  return {
    channel,
    child,
    kill(): void {
      channel.close();
      if (!child.killed) child.kill();
    },
  };
}
