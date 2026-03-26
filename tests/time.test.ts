import { describe, it, expect } from 'vitest';
import { parseDuration, formatDuration } from '../src/utils/time.js';

describe('parseDuration', () => {
  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
  });

  it('parses hours', () => {
    expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
  });

  it('parses combined hours and minutes', () => {
    expect(parseDuration('1h30m')).toBe(90 * 60 * 1000);
  });

  it('parses bare number as minutes', () => {
    expect(parseDuration('45')).toBe(45 * 60 * 1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('abc')).toThrow('Invalid duration');
  });

  it('throws on zero duration', () => {
    expect(() => parseDuration('0')).toThrow('positive');
  });

  it('trims whitespace', () => {
    expect(parseDuration('  30m  ')).toBe(30 * 60 * 1000);
  });
});

describe('formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(30 * 60 * 1000)).toBe('30m');
  });

  it('formats hours only', () => {
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m');
  });
});
