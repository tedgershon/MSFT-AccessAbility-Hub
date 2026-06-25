/**
 * Hub bootstrap (host-process side, transport-agnostic).
 *
 * Wires the kernel + coordinator and installs the in-shell TS services. Out-of-
 * process (Python / MCP) services are attached later via their adapters; from the
 * kernel's point of view they are just more `AccessibilityService` implementations
 * behind an IPC bridge.
 *
 * Kept separate from `main.ts` (Electron entry) so it can be exercised headless.
 */

import { Kernel } from '@aah/kernel';
import { ModeCoordinator } from '@aah/coordinator';
import { ColorblindContrastService } from '@aah/colorblind-contrast';
import { CreativeStudioService } from '@aah/creative-studio';
import type { Resource } from '@aah/contracts';
import { OverlaySurface } from './overlay-surface.js';
import {
  installRemoteService,
  type RemoteServiceHandle,
  type RemoteServiceSpec,
} from './remote-service.js';

/**
 * Resources a service actively *drives* (a single owner at a time). A denied lease
 * on one of these is a control conflict worth a mode-switch; sharing conflicts on
 * passive resources (e.g. `displayOverlay`) are not the coordinator's concern.
 */
const CONTROL_CHANNELS = new Set<Resource>(['cursor', 'keyboard', 'audioIn', 'commandChannel']);

export interface Hub {
  kernel: Kernel;
  coordinator: ModeCoordinator;
  overlay: OverlaySurface;
  /** Handles for every out-of-process service installed at boot. */
  remotes: RemoteServiceHandle[];
  /** Tear down: kill remote children, then shut the kernel down. */
  stop(): Promise<void>;
}

export interface CreateHubOptions {
  /**
   * Out-of-process (Python / MCP) services to spawn + install at boot. Defaults to
   * `[]` so the hub boots with NO external processes (no `uv` required for the MVP).
   *
   * EXAMPLE — a teammate adds a Python tile by appending a spec like this:
   *
   * ```ts
   * await createHub({
   *   remoteServices: [
   *     {
   *       meta: { id: 'live-captions', name: 'Live Captions', version: '0.1.0' },
   *       requires: [{ resource: 'audioIn', mode: 'exclusive' }],
   *       command: 'uv',
   *       args: ['run', 'python', '-m', 'live_captions'],
   *       cwd: process.cwd(),
   *       forward: ['overlay/attach', 'overlay/detach'],
   *     },
   *   ],
   * });
   * ```
   */
  remoteServices?: RemoteServiceSpec[];
  /**
   * Enable every registered service after `kernel.start()` so the hub boots with
   * services ACTIVE. Default `true`.
   */
  autoEnable?: boolean;
}

export async function createHub(opts: CreateHubOptions = {}): Promise<Hub> {
  const { remoteServices = [], autoEnable = true } = opts;

  const kernel = new Kernel();
  const coordinator = new ModeCoordinator(kernel.bus);

  // Host-side consumer of the shared overlay render channel. Tiles emit
  // `overlay/*` events; this surface keeps the active layers a renderer will paint.
  const overlay = new OverlaySurface();
  overlay.mount(kernel.bus);

  // When the arbiter denies an exclusive control resource, escalate to the
  // coordinator so the shell can offer a mode-switch instead of just failing.
  kernel.bus.on('arbiter/lease-denied', ({ serviceId, conflictsWith, resources }) => {
    // Only a contested *control* channel warrants a mode-switch.
    if (!resources.some((r) => CONTROL_CHANNELS.has(r))) return;
    coordinator.arbitrate('input', [serviceId, ...conflictsWith]);
  });

  // In-shell TS services register here. New services slot in without kernel edits.
  await kernel.install(new ColorblindContrastService());
  await kernel.install(new CreativeStudioService());

  // ClawPilot is INTENTIONALLY not installed here — the hub stays independent of
  // the external agent. To opt in, a host would install the service and set config
  // keys it reads in onLoad (left OFF by default):
  //
  //   const claw = new ClawPilotService();
  //   await kernel.install(claw);
  //   // spawn a locally-installed agent over stdio MCP...
  //   ctx.config.set('clawpilot.command', 'clawpilot');   // or
  //   ctx.config.set('clawpilot.endpoint', 'http://localhost:9000/mcp');
  //   ctx.config.set('clawpilot.toolName', 'computer_use'); // optional
  //
  // If the agent is absent the service simply degrades; it never blocks boot.

  // Out-of-process services attach over the IPC bridge; from the kernel's point of
  // view each is just another `AccessibilityService` behind a proxy.
  const remotes: RemoteServiceHandle[] = [];
  for (const spec of remoteServices) {
    remotes.push(await installRemoteService(kernel, spec));
  }

  kernel.start();

  // Boot services ACTIVE so the hub is live the moment it starts.
  if (autoEnable) {
    for (const id of kernel.registry.ids()) {
      await kernel.enable(id);
    }
  }

  const stop = async (): Promise<void> => {
    for (const remote of remotes) remote.kill();
    await kernel.shutdown();
  };

  return { kernel, coordinator, overlay, remotes, stop };
}
