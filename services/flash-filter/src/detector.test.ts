import { describe, expect, it } from 'vitest';
import { FlashDetector, SENSITIVITY_PROFILES } from './detector.js';

describe('FlashDetector', () => {
  it('treats exactly the WCAG general threshold as safe', () => {
    const detector = new FlashDetector(SENSITIVITY_PROFILES.standard);
    const samples: Array<[number, number]> = [
      [0, 0],
      [1, 100],
      [0, 200],
      [1, 300],
      [0, 400],
      [1, 500],
      [0, 600],
      [1, 700],
    ];

    let reading = { flashesPerSecond: 0, risk: false };
    for (const [luminance, atMs] of samples) {
      reading = detector.sample(luminance, atMs);
    }

    expect(reading.flashesPerSecond).toBe(3);
    expect(reading.risk).toBe(false);
  });
});
