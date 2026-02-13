import { describe, expect, it } from 'vitest';

import { defineEvent } from '../../src/core/events';
import { t } from '../../src/core/fields';
import { validateFields } from '../../src/core/validation';

describe('validateFields', () => {
  const event = defineEvent({
    key: 'system.test',
    level: 'info',
    message: 'msg',
    doc: 'doc',
    fields: {
      requiredString: t.string().doc('req'),
      optionalNumber: t.number().optional().doc('opt'),
      errorField: t.error().optional().doc('err'),
    },
  } as const);

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

  it('rejects non-Error objects as type errors for error fields', () => {
    const plainObject = { message: 'not an error' };

    const result = validateFields(event, {
      requiredString: 'ok',
      errorField: plainObject,
    });

    expect(result.typeErrors).toEqual(['errorField']);
    expect(result.normalizedFields.errorField).toBeUndefined();
  });
});
