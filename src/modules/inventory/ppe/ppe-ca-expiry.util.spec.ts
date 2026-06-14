// ppe-ca-expiry.util.spec.ts
// Pure unit tests for the NR-6 CA-expiry rule that blocks EPI delivery (Part E).

import { isPpeCaExpired } from './ppe-ca-expiry.util';

describe('isPpeCaExpired (NR-6 CA-expiry block)', () => {
  const now = new Date(2026, 5, 13, 12, 0, 0); // 2026-06-13 noon

  it('is not expired when no CA expiry is tracked', () => {
    expect(isPpeCaExpired(null, now)).toBe(false);
    expect(isPpeCaExpired(undefined, now)).toBe(false);
  });

  it('is NOT expired on the expiry day itself (valid through end of day)', () => {
    expect(isPpeCaExpired(new Date(2026, 5, 13), now)).toBe(false);
  });

  it('is expired the day after the expiry date', () => {
    expect(isPpeCaExpired(new Date(2026, 5, 12), now)).toBe(true);
  });

  it('is not expired for a future CA', () => {
    expect(isPpeCaExpired(new Date(2027, 0, 1), now)).toBe(false);
  });

  it('accepts ISO string expiry dates', () => {
    expect(isPpeCaExpired('2025-01-01T00:00:00.000Z', now)).toBe(true);
    expect(isPpeCaExpired('2030-01-01T00:00:00.000Z', now)).toBe(false);
  });

  it('ignores invalid dates (treated as not expired)', () => {
    expect(isPpeCaExpired('not-a-date', now)).toBe(false);
  });
});
