/**
 * Settings — PURE customization model + (de)serialisation for the shell.
 *
 * Presentation controls are a first-class accessibility feature, not a buried
 * preference pane: this module owns the typed settings object, seeds defaults from
 * system preferences, parses/validates persisted state, and resolves the concrete
 * appearance the renderer applies. Imports nothing from `electron`, `node`, or the
 * DOM — `localStorage` / `matchMedia` access lives in the renderer; everything here
 * is unit-testable under plain Node/vitest.
 */

/** Text-size scale options. */
export type TextSize = 'normal' | 'large' | 'x-large';
/** Theme preference; `system` follows `prefers-color-scheme`. */
export type ThemePref = 'light' | 'dark' | 'system';
/** Contrast preference. */
export type ContrastPref = 'standard' | 'high';
/** Motion preference; gates animations alongside `prefers-reduced-motion`. */
export type MotionPref = 'full' | 'reduced';

/** A small, typed, persisted settings object. */
export interface HubSettings {
  textSize: TextSize;
  theme: ThemePref;
  contrast: ContrastPref;
  motion: MotionPref;
  /** Ids of pinned tiles, in pin order. */
  pinned: string[];
}

/** System preferences read from the environment (media queries) by the renderer. */
export interface SystemPrefs {
  prefersDark: boolean;
  prefersReducedMotion: boolean;
  prefersHighContrast: boolean;
}

const TEXT_SIZES: readonly TextSize[] = ['normal', 'large', 'x-large'];
const THEMES: readonly ThemePref[] = ['light', 'dark', 'system'];
const CONTRASTS: readonly ContrastPref[] = ['standard', 'high'];
const MOTIONS: readonly MotionPref[] = ['full', 'reduced'];

/**
 * Seed a fresh settings object from system preferences. Explicit user choices made
 * later win over these defaults (they are persisted and restored verbatim).
 */
export function defaultSettings(prefs: SystemPrefs): HubSettings {
  return {
    textSize: 'normal',
    theme: 'system',
    contrast: prefs.prefersHighContrast ? 'high' : 'standard',
    motion: prefs.prefersReducedMotion ? 'reduced' : 'full',
    pinned: [],
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Parse persisted settings (e.g. a `localStorage` string) into a valid object,
 * falling back per-field to {@link defaultSettings} so a corrupt or partial blob can
 * never crash startup or yield an invalid state.
 */
export function parseSettings(raw: string | null, prefs: SystemPrefs): HubSettings {
  const base = defaultSettings(prefs);
  if (raw == null) return base;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof parsed !== 'object' || parsed === null) return base;

  const obj = parsed as Record<string, unknown>;
  const pinned = Array.isArray(obj.pinned)
    ? obj.pinned.filter((id): id is string => typeof id === 'string')
    : base.pinned;

  return {
    textSize: oneOf(obj.textSize, TEXT_SIZES, base.textSize),
    theme: oneOf(obj.theme, THEMES, base.theme),
    contrast: oneOf(obj.contrast, CONTRASTS, base.contrast),
    motion: oneOf(obj.motion, MOTIONS, base.motion),
    pinned,
  };
}

/** Serialise settings for persistence. */
export function serializeSettings(settings: HubSettings): string {
  return JSON.stringify(settings);
}

/** Resolve a theme preference to a concrete theme using system preferences. */
export function resolveTheme(theme: ThemePref, prefs: SystemPrefs): 'light' | 'dark' {
  if (theme === 'system') return prefs.prefersDark ? 'dark' : 'light';
  return theme;
}

/** The concrete appearance the renderer applies as `data-*` attributes on the root. */
export interface ResolvedAppearance {
  theme: 'light' | 'dark';
  textSize: TextSize;
  contrast: ContrastPref;
  motion: MotionPref;
}

/**
 * Resolve the settings + system preferences into the concrete appearance attributes.
 * Explicit user choices win; only `theme: 'system'` consults the environment.
 */
export function resolveAppearance(
  settings: HubSettings,
  prefs: SystemPrefs,
): ResolvedAppearance {
  return {
    theme: resolveTheme(settings.theme, prefs),
    textSize: settings.textSize,
    contrast: settings.contrast,
    motion: settings.motion,
  };
}

/** Toggle an id in the pinned list, returning a new settings object. */
export function togglePinned(settings: HubSettings, id: string): HubSettings {
  const pinned = settings.pinned.includes(id)
    ? settings.pinned.filter((p) => p !== id)
    : [...settings.pinned, id];
  return { ...settings, pinned };
}
