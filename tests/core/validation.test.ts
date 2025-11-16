import { describe, expect, it } from 'vitest';

import { defineEvent } from '../../src/core/events';
import { validateFields } from '../../src/core/validation';

describe('validateFields', () => {
  const event = defineEvent({
    key: 'system.test',
    level: 'info',
    message: 'msg',
    doc: 'doc',
    fields: {
      requiredString: { type: 'string', required: true, doc: 'req' },
      optionalNumber: { type: 'number', required: false, doc: 'opt' },
      errorField: { type: 'error', required: false, doc: 'err' },
    },
  });

  it('captures missing required fields', () => {
    const result = validateFields(event, { optionalNumber: 5 } as unknown as {
      requiredString: string;
    });

    expect(result.missingFields).toEqual(['requiredString']);
    expect(result.typeErrors).toEqual([]);
  });

  it('captures type errors', () => {
    const result = validateFields(event, {
      requiredString: 'ok',
      optionalNumber: 'bad',
    } as unknown as { requiredString: string; optionalNumber: number });

    expect(result.typeErrors).toEqual(['optionalNumber']);
  });

  it('normalizes error fields with stderr', () => {
    const result = validateFields(event, {
      requiredString: 'ok',
      errorField: new Error('boom'),
    });

    expect(result.normalizedFields.errorField).toContain('boom');
  });

  it('preserves string error inputs as-is', () => {
    const result = validateFields(event, {
      requiredString: 'ok',
      errorField: 'textual failure',
    });

    expect(result.normalizedFields.errorField).toContain('textual failure');
  });

  it('serializes complex error-like objects without throwing', () => {
    const circular: { message: string; self?: unknown } = { message: 'loop' };
    circular.self = circular;

    const result = validateFields(event, {
      requiredString: 'ok',
      errorField: circular,
    });

    expect(typeof result.normalizedFields.errorField).toBe('string');
    expect((result.normalizedFields.errorField as string).length).toBeGreaterThan(0);
  });
});
