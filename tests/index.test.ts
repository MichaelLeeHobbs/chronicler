import { describe, expect, it, vi } from 'vitest';

import { createEntry, formatEntry } from '../src/index';

describe('chronicler core helpers', () => {
  it('creates entries with current timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const entry = createEntry('test');

    expect(entry).toMatchObject({
      message: 'test',
      data: undefined,
    });
    expect(entry.timestamp.toISOString()).toBe('2024-01-01T00:00:00.000Z');

    vi.useRealTimers();
  });

  it('formats entries with data payloads', () => {
    const entry = {
      timestamp: new Date('2024-01-01T00:00:00Z'),
      message: 'hello',
      data: { user: 'ada' },
    };

    expect(formatEntry(entry)).toBe('[2024-01-01T00:00:00.000Z] hello {"user":"ada"}');
  });
});
