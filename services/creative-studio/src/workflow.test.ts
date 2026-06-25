import { describe, expect, it } from 'vitest';
import {
  WorkflowRunner,
  defaultWorkflows,
  type StudioAction,
  type Workflow,
  type WorkflowContext,
} from './workflow.js';

interface Emitted {
  kind: 'cursor' | 'keyboard';
  payload: Record<string, unknown>;
}

function recordingCtx(): { ctx: WorkflowContext; emitted: Emitted[]; audit: string[] } {
  const emitted: Emitted[] = [];
  const audit: string[] = [];
  const ctx: WorkflowContext = {
    emit: (kind, payload) => emitted.push({ kind, payload }),
    audit: (entry) => audit.push(entry),
  };
  return { ctx, emitted, audit };
}

describe('WorkflowRunner', () => {
  it('registers the default workflows', () => {
    const { ctx } = recordingCtx();
    const runner = new WorkflowRunner(ctx);
    expect(runner.list()).toEqual(['export-png', 'save', 'undo']);
  });

  it('emits each step as an input intent through the mux', async () => {
    const { ctx, emitted } = recordingCtx();
    const runner = new WorkflowRunner(ctx);
    const result = await runner.run('export-png');

    expect(result).toEqual({ id: 'export-png', ran: true, steps: 2 });
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toEqual({
      kind: 'keyboard',
      payload: { keys: 'Ctrl+Shift+E' },
    });
  });

  it('audits start, each step, and completion', async () => {
    const { ctx, audit } = recordingCtx();
    await new WorkflowRunner(ctx).run('save');
    expect(audit).toEqual(['workflow start save', 'step save', 'workflow done save']);
  });

  it('throws on an unknown workflow id', async () => {
    const { ctx } = recordingCtx();
    await expect(new WorkflowRunner(ctx).run('nope')).rejects.toThrow('unknown workflow');
  });

  it('refuses to start a second workflow while one is running', async () => {
    // A workflow whose emit re-enters run() proves the running guard holds.
    let reentrant: Promise<Awaited<ReturnType<WorkflowRunner['run']>>> | undefined;
    const ref: { runner?: WorkflowRunner } = {};
    const ctx: WorkflowContext = {
      emit: () => {
        // Re-enter while the outer run is mid-flight (synchronously, before it ends).
        reentrant ??= ref.runner!.run('save');
      },
      audit: () => {},
    };
    const wf: Workflow = {
      id: 'outer',
      title: 'Outer',
      steps: [{ kind: 'keyboard', payload: {}, describe: 'x' } satisfies StudioAction],
    };
    ref.runner = new WorkflowRunner(ctx, [wf, ...defaultWorkflows()]);

    await ref.runner.run('outer');
    expect(await reentrant).toEqual({ id: 'save', ran: false, steps: 0 });
  });

  it('clears the running flag after completion so it can run again', async () => {
    const { ctx } = recordingCtx();
    const runner = new WorkflowRunner(ctx);
    await runner.run('undo');
    expect(runner.running).toBeNull();
    const again = await runner.run('undo');
    expect(again.ran).toBe(true);
  });
});
