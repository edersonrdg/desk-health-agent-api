import {
  formatTimeRange,
  parseTimeRange,
  tstzRangeTransformer,
} from './tstzrange.transformer';

describe('tstzrange transformer', () => {
  const start = new Date('2026-09-24T13:00:00.000Z');
  const end = new Date('2026-09-24T13:30:00.000Z');

  it('formats a half-open range', () => {
    expect(formatTimeRange({ start, end })).toBe(
      '[2026-09-24T13:00:00.000Z,2026-09-24T13:30:00.000Z)',
    );
  });

  it('rejects an empty or inverted range', () => {
    expect(() => formatTimeRange({ start, end: start })).toThrow(
      'end must be after',
    );
    expect(() => formatTimeRange({ start: end, end: start })).toThrow(
      'end must be after',
    );
  });

  it.each([
    ['["2026-09-24 13:00:00+00","2026-09-24 13:30:00+00")'],
    ['["2026-09-24 10:00:00-03","2026-09-24 10:30:00-03")'],
    ['["2026-09-24 18:30:00+05:30","2026-09-24 19:00:00+05:30")'],
    ['[2026-09-24T13:00:00.000Z,2026-09-24T13:30:00.000Z)'],
  ])('parses Postgres output %s', (literal) => {
    expect(parseTimeRange(literal)).toEqual({ start, end });
  });

  it('keeps fractional seconds', () => {
    expect(
      parseTimeRange('["2026-09-24 13:00:00.25+00","2026-09-24 13:30:00+00")')
        .start,
    ).toEqual(new Date('2026-09-24T13:00:00.250Z'));
  });

  it.each([
    ['empty'],
    ['("2026-09-24 13:00:00+00","2026-09-24 13:30:00+00")'],
    ['["2026-09-24 13:00:00+00",)'],
    ['["not a date","2026-09-24 13:30:00+00")'],
  ])('rejects unsupported value %s', (literal) => {
    expect(() => parseTimeRange(literal)).toThrow('Unsupported');
  });

  it('passes null through', () => {
    expect(tstzRangeTransformer.to(null)).toBeNull();
    expect(tstzRangeTransformer.from(null)).toBeNull();
  });
});
