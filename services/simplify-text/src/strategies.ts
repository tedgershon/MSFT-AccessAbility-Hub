/**
 * Strategy pattern: swap the text-transform algorithm at runtime behind one interface.
 *
 * SimplifyStrategy  — MTCAI (Georgia Tech CIDI): plain-language reduction for
 *   health portals, forms, and complex on-screen text.
 * RestructureStrategy — NAPE (CMU VariAbility Lab): reformat learning materials
 *   to a user's cognitive style (ADHD, dyslexia, autism).
 */

export interface TransformStrategy {
  readonly id: 'simplify' | 'restructure';
  /** Transform input text. Pure function; stub until AI pipeline is wired. */
  transform(text: string): string;
}

export class SimplifyStrategy implements TransformStrategy {
  readonly id = 'simplify' as const;

  transform(text: string): string {
    // TODO: call MTCAI/CIDI plain-language reduction pipeline.
    return text;
  }
}

export class RestructureStrategy implements TransformStrategy {
  readonly id = 'restructure' as const;

  transform(text: string): string {
    // TODO: call NAPE cognitive-style reformat pipeline (ADHD/dyslexia/autism).
    return text;
  }
}

export const STRATEGIES: Record<string, TransformStrategy> = {
  simplify: new SimplifyStrategy(),
  restructure: new RestructureStrategy(),
};
