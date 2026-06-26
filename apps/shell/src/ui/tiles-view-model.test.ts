/**
 * Unit tests for the PURE tiles view-model. No electron / DOM — plain Node exercising
 * the catalog merge, grouping, filtering, and pin logic with lightweight fakes.
 */

import { describe, expect, it } from 'vitest';
import type { ServiceView } from './ipc-contract.js';
import type { TileDef } from './tiles.js';
import { GROUP_ORDER } from './tiles.js';
import { PINNED_GROUP_TITLE, tilesViewModel } from './tiles-view-model.js';

function def(over: Partial<TileDef> = {}): TileDef {
  return {
    id: 'svc-a',
    title: 'Alpha',
    description: 'does alpha things',
    group: 'Vision',
    tag: 'blind & low vision',
    input: 'camera',
    inputs: ['camera'],
    phase: 'built',
    icon: 'vision',
    ...over,
  };
}

function service(id: string, phase: ServiceView['phase'], state: ServiceView['health']['state']): ServiceView {
  return { id, name: id, phase, health: { state } };
}

describe('tilesViewModel — status mapping', () => {
  it('marks a planned tile as coming-soon, never available', () => {
    const view = tilesViewModel({ catalog: [def({ phase: 'planned' })], services: [] });
    const tile = view.groups[0].tiles[0];
    expect(tile.status).toBe('coming-soon');
    expect(tile.statusLabel).toBe('Coming soon');
    expect(tile.available).toBe(false);
    expect(tile.health).toBeNull();
  });

  it('marks a partial tile as setup-needed even when a service is present', () => {
    const view = tilesViewModel({
      catalog: [def({ id: 'a', phase: 'partial' })],
      services: [service('a', 'enabled', 'healthy')],
    });
    const tile = view.groups[0].tiles[0];
    expect(tile.status).toBe('setup-needed');
    expect(tile.available).toBe(false);
    expect(tile.reason).toBe('In progress');
  });

  it('marks a built tile setup-needed when its backing service is missing', () => {
    const view = tilesViewModel({ catalog: [def({ id: 'a', phase: 'built' })], services: [] });
    const tile = view.groups[0].tiles[0];
    expect(tile.status).toBe('setup-needed');
    expect(tile.reason).toBe('Service not running');
  });

  it('marks a built tile with a running service as available with live health', () => {
    const view = tilesViewModel({
      catalog: [def({ id: 'a', phase: 'built' })],
      services: [service('a', 'enabled', 'degraded')],
    });
    const tile = view.groups[0].tiles[0];
    expect(tile.status).toBe('available');
    expect(tile.available).toBe(true);
    expect(tile.enabled).toBe(true);
    expect(tile.statusLabel).toBe('degraded');
    expect(tile.health).toEqual({ state: 'degraded' });
  });

  it('reports a disabled built service as available but not enabled', () => {
    const view = tilesViewModel({
      catalog: [def({ id: 'a', phase: 'built' })],
      services: [service('a', 'disabled', 'healthy')],
    });
    const tile = view.groups[0].tiles[0];
    expect(tile.available).toBe(true);
    expect(tile.enabled).toBe(false);
  });
});

describe('tilesViewModel — grouping', () => {
  it('orders groups by GROUP_ORDER and omits empty groups', () => {
    const view = tilesViewModel({
      catalog: [
        def({ id: 'a', group: 'Hearing' }),
        def({ id: 'b', group: 'Vision' }),
      ],
      services: [],
    });
    expect(view.groups.map((g) => g.title)).toEqual(['Vision', 'Hearing']);
    expect(GROUP_ORDER.indexOf('Vision')).toBeLessThan(GROUP_ORDER.indexOf('Hearing'));
  });

  it('keeps tiles whose group is not in GROUP_ORDER at the end', () => {
    const view = tilesViewModel({
      catalog: [def({ id: 'a', group: 'Mystery' }), def({ id: 'b', group: 'Vision' })],
      services: [],
    });
    expect(view.groups.map((g) => g.title)).toEqual(['Vision', 'Mystery']);
  });
});

describe('tilesViewModel — filtering', () => {
  const catalog = [
    def({ id: 'a', title: 'Live Captions', description: 'audio to text', tag: 'deaf & hard of hearing', group: 'Hearing' }),
    def({ id: 'b', title: 'Color & Contrast', description: 'overlay', tag: 'color vision deficiency', group: 'Colour vision' }),
  ];

  it('search matches title, description, or tag (case-insensitive)', () => {
    expect(tilesViewModel({ catalog, services: [], search: 'CAPTIONS' }).total).toBe(1);
    expect(tilesViewModel({ catalog, services: [], search: 'overlay' }).total).toBe(1);
    expect(tilesViewModel({ catalog, services: [], search: 'hearing' }).total).toBe(1);
    expect(tilesViewModel({ catalog, services: [], search: 'nothing' }).total).toBe(0);
  });

  it('tagFilter keeps only tiles with the matching tag', () => {
    const view = tilesViewModel({ catalog, services: [], tagFilter: 'color vision deficiency' });
    expect(view.total).toBe(1);
    expect(view.groups[0].tiles[0].id).toBe('b');
  });

  it('exposes all catalog tags sorted regardless of the active filter', () => {
    const view = tilesViewModel({ catalog, services: [], tagFilter: 'color vision deficiency' });
    expect(view.tags).toEqual(['color vision deficiency', 'deaf & hard of hearing']);
  });
});

describe('tilesViewModel — pinning', () => {
  it('floats pinned tiles into a Pinned section first and removes them from their group', () => {
    const view = tilesViewModel({
      catalog: [def({ id: 'a', group: 'Vision' }), def({ id: 'b', group: 'Hearing' })],
      services: [],
      pinned: ['b'],
    });
    expect(view.groups[0].title).toBe(PINNED_GROUP_TITLE);
    expect(view.groups[0].tiles.map((t) => t.id)).toEqual(['b']);
    expect(view.groups[0].tiles[0].pinned).toBe(true);
    // 'b' is not duplicated under Hearing.
    expect(view.groups.find((g) => g.title === 'Hearing')).toBeUndefined();
    expect(view.total).toBe(2);
  });

  it('omits the Pinned section when nothing is pinned', () => {
    const view = tilesViewModel({ catalog: [def({ id: 'a' })], services: [] });
    expect(view.groups.some((g) => g.title === PINNED_GROUP_TITLE)).toBe(false);
  });
});
