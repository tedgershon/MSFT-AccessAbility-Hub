/**
 * Minimal structured logger.
 *
 * The kernel must report internal faults (e.g. a subscriber that throws) without
 * coupling to a concrete logging stack. Components take a {@link Logger} via DI and
 * default to {@link consoleLogger}; the shell can swap in a real sink later.
 */
export interface Logger {
  /** Record an error with optional structured fields. */
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Default logger: forwards to the console, preserving structured fields. */
export const consoleLogger: Logger = {
  error(message: string, fields?: Record<string, unknown>): void {
    if (fields) console.error(message, fields);
    else console.error(message);
  },
};
