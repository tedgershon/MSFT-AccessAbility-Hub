---
applyTo: "adapters/**"
---

# Adapter rules

You are editing an **adapter** — a thin wrapper that hides one external dependency
(OpenCV, ClawPilot/MCP, a camera, audio, OS input injection) behind a narrow,
contract-shaped interface.

- **Wrap, don't decide.** Adapters expose capability; business logic belongs in
  services. Keep the surface small (Interface Segregation).
- **One language** per adapter, matching the dependency it wraps (Python for
  camera/audio/CV, TS for input injection / MCP).
- **Resource discipline.** Acquiring a device/handle corresponds to a lease the
  owning service holds; provide a clear `close()`/release path so the service can
  release in `onDisable()`.
- **Least privilege**, especially for ClawPilot computer-use: gate and audit; never
  widen permissions for convenience.
- The shared **input multiplexer** is the only path to the OS pointer/keyboard — do
  not add a second injection route.
