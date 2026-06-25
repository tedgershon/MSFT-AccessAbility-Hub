/**
 * Headless host entry (MVP).
 *
 * Boots the hub, reports the running services + their health, and stays alive until
 * a termination signal. This is plain Node for the MVP — there is no Electron window
 * or renderer yet. Run with `node apps/shell/dist/main.js` (after `tsc -b`).
 *
 * TODO (Electron renderer): replace this headless boot with the Electron main
 * process — create a BrowserWindow, paint `hub.overlay` (OverlaySurface) layers, and
 * bridge IPC to `hub.kernel` (enable/disable) and `hub.coordinator` (switchTo) for a
 * toggle/status/mode-switch UI. No renderer DOM is implemented yet.
 */

import { createHub } from './bootstrap.js';

async function main(): Promise<void> {
  // No remote services by default: the hub boots with only in-process TS tiles and
  // requires no external runtime. Teammates add Python tiles via `remoteServices`
  // (see the example in bootstrap.ts).
  const hub = await createHub();

  console.log('[shell] AccessAbility Hub started. Running services:');
  for (const record of hub.kernel.registry.list()) {
    const health = record.service.healthCheck();
    console.log(
      `  - ${record.service.meta.id} (${record.phase}): ${health.state}` +
        (health.detail ? ` — ${health.detail}` : ''),
    );
  }

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[shell] ${signal} received — stopping hub...`);
    hub
      .stop()
      .then(() => {
        console.log('[shell] hub stopped.');
        process.exit(0);
      })
      .catch((err: unknown) => {
        console.error('[shell] error during shutdown:', err);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep the process alive so services stay running until a signal arrives.
  console.log('[shell] running. Press Ctrl+C to stop.');
}

void main();
