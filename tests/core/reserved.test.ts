import { describe, expect, it } from 'vitest';

import {
  assertNoReservedKeys,
  isReservedTopLevelField,
  RESERVED_TOP_LEVEL_FIELDS,
} from '../../src/core/reserved';

describe('reserved fields', () => {
  it('detects top-level reserved fields', () => {
    expect(isReservedTopLevelField('eventKey')).toBe(true);
    expect(isReservedTopLevelField('fields')).toBe(true);
    expect(isReservedTopLevelField('_validation')).toBe(true);
    expect(isReservedTopLevelField('customField')).toBe(false);
  });

  it.each(['parentCorrelationId', 'rootCorrelationId', 'correlationState', 'correlationId'])(
    'reserves the payload field %s',
    (name) => {
      expect(RESERVED_TOP_LEVEL_FIELDS).toContain(name);
      expect(isReservedTopLevelField(name)).toBe(true);
    },
  );

  it('finds reserved keys within objects', () => {
    const invalid = assertNoReservedKeys({ eventKey: 'x', custom: 1, rootCorrelationId: 'y' });

    expect(invalid).toEqual(['eventKey', 'rootCorrelationId']);
  });
});
