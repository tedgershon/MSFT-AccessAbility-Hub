import { describe, expect, it } from 'vitest';
import {
  type Capability,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';
import type { Frame } from './frame.js';
import { createChannelPair } from './in-memory-channel.js';
import { ProcessServiceProxy } from './process-service-proxy.js';

const META: ServiceMeta = { id: 'remote', name: 'Remote', version: '0.0.0' };
const REQUIRES: Capability[] = [];

function emptyCtx(): ServiceContext {
  return {
    selfId: 'remote',
    bus: { emit() {}, on: () => () => {}, off() {} },
    config: { get: () => undefined, set() {} },
  };
}

describe('ProcessServiceProxy', () => {
  it('exposes meta + requires host-side without a round-trip', () => {
    const { host, child } = createChannelPair();
    const proxy = new ProcessServiceProxy(META, REQUIRES, host);
    void child;
    expect(proxy.meta).toBe(META);
    expect(proxy.requires).toBe(REQUIRES);
  });

  it('sends a lifecycle frame for each hook', async () => {
    const { host, child } = createChannelPair();
    const frames: Frame[] = [];
    child.onMessage((f) => frames.push(f));

    const proxy = new ProcessServiceProxy(META, REQUIRES, host);
    await proxy.onLoad(emptyCtx());
    await proxy.onEnable();
    await proxy.onDisable();
    await proxy.onUnload();

    expect(frames).toEqual([
      { kind: 'lifecycle', phase: 'load' },
      { kind: 'lifecycle', phase: 'enable' },
      { kind: 'lifecycle', phase: 'disable' },
      { kind: 'lifecycle', phase: 'unload' },
    ]);
  });

  it('healthCheck() defaults to degraded before any health frame', () => {
    const { host } = createChannelPair();
    const proxy = new ProcessServiceProxy(META, REQUIRES, host);

    const status = proxy.healthCheck();
    expect(status.state).toBe('degraded');
    expect(status.detail).toBe('remote service not started');
  });

  it('healthCheck() reflects the latest pushed health frame', () => {
    const { host, child } = createChannelPair();
    const proxy = new ProcessServiceProxy(META, REQUIRES, host);

    const status = healthy('remote up');
    child.send({ kind: 'health', status });

    expect(proxy.healthCheck()).toEqual(status);
  });
});
