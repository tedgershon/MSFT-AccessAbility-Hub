/**
 * Unit tests for the PURE shell view-model. No electron / DOM here — just plain
 * Node, exercising the mapping + presentation helpers with lightweight fakes.
 */

import { describe, expect, it } from 'vitest';
import type { AccessibilityService, HealthStatus, OverlayLayer } from '@aah/contracts';
import type { ServiceRecord } from '@aah/kernel';
import { describeOverlayLayer, overlayLayerToView, toServiceViews } from './view-model.js';

function fakeRecord(
  over: { id?: string; name?: string; phase?: ServiceRecord['phase']; health?: HealthStatus } = {},
): ServiceRecord {
  const health: HealthStatus = over.health ?? { state: 'healthy', detail: 'ok', checkedAt: 0 };
  const service = {
    meta: { id: over.id ?? 'svc-a', name: over.name ?? 'Service A', version: '0.0.0' },
    requires: [],
    healthCheck: (): HealthStatus => health,
  } as unknown as AccessibilityService;
  return { service, phase: over.phase ?? 'enabled' };
}

describe('toServiceViews', () => {
  it('maps meta + phase + healthCheck() into ServiceViews', () => {
    const views = toServiceViews([
      fakeRecord({ id: 'a', name: 'Alpha', phase: 'enabled' }),
      fakeRecord({
        id: 'b',
        name: 'Beta',
        phase: 'disabled',
        health: { state: 'degraded', detail: 'idle', checkedAt: 0 },
      }),
    ]);

    expect(views).toEqual([
      { id: 'a', name: 'Alpha', phase: 'enabled', health: { state: 'healthy', detail: 'ok' } },
      { id: 'b', name: 'Beta', phase: 'disabled', health: { state: 'degraded', detail: 'idle' } },
    ]);
  });

  it('omits detail when the health status has none', () => {
    const [view] = toServiceViews([
      fakeRecord({ health: { state: 'unhealthy', checkedAt: 0 } }),
    ]);

    expect(view.health).toEqual({ state: 'unhealthy' });
    expect('detail' in view.health).toBe(false);
  });
});

describe('overlayLayerToView', () => {
  it('copies id/ownerId/kind and clones params', () => {
    const layer: OverlayLayer = {
      id: 'l1',
      ownerId: 'svc-a',
      kind: 'caption',
      params: { text: 'hello' },
    };

    const view = overlayLayerToView(layer);

    expect(view).toEqual({ id: 'l1', ownerId: 'svc-a', kind: 'caption', params: { text: 'hello' } });
    expect(view.params).not.toBe(layer.params);
  });

  it('omits params when the layer has none', () => {
    const view = overlayLayerToView({ id: 'l1', ownerId: 'svc-a', kind: 'dim' });
    expect('params' in view).toBe(false);
  });
});

describe('describeOverlayLayer', () => {
  it('derives a CSS filter for a known color-correction strategy', () => {
    const d = describeOverlayLayer({
      id: 'l1',
      ownerId: 'svc',
      kind: 'color-correction',
      params: { strategy: 'deuteranopia' },
    });

    expect(d.kind).toBe('color-correction');
    expect(d.label).toContain('deuteranopia');
    expect(d.style?.filter).toMatch(/hue-rotate/);
  });

  it('falls back to a default filter for an unknown strategy', () => {
    const d = describeOverlayLayer({
      id: 'l1',
      ownerId: 'svc',
      kind: 'color-correction',
      params: { strategy: 'unobtanium' },
    });

    expect(d.style?.filter).toBe('contrast(1.05)');
  });

  it('uses params.text as the label for a caption layer', () => {
    const d = describeOverlayLayer({
      id: 'c1',
      ownerId: 'svc',
      kind: 'caption',
      params: { text: 'live caption' },
    });

    expect(d).toEqual({ kind: 'caption', label: 'live caption' });
  });

  it('derives a typography preset for a known adaptive-text style', () => {
    const d = describeOverlayLayer({
      id: 'a1',
      ownerId: 'svc',
      kind: 'adaptive-text',
      params: { style: 'dyslexia' },
    });

    expect(d.kind).toBe('adaptive-text');
    expect(d.label).toContain('dyslexia');
    expect(d.style?.wordSpacing).toBe('0.16em');
  });

  it('falls back to a default typography preset for an unknown adaptive-text style', () => {
    const d = describeOverlayLayer({
      id: 'a2',
      ownerId: 'svc',
      kind: 'adaptive-text',
      params: { style: 'telepathy' },
    });

    expect(d.kind).toBe('adaptive-text');
    expect(d.style).toEqual({ lineHeight: '1.6' });
  });

  it('falls back to a labelled chip for an unknown kind', () => {
    const d = describeOverlayLayer({ id: 'x1', ownerId: 'svc', kind: 'mystery' });

    expect(d).toEqual({ kind: 'mystery', label: 'mystery' });
    expect(d.style).toBeUndefined();
  });
});
