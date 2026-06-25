/**
 * Host-side installation of an out-of-process (e.g. Python) service.
 *
 * The kernel treats a remote service exactly like an in-process one: it sees a
 * {@link ProcessServiceProxy} that satisfies the `AccessibilityService` contract.
 * This module is the glue that (1) spawns the child over a real stdio
 * {@link StdioChannel}, (2) mounts a {@link BusBridge} so a whitelist of bus topics
 * crosses the seam in both directions, and (3) installs the proxy into the kernel.
 *
 * Hard rule #4 stays intact: the host never calls the child directly — every
 * interaction is a framed message over the channel.
 */

import {
  BusBridge,
  ProcessServiceProxy,
  spawnServiceChannel,
} from '@aah/ipc';
import type { Capability, EventTopic, ServiceMeta } from '@aah/contracts';
import type { Kernel } from '@aah/kernel';

/**
 * Everything the host needs to launch and register a remote service. `meta` and
 * `requires` are known host-side so the arbiter needs no round-trip to the child.
 */
export interface RemoteServiceSpec {
  /** Identity the kernel registers the proxy under. */
  meta: ServiceMeta;
  /** Capability manifest — drives arbiter conflict detection without a round-trip. */
  requires: Capability[];
  /** Executable to launch (e.g. `uv`). */
  command: string;
  /** Arguments (e.g. `['run','python','-m','<pkg>']`). */
  args: string[];
  /** Working directory for the child (defaults to the host's cwd). */
  cwd?: string;
  /** Bus topics relayed local-bus -> child. Inbound `event` frames are always re-emitted. */
  forward?: readonly EventTopic[];
}

/** A live remote service: the kernel-facing proxy, its bridge, and a teardown. */
export interface RemoteServiceHandle {
  proxy: ProcessServiceProxy;
  bridge: BusBridge;
  /** Dispose the bridge and terminate the child process. */
  kill(): void;
}

/**
 * Spawn, bridge, and install a remote service into `kernel`.
 *
 * The proxy is installed (loaded) but not enabled here — enabling is the hub's
 * arbiter-gated decision, identical to an in-process service.
 */
export async function installRemoteService(
  kernel: Kernel,
  spec: RemoteServiceSpec,
): Promise<RemoteServiceHandle> {
  const { channel, kill } = spawnServiceChannel(spec.command, spec.args, {
    cwd: spec.cwd,
    onStderr: (chunk) => console.error(`[${spec.meta.id}] ${chunk}`),
  });

  const bridge = new BusBridge(kernel.bus, channel, { forward: spec.forward ?? [] });
  bridge.mount();

  const proxy = new ProcessServiceProxy(spec.meta, spec.requires, channel);
  await kernel.install(proxy);

  return {
    proxy,
    bridge,
    kill: () => {
      bridge.dispose();
      kill();
    },
  };
}
