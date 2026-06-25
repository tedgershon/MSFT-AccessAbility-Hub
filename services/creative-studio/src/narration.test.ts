import { describe, expect, it } from 'vitest';
import { Narrator, defaultDescribers, emptyState, type StudioState } from './narration.js';

function state(overrides: Partial<StudioState> = {}): StudioState {
  return { ...emptyState('image-editor'), ...overrides };
}

describe('Narrator', () => {
  it('describes everything new on the first transition from empty', () => {
    const n = new Narrator();
    const next = state({ tool: 'brush', activeLayer: 'Background', zoom: 1.5 });
    const texts = n.narrate(emptyState('image-editor'), next).map((u) => u.text);
    expect(texts).toContain('brush tool selected');
    expect(texts).toContain('Active layer Background');
    expect(texts).toContain('Zoom 150 percent');
  });

  it('narrates only what changed between two snapshots', () => {
    const n = new Narrator();
    const prev = state({ tool: 'brush', zoom: 1 });
    const next = state({ tool: 'brush', zoom: 2 });
    const utterances = n.narrate(prev, next);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].source).toBe('zoom');
    expect(utterances[0].text).toBe('Zoom 200 percent');
  });

  it('says nothing when nothing changed', () => {
    const n = new Narrator();
    const s = state({ tool: 'brush' });
    expect(n.narrate(s, s)).toEqual([]);
  });

  it('orders assertive utterances (dialogs, status) before polite ones', () => {
    const n = new Narrator();
    const prev = state({ tool: 'brush' });
    const next = state({ tool: 'eraser', dialog: 'Export', status: 'Saved' });
    const sources = n.narrate(prev, next).map((u) => u.urgency);
    // Two assertive (dialog, status) then the polite tool change.
    expect(sources.slice(0, 2)).toEqual(['assertive', 'assertive']);
    expect(sources.at(-1)).toBe('polite');
  });

  it('announces selection set and cleared', () => {
    const n = new Narrator();
    expect(n.narrate(state(), state({ selection: 'rectangle' }))[0].text).toBe('Selected rectangle');
    expect(
      n.narrate(state({ selection: 'rectangle' }), state({ selection: null }))[0].text,
    ).toBe('Selection cleared');
  });

  it('announces dialog open assertively and close politely', () => {
    const n = new Narrator();
    const open = n.narrate(state(), state({ dialog: 'Export' }))[0];
    expect(open).toMatchObject({ text: 'Export dialog opened', urgency: 'assertive' });
    const close = n.narrate(state({ dialog: 'Export' }), state({ dialog: null }))[0];
    expect(close).toMatchObject({ text: 'Dialog closed', urgency: 'polite' });
  });

  it('default describer sources are unique', () => {
    const sources = defaultDescribers().map((d) => d.source);
    expect(new Set(sources).size).toBe(sources.length);
  });
});
