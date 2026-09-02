import { describe, it, expect } from 'vitest';
import { normalizeDate, normalizeTime, isValidSlot, SLOTS } from './datetime';

// A fixed reference so "forward date" resolution and weekday math are
// deterministic. 2026-09-02 is a Wednesday.
const REF = new Date('2026-09-02T12:00:00');

describe('normalizeDate', () => {
  it('resolves an explicit calendar date to YYYY-MM-DD', () => {
    expect(normalizeDate('October 3, 2026', REF)).toBe('2026-10-03');
  });

  it('resolves a bare weekday forward from the reference date', () => {
    // The Friday after Wed 2026-09-02 is 2026-09-04.
    expect(normalizeDate('Friday', REF)).toBe('2026-09-04');
  });

  it('resolves "tomorrow" relative to the reference date', () => {
    expect(normalizeDate('tomorrow', REF)).toBe('2026-09-03');
  });

  it('returns null for text with no parseable date', () => {
    expect(normalizeDate('sometime soonish', REF)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(normalizeDate('', REF)).toBeNull();
  });
});

describe('normalizeTime', () => {
  it('maps an on-the-hour time to its exact slot', () => {
    expect(normalizeTime('2 PM', REF)).toBe('02:00 PM');
    expect(normalizeTime('9am', REF)).toBe('09:00 AM');
  });

  it('resolves "noon" to the 12:00 PM slot', () => {
    expect(normalizeTime('noon', REF)).toBe('12:00 PM');
  });

  it('snaps an off-slot time to the nearest slot within tolerance', () => {
    // 4:15 PM is 15 minutes from 04:00 PM (<= 30 tolerance).
    expect(normalizeTime('4:15 PM', REF)).toBe('04:00 PM');
    // 1:40 PM is 20 minutes from 02:00 PM.
    expect(normalizeTime('1:40 PM', REF)).toBe('02:00 PM');
  });

  it('returns null for a time outside business hours', () => {
    // 7 PM (19:00) is 120 min from the last slot (05:00 PM) — beyond tolerance.
    expect(normalizeTime('7 PM', REF)).toBeNull();
    // 8 AM is 60 min before the first slot (09:00 AM).
    expect(normalizeTime('8 AM', REF)).toBeNull();
  });

  it('returns null when no time is present in the text', () => {
    expect(normalizeTime('next Tuesday', REF)).toBeNull();
    expect(normalizeTime('', REF)).toBeNull();
  });
});

describe('isValidSlot', () => {
  it('accepts every canonical slot', () => {
    for (const slot of SLOTS) {
      expect(isValidSlot(slot)).toBe(true);
    }
  });

  it('rejects a well-formed but non-bookable time', () => {
    expect(isValidSlot('02:30 PM')).toBe(false);
    expect(isValidSlot('06:00 PM')).toBe(false);
    expect(isValidSlot('2 PM')).toBe(false);
  });
});
