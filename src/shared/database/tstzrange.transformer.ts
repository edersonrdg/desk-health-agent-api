import { ValueTransformer } from 'typeorm';

/** A half-open `[start, end)` time range, stored as `tstzrange`. */
export interface TimeRange {
  start: Date;
  end: Date;
}

// Postgres prints bounded ranges as ["2026-09-24 10:00:00+00","…"), quoting
// each bound because it contains spaces.
const RANGE_LITERAL = /^\[("?)([^",]+)\1,("?)([^",]+)\3\)$/;

export function formatTimeRange({ start, end }: TimeRange): string {
  if (!(end.getTime() > start.getTime())) {
    throw new Error('Time range end must be after its start');
  }
  return `[${start.toISOString()},${end.toISOString()})`;
}

export function parseTimeRange(literal: string): TimeRange {
  const match = RANGE_LITERAL.exec(literal);
  if (!match) {
    throw new Error('Unsupported tstzrange value: expected a bounded [) range');
  }
  return { start: parseTimestamp(match[2]), end: parseTimestamp(match[4]) };
}

/** ISO-style Postgres timestamptz output ("2026-09-24 10:00:00.5-03"). */
function parseTimestamp(value: string): Date {
  const iso = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2}:\d{2}):\d{2}$/, '$1');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Unsupported timestamp in tstzrange value');
  }
  return date;
}

export const tstzRangeTransformer: ValueTransformer = {
  to: (value: TimeRange | null | undefined) =>
    value == null ? value : formatTimeRange(value),
  from: (value: string | null) =>
    value === null ? null : parseTimeRange(value),
};
