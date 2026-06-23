/**
 * @aah/contracts — the single source of truth for the service interface,
 * capability manifests, events, and health types shared across the hub.
 *
 * NOTE: In the full build these TS types are generated from Protobuf / JSON Schema
 * alongside the Python types (see ./schema and ../python). Here they are authored
 * by hand to define the shape.
 */

export * from './capability.js';
export * from './health.js';
export * from './events.js';
export * from './service.js';
