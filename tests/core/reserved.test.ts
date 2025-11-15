import { describe, expect, it } from 'vitest';

import {
  assertNoReservedKeys,
  isReservedFieldPath,
  isReservedTopLevelField,
  RESERVED_FIELD_PATHS,
} from '../../src/core/reserved';

describe('reserved fields', () => {
  it('detects top-level reserved fields', () => {
    expect(isReservedTopLevelField('eventKey')).toBe(true);
    expect(isReservedTopLevelField('fields')).toBe(true);
    expect(isReservedTopLevelField('customField')).toBe(false);
  });

  it('detects nested reserved paths', () => {
    expect(isReservedFieldPath('_validation.missingFields')).toBe(true);
    expect(isReservedFieldPath('_perf.heapUsed')).toBe(true);
    expect(isReservedFieldPath('fields.port')).toBe(false);
  });

  it('finds reserved keys within objects', () => {
    const invalid = assertNoReservedKeys({ eventKey: 'x', custom: 1, _perf: 'bad' });

    expect(invalid).toEqual(['eventKey', '_perf']);
  });

  it('captures the reference set for documentation', () => {
    expect(RESERVED_FIELD_PATHS.has('eventKey')).toBe(true);
    expect(RESERVED_FIELD_PATHS.has('_validation.multipleCompletes')).toBe(true);
    // @ts-expect-error testing non-existent key
    expect(RESERVED_FIELD_PATHS.has('custom')).toBe(false);
  });
});
