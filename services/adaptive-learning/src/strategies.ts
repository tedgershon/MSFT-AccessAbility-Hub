/**
 * Strategy pattern: swap the cognitive-style restructuring algorithm at runtime
 * (ADHD vs. dyslexia vs. autism ...) behind one interface.
 *
 * NAPE (adaptive learning materials) reads on-screen learning text and re-injects
 * a version restructured for the reader's cognitive style. Each strategy is a pure
 * function of source text → restructured text, so the service stays a thin overlay
 * shell and the algorithms stay independently testable.
 */

/** A cognitive-style restructuring strategy. Pure function of text → text. */
export interface CognitiveStyleStrategy {
  readonly id: string;
  /** Human-readable label for the shell / config UI. */
  readonly label: string;
  /** Restructure a block of learning text for this cognitive style. */
  restructure(text: string): string;
}

/** Split text into trimmed, non-empty sentences. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * ADHD: chunk dense prose into short, scannable bullet points so each idea is its
 * own visual unit and attention isn't lost mid-paragraph.
 */
export class AdhdStrategy implements CognitiveStyleStrategy {
  readonly id = 'adhd';
  readonly label = 'ADHD — chunked bullets';
  restructure(text: string): string {
    const items = sentences(text);
    if (items.length === 0) return text.trim();
    return items.map((s) => `• ${s}`).join('\n');
  }
}

/**
 * Dyslexia: increase inter-word spacing and isolate one sentence per line to reduce
 * visual crowding and line-tracking errors.
 */
export class DyslexiaStrategy implements CognitiveStyleStrategy {
  readonly id = 'dyslexia';
  readonly label = 'Dyslexia — spaced lines';
  restructure(text: string): string {
    const lines = sentences(text);
    if (lines.length === 0) return text.trim();
    return lines.map((s) => s.replace(/\s+/gu, '  ')).join('\n\n');
  }
}

/**
 * Autism: present material as an explicit, numbered step list to make implicit
 * sequence and structure literal and predictable.
 */
export class AutismStrategy implements CognitiveStyleStrategy {
  readonly id = 'autism';
  readonly label = 'Autism — literal steps';
  restructure(text: string): string {
    const steps = sentences(text);
    if (steps.length === 0) return text.trim();
    return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  }
}

export const STRATEGIES: Record<string, CognitiveStyleStrategy> = {
  adhd: new AdhdStrategy(),
  dyslexia: new DyslexiaStrategy(),
  autism: new AutismStrategy(),
};

/** Default cognitive style when none is configured. */
export const DEFAULT_STYLE_ID = 'adhd';
