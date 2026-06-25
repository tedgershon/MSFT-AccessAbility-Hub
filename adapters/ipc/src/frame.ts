/**
 * Frame envelope — the on-the-wire message contract for the IPC seam.
 *
 * Everything that crosses the TS<->Python boundary is one of these frames. The
 * envelope is a discriminated union on `kind` so a transport can route without
 * knowing payload shapes:
 *
 * - `event`     — a bus event relayed across the seam (`topic` + opaque `payload`).
 * - `lifecycle` — a host -> child lifecycle command (`load|enable|disable|unload`).
 * - `health`    — a child -> host health report.
 *
 * Channels move Frame OBJECTS. `encodeFrame`/`decodeFrame` exist so a real
 * line-delimited transport (stdio, sockets) can serialize them later; they are not
 * used by the in-memory channel pair.
 */

import type { EventTopic, HealthStatus } from '@aah/contracts';

/** Host -> child lifecycle command phases (mirror of the contract lifecycle). */
export type LifecyclePhase = 'load' | 'enable' | 'disable' | 'unload';

export type Frame =
  | { kind: 'event'; topic: EventTopic; payload: unknown }
  | { kind: 'lifecycle'; phase: LifecyclePhase }
  | { kind: 'health'; status: HealthStatus };

/** Serialize a frame to a single newline-free JSON line for a real transport. */
export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

/** Parse a single JSON line back into a {@link Frame}. */
export function decodeFrame(line: string): Frame {
  return JSON.parse(line) as Frame;
}
