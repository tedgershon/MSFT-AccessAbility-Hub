import { describe, expect, it } from 'vitest';
import {
  AppIntrospectionAdapter,
  ScriptedAppStateChannel,
  emptyAppState,
  type AppStateSnapshot,
} from './index.js';

function snap(overrides: Partial<AppStateSnapshot> = {}): AppStateSnapshot {
  return { ...emptyAppState('image-editor'), ...overrides };
}

describe('emptyAppState', () => {
  it('is a neutral baseline carrying the app id', () => {
    expect(emptyAppState('image-editor')).toEqual({
      app: 'image-editor',
      tool: '',
      selection: null,
      activeLayer: null,
      zoom: 1,
      dialog: null,
      status: null,
    });
  });
});

describe('ScriptedAppStateChannel', () => {
  it('replays queued snapshots in order, then null', () => {
    const ch = new ScriptedAppStateChannel([snap({ tool: 'brush' }), snap({ tool: 'eraser' })]);
    ch.open();
    expect(ch.poll()?.tool).toBe('brush');
    expect(ch.poll()?.tool).toBe('eraser');
    expect(ch.poll()).toBeNull();
  });

  it('tracks the lease and refuses polling while closed', () => {
    const ch = new ScriptedAppStateChannel([snap()]);
    expect(() => ch.poll()).toThrow();
    ch.open();
    ch.close();
    expect(ch.isOpen).toBe(false);
    expect(ch.openCount).toBe(1);
    expect(ch.closeCount).toBe(1);
  });
});

describe('AppIntrospectionAdapter', () => {
  it('surfaces snapshots from the injected reader only while open', () => {
    let next: AppStateSnapshot | null = snap({ zoom: 2 });
    const adapter = new AppIntrospectionAdapter(() => next);

    expect(() => adapter.poll()).toThrow();
    adapter.open();
    expect(adapter.poll()?.zoom).toBe(2);
    next = null;
    expect(adapter.poll()).toBeNull();

    adapter.close();
    expect(adapter.isOpen).toBe(false);
  });
});
