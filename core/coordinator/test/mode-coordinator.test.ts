import { describe, expect, it } from 'vitest';
import { CapturingBus } from '@aah/test-fixtures';
import { ModeCoordinator } from '../src/mode-coordinator.js';

describe('ModeCoordinator', () => {
  it('arbitrate() emits coordinator/mode-switch-requested with the candidates', () => {
    const bus = new CapturingBus();
    const coord = new ModeCoordinator(bus);

    coord.arbitrate('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE']);

    const requested = bus.emitted.filter(
      (e) => e.topic === 'coordinator/mode-switch-requested',
    );
    expect(requested).toHaveLength(1);
    expect(requested[0].payload).toMatchObject({
      channel: 'input',
      candidates: ['GAZE_ACTIVE', 'VOICE_ACTIVE'],
    });
    // The first candidate is the default active mode.
    expect(coord.activeOn('input')).toBe('GAZE_ACTIVE');
    expect(coord.channels()).toEqual(['input']);
  });

  it('honors an explicit initial mode', () => {
    const bus = new CapturingBus();
    const coord = new ModeCoordinator(bus);

    coord.arbitrate('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE'], 'VOICE_ACTIVE');

    expect(coord.activeOn('input')).toBe('VOICE_ACTIVE');
  });

  it('switchTo() emits coordinator/mode-changed and flips the active mode (handoff)', () => {
    const bus = new CapturingBus();
    const coord = new ModeCoordinator(bus);
    coord.arbitrate('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE']);

    coord.switchTo('input', 'VOICE_ACTIVE');

    expect(coord.activeOn('input')).toBe('VOICE_ACTIVE');
    const changed = bus.emitted.filter((e) => e.topic === 'coordinator/mode-changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].payload).toMatchObject({
      channel: 'input',
      activeServiceId: 'VOICE_ACTIVE',
    });
  });

  it('GAZE <-> VOICE handoff sequence: the request precedes the change', () => {
    const bus = new CapturingBus();
    const coord = new ModeCoordinator(bus);

    coord.arbitrate('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE']);
    coord.switchTo('input', 'VOICE_ACTIVE');
    coord.switchTo('input', 'GAZE_ACTIVE');

    expect(bus.topics()).toEqual([
      'coordinator/mode-switch-requested',
      'coordinator/mode-changed',
      'coordinator/mode-changed',
    ]);
    expect(coord.activeOn('input')).toBe('GAZE_ACTIVE');
  });

  it('arbitrate() is idempotent per channel (keeps the existing machine)', () => {
    const bus = new CapturingBus();
    const coord = new ModeCoordinator(bus);

    coord.arbitrate('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE']);
    coord.switchTo('input', 'VOICE_ACTIVE');
    // Re-arbitrating must not reset the active mode back to the default.
    coord.arbitrate('input', ['GAZE_ACTIVE', 'VOICE_ACTIVE']);

    expect(coord.activeOn('input')).toBe('VOICE_ACTIVE');
    expect(coord.channels()).toEqual(['input']);
  });

  it('throws when switching a channel that is not under arbitration', () => {
    const bus = new CapturingBus();
    const coord = new ModeCoordinator(bus);

    expect(() => coord.switchTo('input', 'GAZE_ACTIVE')).toThrow(/not under arbitration/);
  });
});
