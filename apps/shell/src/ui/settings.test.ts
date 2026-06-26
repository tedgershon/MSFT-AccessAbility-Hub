/**
 * Unit tests for the PURE settings model. No electron / DOM — plain Node exercising
 * defaults, parse/validate, and appearance resolution.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  parseSettings,
  resolveAppearance,
  resolveTheme,
  serializeSettings,
  togglePinned,
  type HubSettings,
  type SystemPrefs,
} from './settings.js';

const NO_PREFS: SystemPrefs = {
  prefersDark: false,
  prefersReducedMotion: false,
  prefersHighContrast: false,
};

describe('defaultSettings', () => {
  it('seeds neutral defaults when the system has no strong preferences', () => {
    expect(defaultSettings(NO_PREFS)).toEqual({
      textSize: 'normal',
      theme: 'system',
      contrast: 'standard',
      motion: 'full',
      pinned: [],
    });
  });

  it('seeds reduced motion and high contrast from system preferences', () => {
    const s = defaultSettings({ prefersDark: true, prefersReducedMotion: true, prefersHighContrast: true });
    expect(s.motion).toBe('reduced');
    expect(s.contrast).toBe('high');
    // Theme stays `system` so it tracks the OS, resolved later.
    expect(s.theme).toBe('system');
  });
});

describe('parseSettings', () => {
  it('returns defaults for null input', () => {
    expect(parseSettings(null, NO_PREFS)).toEqual(defaultSettings(NO_PREFS));
  });

  it('returns defaults for malformed JSON', () => {
    expect(parseSettings('{not json', NO_PREFS)).toEqual(defaultSettings(NO_PREFS));
  });

  it('round-trips a valid settings object', () => {
    const settings: HubSettings = {
      textSize: 'large',
      theme: 'dark',
      contrast: 'high',
      motion: 'reduced',
      pinned: ['a', 'b'],
    };
    expect(parseSettings(serializeSettings(settings), NO_PREFS)).toEqual(settings);
  });

  it('falls back per-field on invalid values and drops non-string pins', () => {
    const raw = JSON.stringify({
      textSize: 'huge',
      theme: 'neon',
      contrast: 'ultra',
      motion: 'bouncy',
      pinned: ['a', 3, null, 'b'],
    });
    expect(parseSettings(raw, NO_PREFS)).toEqual({
      textSize: 'normal',
      theme: 'system',
      contrast: 'standard',
      motion: 'full',
      pinned: ['a', 'b'],
    });
  });
});

describe('resolveTheme', () => {
  it('follows the system preference when theme is system', () => {
    expect(resolveTheme('system', { ...NO_PREFS, prefersDark: true })).toBe('dark');
    expect(resolveTheme('system', { ...NO_PREFS, prefersDark: false })).toBe('light');
  });

  it('honours an explicit theme over the system preference', () => {
    expect(resolveTheme('light', { ...NO_PREFS, prefersDark: true })).toBe('light');
    expect(resolveTheme('dark', { ...NO_PREFS, prefersDark: false })).toBe('dark');
  });
});

describe('resolveAppearance', () => {
  it('resolves the system theme but passes explicit choices through', () => {
    const settings: HubSettings = {
      textSize: 'x-large',
      theme: 'system',
      contrast: 'high',
      motion: 'reduced',
      pinned: [],
    };
    expect(resolveAppearance(settings, { ...NO_PREFS, prefersDark: true })).toEqual({
      theme: 'dark',
      textSize: 'x-large',
      contrast: 'high',
      motion: 'reduced',
    });
  });
});

describe('togglePinned', () => {
  it('adds an id when absent and removes it when present', () => {
    const base = defaultSettings(NO_PREFS);
    const pinned = togglePinned(base, 'a');
    expect(pinned.pinned).toEqual(['a']);
    expect(togglePinned(pinned, 'a').pinned).toEqual([]);
    // Original object is not mutated.
    expect(base.pinned).toEqual([]);
  });
});
