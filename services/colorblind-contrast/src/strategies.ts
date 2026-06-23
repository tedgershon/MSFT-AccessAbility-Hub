/**
 * Strategy pattern: swap the color-correction algorithm at runtime
 * (deuteranopia vs. protanopia vs. tritanopia ...) behind one interface.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A color-correction strategy. Pure function of a pixel → corrected pixel. */
export interface CorrectionStrategy {
  readonly id: string;
  correct(pixel: Rgb): Rgb;
}

export class DeuteranopiaStrategy implements CorrectionStrategy {
  readonly id = 'deuteranopia';
  correct(pixel: Rgb): Rgb {
    // TODO: real daltonization. Identity stub for the scaffold.
    return pixel;
  }
}

export class ProtanopiaStrategy implements CorrectionStrategy {
  readonly id = 'protanopia';
  correct(pixel: Rgb): Rgb {
    // TODO: real daltonization. Identity stub for the scaffold.
    return pixel;
  }
}

export const STRATEGIES: Record<string, CorrectionStrategy> = {
  deuteranopia: new DeuteranopiaStrategy(),
  protanopia: new ProtanopiaStrategy(),
};
