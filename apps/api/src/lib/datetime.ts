import * as chrono from 'chrono-node';

// Canonical bookable slots — must stay in sync with
// BookingService.checkAvailability (the source of truth for availability).
export const SLOTS = [
  '09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM',
] as const;

const SLOT_SNAP_TOLERANCE_MIN = 30;

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse a natural-language date ("Tuesday", "October 3") to 'YYYY-MM-DD', or null. */
export function normalizeDate(text: string, ref: Date = new Date()): string | null {
  if (!text) return null;
  const d = chrono.parseDate(text, ref, { forwardDate: true });
  if (!d || isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse a natural-language time ("2 PM", "4:15") and snap it to the nearest
 * bookable slot. Returns null if no time is found or it falls outside business
 * hours (further than the snap tolerance from any slot).
 */
export function normalizeTime(text: string, ref: Date = new Date()): string | null {
  if (!text) return null;
  for (const r of chrono.parse(text, ref)) {
    if (r.start.isCertain('hour')) {
      const hour = r.start.get('hour') ?? 0;
      const minute = r.start.get('minute') ?? 0;
      return snapToSlot(hour * 60 + minute);
    }
  }
  return null;
}

export function isValidSlot(time: string): boolean {
  return (SLOTS as readonly string[]).includes(time);
}

function snapToSlot(targetMinutes: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const slot of SLOTS) {
    const dist = Math.abs(slotToMinutes(slot) - targetMinutes);
    if (dist < bestDist) {
      bestDist = dist;
      best = slot;
    }
  }
  return bestDist <= SLOT_SNAP_TOLERANCE_MIN ? best : null;
}

function slotToMinutes(slot: string): number {
  const m = slot.match(/^(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m) return NaN;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3] === 'PM' && h !== 12) h += 12;
  if (m[3] === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}
