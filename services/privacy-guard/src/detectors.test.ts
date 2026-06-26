/**
 * Unit tests for the pure privacy-risk detector core (no I/O, no models).
 *
 * Ported from the original Python `test_scanning.py`: each detector is exercised in
 * isolation, then the {@link PrivacyGuard} aggregate is checked for de-duplication and
 * severity ordering. A valid Luhn card number (`4111 1111 1111 1111`) is used so the
 * card detector fires; an invalid run is used to prove it does not.
 */

import { describe, expect, it } from 'vitest';
import {
  CreditCardDetector,
  decisionFor,
  defaultDetectors,
  FaceLeakDetector,
  LocationMetadataDetector,
  luhnOk,
  PrivacyGuard,
  shareScene,
} from './detectors.js';

describe('individual detectors', () => {
  it('flags on-screen secrets as block', () => {
    const guard = new PrivacyGuard([defaultDetectors()[0]]);
    const findings = guard.assess(shareScene({ text: 'login password: hunter2' }));
    expect(findings).toEqual([
      {
        key: 'secret',
        text: "This image shows a password or secret key — don't share it.",
        severity: 'block',
      },
    ]);
  });

  it('flags a Luhn-valid card number as block', () => {
    const finding = new CreditCardDetector().inspect(
      shareScene({ source: 'screenshot', text: 'card 4111 1111 1111 1111 exp' }),
    );
    expect(finding).toMatchObject({ key: 'credit-card', severity: 'block' });
    expect(finding?.text).toContain('screenshot');
  });

  it('ignores a digit run that fails the Luhn check', () => {
    expect(new CreditCardDetector().inspect(shareScene({ text: '1234 5678 9012 3456' }))).toBeNull();
    expect(luhnOk('1234567890123456')).toBe(false);
    expect(luhnOk('4111111111111111')).toBe(true);
  });

  it('flags a government ID shape as block', () => {
    const guard = new PrivacyGuard();
    const findings = guard.assess(shareScene({ text: 'SSN 123-45-6789 on file' }));
    expect(findings.map((f) => f.key)).toContain('gov-id');
    expect(findings.find((f) => f.key === 'gov-id')?.severity).toBe('block');
  });

  it('flags emails and phone numbers as warn', () => {
    const email = new PrivacyGuard().assess(shareScene({ text: 'reach me at a@b.com' }));
    expect(email).toEqual([
      { key: 'email', text: 'This image shows an email address.', severity: 'warn' },
    ]);
    const phone = new PrivacyGuard().assess(shareScene({ text: 'call 555-123-4567 today' }));
    expect(phone.map((f) => f.key)).toEqual(['phone']);
  });

  it('describes faces with singular/plural text', () => {
    const one = new FaceLeakDetector().inspect(shareScene({ source: 'photo', faceCount: 1 }));
    expect(one?.text).toBe('This photo shows a person — sharing may reveal their identity.');
    const many = new FaceLeakDetector().inspect(shareScene({ source: 'photo', faceCount: 3 }));
    expect(many?.text).toContain('3 people');
    expect(new FaceLeakDetector().inspect(shareScene({ faceCount: 0 }))).toBeNull();
  });

  it('flags embedded GPS metadata as warn', () => {
    const finding = new LocationMetadataDetector().inspect(
      shareScene({ source: 'photo', hasLocationMetadata: true }),
    );
    expect(finding).toMatchObject({ key: 'location', severity: 'warn' });
  });
});

describe('PrivacyGuard aggregate', () => {
  it('returns nothing for a clean item', () => {
    expect(new PrivacyGuard().assess(shareScene({ text: 'nothing private here' }))).toEqual([]);
  });

  it('de-duplicates and orders block findings ahead of warns', () => {
    const findings = new PrivacyGuard().assess(
      shareScene({ text: 'password: x email a@b.com', faceCount: 2 }),
    );
    expect(findings.map((f) => f.key)).toEqual(['secret', 'email', 'faces']);
    expect(findings[0].severity).toBe('block');
  });
});

describe('decisionFor', () => {
  it('maps findings to the overall decision', () => {
    expect(decisionFor([])).toBe('allow');
    expect(decisionFor([{ key: 'email', text: '', severity: 'warn' }])).toBe('warn');
    expect(
      decisionFor([
        { key: 'email', text: '', severity: 'warn' },
        { key: 'secret', text: '', severity: 'block' },
      ]),
    ).toBe('block');
  });
});
