/**
 * @aah/ipc — transport-agnostic TS<->Python IPC bridge.
 *
 * The seam that makes hard rule #4 real: the two runtimes communicate ONLY by
 * relaying bus events across a framed {@link Channel}, never by a direct call. This
 * first slice is fully headless — an in-memory channel pair models the boundary, and
 * a real stdio/socket transport plugs in later behind the same `Channel` interface.
 */

export { type Frame, type LifecyclePhase, encodeFrame, decodeFrame } from './frame.js';
export type { Channel } from './channel.js';
export { createChannelPair } from './in-memory-channel.js';
export { BusBridge, type BusBridgeOptions } from './bus-bridge.js';
export { ProcessServiceProxy } from './process-service-proxy.js';
export { StdioChannel, type StdioChannelOptions } from './stdio-channel.js';
export {
  spawnServiceChannel,
  type SpawnServiceOptions,
  type SpawnedServiceChannel,
} from './spawn.js';
