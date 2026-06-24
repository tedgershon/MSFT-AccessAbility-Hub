import { describe, expect, it } from 'vitest';
import { ModeStateMachine } from '../src/mode-state-machine.js';

describe('ModeStateMachine', () => {
  it('starts in the declared initial mode (single active invariant)', () => {
    const m = new ModeStateMachine('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE'], 'GAZE_ACTIVE');
    expect(m.active).toBe('GAZE_ACTIVE');
    expect(m.modes.sort()).toEqual(['GAZE_ACTIVE', 'VOICE_ACTIVE']);
  });

  it('switchTo a registered mode updates active and records history', () => {
    const m = new ModeStateMachine('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE'], 'GAZE_ACTIVE');

    const t = m.switchTo('VOICE_ACTIVE');

    expect(m.active).toBe('VOICE_ACTIVE');
    expect(t).toMatchObject({ from: 'GAZE_ACTIVE', to: 'VOICE_ACTIVE' });
    expect(typeof t.at).toBe('number');
    expect(m.history()).toHaveLength(1);
    expect(m.history()[0]).toMatchObject({ from: 'GAZE_ACTIVE', to: 'VOICE_ACTIVE' });
  });

  it('tracks a full transition history across multiple switches', () => {
    const m = new ModeStateMachine('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE'], 'GAZE_ACTIVE');

    m.switchTo('VOICE_ACTIVE');
    m.switchTo('GAZE_ACTIVE');

    expect(m.history().map((h) => `${h.from}->${h.to}`)).toEqual([
      'GAZE_ACTIVE->VOICE_ACTIVE',
      'VOICE_ACTIVE->GAZE_ACTIVE',
    ]);
    // Exactly one mode is ever active.
    expect(m.active).toBe('GAZE_ACTIVE');
  });

  it('throws when switching to an unregistered mode', () => {
    const m = new ModeStateMachine('input', ['GAZE_ACTIVE'], 'GAZE_ACTIVE');
    expect(() => m.switchTo('NOPE')).toThrow(/not registered/);
  });

  it('returns a copy of history (callers cannot mutate internal state)', () => {
    const m = new ModeStateMachine('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE'], 'GAZE_ACTIVE');
    m.switchTo('VOICE_ACTIVE');
    m.history().push({ from: 'x', to: 'y', at: 0 });
    expect(m.history()).toHaveLength(1);
  });

  it('rejects an empty mode set', () => {
    expect(() => new ModeStateMachine('input', [], 'GAZE_ACTIVE')).toThrow(
      /at least one mode/,
    );
  });

  it('rejects an initial mode that is not in the set', () => {
    expect(() => new ModeStateMachine('input', ['GAZE_ACTIVE'], 'VOICE_ACTIVE')).toThrow(
      /Initial mode/,
    );
  });
});
