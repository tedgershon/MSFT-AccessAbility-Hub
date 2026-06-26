/**
 * Pure privacy-risk analysis core (no I/O, no hardware, no models).
 *
 * Mirrors the Strategy pattern used by `flash-filter` / `colorblind-contrast`: the
 * service stays a thin lifecycle shell while the decision logic lives here as a set
 * of independent, unit-testable *risk detectors*. Each detector inspects a
 * {@link ShareScene} — a structured description of an image/screenshot the user is
 * about to share — and may emit a {@link PrivacyFinding}. {@link PrivacyGuard} runs
 * them all, de-duplicates by key, and orders the most severe first.
 *
 * This module imports only the shared finding contract so it can be tested without
 * any vision model and reused regardless of how the scene description is produced.
 */

import type { PrivacyFinding } from '@aah/contracts';

/**
 * Structured description of one item the user is about to share.
 *
 * Produced by the perception/analyzer layer (OCR + face/EXIF inference) so the
 * detectors below stay pure and model-free. Fields degrade gracefully: the defaults
 * describe an empty, safe-to-share item.
 */
export interface ShareScene {
  /** A label for the item ("screenshot" / filename) used only in warning text. */
  source: string;
  /** Number of recognizable human faces detected in the image. */
  faceCount: number;
  /** Text read out of the image (OCR / on-screen text); scanned for PII + secrets. */
  text: string;
  /** True when the item is a capture of the user's screen rather than a photo. */
  isScreenCapture: boolean;
  /** True when the file embeds GPS / location metadata (e.g. EXIF GPS tags). */
  hasLocationMetadata: boolean;
}

/** Build a {@link ShareScene}, filling unspecified fields with safe defaults. */
export function shareScene(partial: Partial<ShareScene> = {}): ShareScene {
  return {
    source: partial.source ?? 'image',
    faceCount: partial.faceCount ?? 0,
    text: partial.text ?? '',
    isScreenCapture: partial.isScreenCapture ?? false,
    hasLocationMetadata: partial.hasLocationMetadata ?? false,
  };
}

/** One privacy failure mode. Returns a finding or `null`. */
export interface RiskDetector {
  readonly key: string;
  inspect(scene: ShareScene): PrivacyFinding | null;
}

/** The image shows recognizable people — sharing may expose their identity. */
export class FaceLeakDetector implements RiskDetector {
  readonly key = 'faces';

  inspect(scene: ShareScene): PrivacyFinding | null {
    if (scene.faceCount <= 0) return null;
    const who = scene.faceCount === 1 ? 'a person' : `${scene.faceCount} people`;
    return {
      key: this.key,
      text: `This ${scene.source} shows ${who} — sharing may reveal their identity.`,
      severity: 'warn',
    };
  }
}

/** The file embeds GPS metadata that reveals where the photo was taken. */
export class LocationMetadataDetector implements RiskDetector {
  readonly key = 'location';

  inspect(scene: ShareScene): PrivacyFinding | null {
    if (!scene.hasLocationMetadata) return null;
    return {
      key: this.key,
      text: `This ${scene.source} embeds your GPS location — strip it before sharing.`,
      severity: 'warn',
    };
  }
}

/** Flags a regex match in the scene's OCR'd text. */
export class TextPatternDetector implements RiskDetector {
  constructor(
    readonly key: string,
    private readonly pattern: RegExp,
    private readonly message: string,
    private readonly severity: PrivacyFinding['severity'] = 'warn',
  ) {}

  inspect(scene: ShareScene): PrivacyFinding | null {
    if (!scene.text) return null;
    // Reset lastIndex defensively in case a global/sticky flag is ever passed in.
    this.pattern.lastIndex = 0;
    if (!this.pattern.test(scene.text)) return null;
    return { key: this.key, text: this.message, severity: this.severity };
  }
}

// Common PII / secret patterns. Deliberately conservative — these are advisories the
// user confirms, not an automated redactor — but tuned to catch the obvious leaks a
// blind user can't see in the image themselves.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?<!\d)(?:\+?\d[\s\-().]?){9,}\d(?!\d)/;
// 13-16 digit card-like runs allowing spaces/hyphen grouping.
const CARD_RE = /(?<!\d)(?:\d[ -]?){13,16}(?!\d)/g;
const GOV_ID_RE = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/; // US SSN shape.
const SECRET_RE = /\b(?:password|passwd|api[_\- ]?key|secret|token|bearer|private[_\- ]?key)\b/i;

/** Luhn checksum so only plausible card numbers trip the card detector. */
export function luhnOk(digits: string): boolean {
  const nums: number[] = [];
  for (const ch of digits) {
    if (ch >= '0' && ch <= '9') nums.push(ch.charCodeAt(0) - 48);
  }
  if (nums.length < 13) return false;
  let total = 0;
  nums.reverse().forEach((n, i) => {
    let d = n;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  });
  return total % 10 === 0;
}

/** A run of digits that passes a Luhn check — likely a payment card number. */
export class CreditCardDetector implements RiskDetector {
  readonly key = 'credit-card';

  inspect(scene: ShareScene): PrivacyFinding | null {
    if (!scene.text) return null;
    CARD_RE.lastIndex = 0;
    for (const match of scene.text.matchAll(CARD_RE)) {
      if (luhnOk(match[0])) {
        return {
          key: this.key,
          text: `This ${scene.source} appears to contain a payment card number.`,
          severity: 'block',
        };
      }
    }
    return null;
  }
}

/** The standard detector set, ordered most- to least-severe. */
export function defaultDetectors(): RiskDetector[] {
  return [
    new TextPatternDetector(
      'secret',
      SECRET_RE,
      "This image shows a password or secret key — don't share it.",
      'block',
    ),
    new CreditCardDetector(),
    new TextPatternDetector(
      'gov-id',
      GOV_ID_RE,
      'This image appears to show a government ID number.',
      'block',
    ),
    new TextPatternDetector('email', EMAIL_RE, 'This image shows an email address.', 'warn'),
    new TextPatternDetector(
      'phone',
      PHONE_RE,
      'This image shows what looks like a phone number.',
      'warn',
    ),
    new FaceLeakDetector(),
    new LocationMetadataDetector(),
  ];
}

const SEVERITY_RANK: Record<PrivacyFinding['severity'], number> = { block: 0, warn: 1 };

/**
 * Runs the detectors over a scene and yields the findings to surface.
 *
 * Stateless: every scanned item is judged on its own, so the same image always
 * produces the same findings. Results are de-duplicated by `key` and sorted with
 * hard `block` findings ahead of softer `warn` advisories, preserving detector order
 * within a severity tier.
 */
export class PrivacyGuard {
  readonly #detectors: RiskDetector[];

  constructor(detectors?: RiskDetector[]) {
    this.#detectors = detectors ?? defaultDetectors();
  }

  /** Return the privacy findings to surface for this share item. */
  assess(scene: ShareScene): PrivacyFinding[] {
    const found = new Map<string, PrivacyFinding>();
    for (const detector of this.#detectors) {
      const finding = detector.inspect(scene);
      if (finding === null || found.has(finding.key)) continue;
      found.set(finding.key, finding);
    }
    return [...found.values()].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
    );
  }
}

/** The overall decision for a set of findings: block > warn > allow. */
export function decisionFor(findings: PrivacyFinding[]): 'allow' | 'warn' | 'block' {
  if (findings.some((f) => f.severity === 'block')) return 'block';
  if (findings.length > 0) return 'warn';
  return 'allow';
}
