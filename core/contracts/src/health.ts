/**
 * Health reporting types consumed by the kernel Supervisor.
 */

export type HealthState = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthStatus {
  state: HealthState;
  /** Human-readable detail for the shell / logs. */
  detail?: string;
  /** Epoch millis when this status was produced. */
  checkedAt: number;
}

export function healthy(detail?: string): HealthStatus {
  return { state: 'healthy', detail, checkedAt: Date.now() };
}

export function degraded(detail: string): HealthStatus {
  return { state: 'degraded', detail, checkedAt: Date.now() };
}

export function unhealthy(detail: string): HealthStatus {
  return { state: 'unhealthy', detail, checkedAt: Date.now() };
}
