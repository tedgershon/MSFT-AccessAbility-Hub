export interface WindowsEyeControlIntegration {
  readonly mode: 'external-os-control';
  readonly settingsPath: string;
  readonly purpose: string;
  readonly hubBehavior: string;
  readonly setupSteps: readonly string[];
}

/**
 * Windows Eye Control is an OS-level assistive control surface, not a library the
 * Electron shell can silently turn on. The hub exposes this descriptor so the
 * renderer can show a dwell-friendly setup tile while still supporting the native
 * Eye Control launchpad as a fallback controller for the hub itself.
 */
export const windowsEyeControlIntegration: WindowsEyeControlIntegration = {
  mode: 'external-os-control',
  settingsPath: 'Settings > Accessibility > Interaction > Eye control',
  purpose: 'Use Windows Eye Control for OS cursor, dwell click, scrolling, keyboard, and TTS.',
  hubBehavior:
    'Keep hub controls large and dwell-friendly; route app-specific gaze actions through gaze-dwell.',
  setupSteps: [
    'Connect and calibrate a Windows-compatible eye tracker.',
    'Open Settings > Accessibility > Interaction > Eye control.',
    'Turn on Eye control and use the launchpad to interact with AccessAbility Hub.',
    'Use the hub gaze-dwell mode when you want hub-orchestrated actions instead of OS-level control.',
  ],
};
