/**
 * Cross-process integration proof for the IPC seam.
 *
 * Spawns the REAL `aah_ipc.demo` Python child via `uv`, installs it through
 * {@link installRemoteService} / {@link createHub}, and asserts the proxy reaches
 * `healthy` — proving the full path: kernel enable -> lifecycle frame over stdin ->
 * Python ServiceHost -> health frame over stdout -> ProcessServiceProxy.
 *
 * This is the ONLY test that spawns a real child. It self-skips when `uv` is absent
 * (e.g. CI's Node-only TS job), so it never breaks a uv-less environment.
 */

import { existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHub, type Hub } from './bootstrap.js';
import type { RemoteServiceSpec } from './remote-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/** Resolve a `uv` executable from PATH, or the WinGet install location on Windows. */
function resolveUv(): string | undefined {
  const exe = process.platform === 'win32' ? 'uv.exe' : 'uv';

  // 1. PATH lookup.
  const pathDirs = (process.env.PATH ?? '').split(delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }

  // 2. WinGet location: %LOCALAPPDATA%/Microsoft/WinGet/Packages/astral-sh.uv_*/uv.exe
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const packagesDir = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (existsSync(packagesDir)) {
      const match = readdirSync(packagesDir).find((name) => name.startsWith('astral-sh.uv_'));
      if (match) {
        const candidate = join(packagesDir, match, 'uv.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  return undefined;
}

const uv = resolveUv();

async function pollUntil(
  predicate: () => boolean,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
}

describe('installRemoteService — real cross-process stdio transport', () => {
  it.skipIf(!uv)(
    'drives the Python ipc-demo child to healthy over the real seam',
    async () => {
      const spec: RemoteServiceSpec = {
        meta: { id: 'ipc-demo', name: 'IPC Demo', version: '0.1.0' },
        requires: [],
        command: uv as string,
        args: ['run', 'python', '-m', 'aah_ipc.demo'],
        cwd: repoRoot,
      };

      let hub: Hub | undefined;
      try {
        hub = await createHub({ remoteServices: [spec] });
        const remote = hub.remotes[0];
        expect(remote).toBeDefined();

        const reached = await pollUntil(
          () => remote.proxy.healthCheck().state === 'healthy',
          { timeoutMs: 10_000, intervalMs: 100 },
        );

        expect(reached).toBe(true);
        expect(remote.proxy.healthCheck().state).toBe('healthy');
      } finally {
        await hub?.stop();
      }
    },
    20_000,
  );
});
