/**
 * @aah/coordinator — Mediator + mode state machines.
 *
 * Resolves semantic/control conflicts that the kernel's Resource Arbiter escalates.
 */

export { ModeCoordinator } from './mode-coordinator.js';
export { ModeStateMachine, type ModeTransition } from './mode-state-machine.js';
