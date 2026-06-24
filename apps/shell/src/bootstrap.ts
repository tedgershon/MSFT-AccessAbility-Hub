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
import { OverlaySurface } from './overlay-surface.js';

export interface Hub {
  kernel: Kernel;
  coordinator: ModeCoordinator;
  overlay: OverlaySurface;
}

export async function createHub(): Promise<Hub> {
  const kernel = new Kernel();
  const coordinator = new ModeCoordinator(kernel.bus);

  // Host-side consumer of the shared overlay render channel. Tiles emit
  // `overlay/*` events; this surface keeps the active layers a renderer will paint.
  const overlay = new OverlaySurface();
  overlay.mount(kernel.bus);

  // When the arbiter denies an exclusive control resource, escalate to the
  // coordinator so the shell can offer a mode-switch instead of just failing.
  kernel.bus.on('arbiter/lease-denied', ({ serviceId, conflictsWith }) => {
    // TODO: only escalate for *control* channels (cursor/keyboard/audioIn/...).
    coordinator.arbitrate('input', [serviceId, ...conflictsWith]);
  });

  // In-shell TS services register here. New services slot in without kernel edits.
  await kernel.install(new ColorblindContrastService());

  kernel.start();
  return { kernel, coordinator, overlay };
}
