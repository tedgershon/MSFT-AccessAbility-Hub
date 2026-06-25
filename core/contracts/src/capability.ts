/**
 * Capability manifest types.
 *
 * A {@link Capability} is a `(resource, mode)` pair. Every service declares the
 * capabilities it `requires` up front; that declaration is what lets the kernel's
 * Resource Arbiter detect conflicts *before* anything runs.
 */

/**
 * Named, contended resources a service can touch. This is intentionally a closed
 * union: the kernel never invents resources, services only declare from this set.
 */
export type Resource =
  | 'camera'
  | 'displayCapture'
  | 'audioIn'
  | 'audioOut'
  | 'cursor'
  | 'keyboard'
  | 'browser'
  | 'displayOverlay'
  | 'commandChannel';

/**
 * Access mode for a resource.
 * - `exclusive`: only one lease holder at a time.
 * - `shared`: any number of holders may coexist.
 */
export type AccessMode = 'exclusive' | 'shared';

/** A single declared resource requirement. */
export interface Capability {
  resource: Resource;
  mode: AccessMode;
}

/** Convenience constructor for a capability. */
export function cap(resource: Resource, mode: AccessMode): Capability {
  return { resource, mode };
}
