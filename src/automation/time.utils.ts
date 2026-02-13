/* eslint-disable prettier/prettier */

export type Slot = 'MORNING' | 'AFTERNOON' | 'EVENING';

const SLOT_HOURS_ET: Record<Slot, number> = {
  MORNING: 9,
  AFTERNOON: 13,
  EVENING: 18,
};

// Convert "now" into the date parts in a target timezone
function getTzParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value);

  return { year, month, day };
}

/**
 * Returns a Date representing "today at HH:00:00" in the given timezone.
 * Implementation uses timezone date parts + local "ET offset at that moment" trick.
 * This is reliable enough for scheduling keys & idempotency.
 */
export function scheduledForSlot(slot: Slot, timeZone = 'America/New_York', now = new Date()) {
  const hour = SLOT_HOURS_ET[slot];
  const { year, month, day } = getTzParts(now, timeZone);

  // Build a UTC date matching the timezone's YYYY-MM-DD at hour:00.
  // We compute what that local wall time corresponds to in UTC by finding timezone offset.
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));

  // Get the timezone offset at that wall time by comparing formatted hour in timezone vs UTC guess
  // We do it by formatting both and computing delta. Simple + effective for our case.
  const tzHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(utcGuess),
  );

  // If tzHour differs from intended hour, adjust by that diff
  const diffHours = hour - tzHour;
  const corrected = new Date(utcGuess.getTime() + diffHours * 60 * 60 * 1000);

  // Normalize minutes/seconds/millis
  corrected.setUTCMinutes(0, 0, 0);
  return corrected;
}
