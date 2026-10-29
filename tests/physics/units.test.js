import { describe, expect, it } from 'vitest';
import {
  auPerDayToKmPerSecond,
  auToKm,
  daysToSeconds,
  formatUTCDate,
  parseUTCDate,
  secondsToDays,
} from '../../src/physics/units.js';

describe('unit conversions', () => {
  it('converts days, seconds, AU, and AU/day using the declared constants', () => {
    expect(daysToSeconds(2.5)).toBe(216000);
    expect(secondsToDays(216000)).toBe(2.5);
    expect(auToKm(1)).toBe(149597870.7);
    expect(auPerDayToKmPerSecond(1)).toBeCloseTo(1731.45684, 5);
    expect(daysToSeconds(-1)).toBe(-86400);
    expect(auToKm(0)).toBe(0);
  });

  it('rejects non-finite and non-number conversion inputs', () => {
    for (const convert of [daysToSeconds, secondsToDays, auToKm, auPerDayToKmPerSecond]) {
      for (const invalid of [NaN, Infinity, -Infinity, '1', null]) {
        expect(() => convert(invalid)).toThrow(TypeError);
      }
    }
  });

  it('rejects finite inputs whose converted result overflows', () => {
    expect(() => daysToSeconds(Number.MAX_VALUE)).toThrow(RangeError);
    expect(() => auToKm(Number.MAX_VALUE)).toThrow(RangeError);
    expect(() => auPerDayToKmPerSecond(Number.MAX_VALUE)).toThrow(RangeError);
  });
});

describe('UTC date-only helpers', () => {
  it('parses exact calendar dates to UTC midnight and formats in UTC', () => {
    const leapDate = parseUTCDate('2024-02-29');
    expect(leapDate.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(formatUTCDate(leapDate)).toBe('2024-02-29');

    const nonUtcInstant = new Date('2024-01-01T23:30:00-02:00');
    expect(formatUTCDate(nonUtcInstant)).toBe('2024-01-02');
  });

  it('rejects malformed, ambiguous, local-time, and rolled-over dates', () => {
    for (const invalid of [
      '2024-2-09',
      '24-02-09',
      '2024/02/09',
      '2024-02-09T00:00:00Z',
      '2024-02-09 00:00',
      '2024-02-09\n',
      '2024-02-09\r',
      ' 2024-02-09',
      '2024-02-09 ',
      '2023-02-29',
      '2024-04-31',
      '2024-00-01',
      '2024-13-01',
    ]) {
      expect(() => parseUTCDate(invalid)).toThrow(RangeError);
    }
    expect(() => parseUTCDate(new Date())).toThrow(TypeError);
  });

  it('accepts the four-digit year endpoints and rejects unformattable dates', () => {
    expect(formatUTCDate(parseUTCDate('0000-01-01'))).toBe('0000-01-01');
    expect(formatUTCDate(parseUTCDate('9999-12-31'))).toBe('9999-12-31');
    expect(() => formatUTCDate(new Date(NaN))).toThrow(TypeError);
    expect(() => formatUTCDate(new Date('+010000-01-01T00:00:00Z'))).toThrow(RangeError);
    expect(() => formatUTCDate('2024-01-01')).toThrow(TypeError);
  });
});
