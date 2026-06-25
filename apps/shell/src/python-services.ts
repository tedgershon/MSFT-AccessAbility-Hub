import { spawn } from 'node:child_process';
import type { EventBus, EventTopic } from '@aah/contracts';
import { IpcEventBridge } from '@aah/kernel';
import { NdjsonChildProcessTransport } from './python-service-bridge.js';

/** One out-of-process Python service and the topics the kernel routes to/from it. */
interface PythonServiceRoute {
  /** Python module run via `python -m <module>`. */
  readonly module: string;
  /** Topics the kernel forwards INTO the process (kernel → Python). */
  readonly toProcess: readonly EventTopic[];
  /** Topics the kernel accepts FROM the process (Python → kernel). */
  readonly fromProcess: readonly EventTopic[];
}

/**
 * Static routing table for the multimodal pipeline. Eye tracking produces camera
 * frame refs; gaze correlation consumes camera + display frame refs and produces
 * correlated gaze points. The kernel bus is the hub that ties the processes
 * together — they never talk to each other directly.
 */
const ROUTES: readonly PythonServiceRoute[] = [
  {
    module: 'eye_tracking',
    toProcess: [],
    fromProcess: ['camera/frame-ref', 'camera/gaze', 'calibration/state'],
  },
  {
    module: 'gaze_correlation',
    toProcess: ['camera/frame-ref', 'camera/gaze', 'display/frame-ref'],
    fromProcess: ['gaze/point', 'calibration/state'],
  },
  {
    module: 'gaze_dwell',
    toProcess: ['gaze/point', 'calibration/state'],
    fromProcess: ['input/intent', 'input/context'],
  },
];

export interface PythonServicesHandle {
  stop(): void;
}

export interface StartPythonServicesOptions {
  /** Interpreter to run; defaults to `$AAH_PYTHON` or `python`. */
  readonly pythonPath?: string;
  /** Working directory for the spawned processes (repo root in dev). */
  readonly cwd?: string;
}

/**
 * Spawn each Python service as a child process and bridge its stdio onto the
 * kernel bus. Failures to spawn are logged but never crash the shell — the rest of
 * the hub keeps running without the out-of-process services.
 */
export function startPythonServices(
  bus: EventBus,
  options: StartPythonServicesOptions = {},
): PythonServicesHandle {
  const python = options.pythonPath ?? process.env.AAH_PYTHON ?? 'python';
  const bridges: IpcEventBridge[] = [];

  for (const route of ROUTES) {
    try {
      const child = spawn(python, ['-m', route.module], {
        cwd: options.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      child.stdout?.setEncoding('utf-8');
      child.on('error', (err) => {
        console.error(`[python:${route.module}] failed to start`, err);
      });

      const transport = new NdjsonChildProcessTransport({
        stdin: child.stdin,
        stdout: child.stdout,
        kill: () => {
          child.kill();
        },
      });
      const bridge = new IpcEventBridge(bus, transport, {
        toTransport: route.toProcess,
        fromTransport: route.fromProcess,
      });
      bridge.start();
      bridges.push(bridge);
    } catch (err) {
      console.error(`[python:${route.module}] could not be spawned`, err);
    }
  }

  return {
    stop(): void {
      for (const bridge of bridges) bridge.stop();
    },
  };
}
