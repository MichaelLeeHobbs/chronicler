import { describe, expect, it } from 'vitest';

import { assertNoReservedKeys, isReservedTopLevelField } from '../../src/core/reserved';

describe('reserved fields', () => {
  it('detects top-level reserved fields', () => {
    expect(isReservedTopLevelField('eventKey')).toBe(true);
    expect(isReservedTopLevelField('fields')).toBe(true);
    expect(isReservedTopLevelField('_validation')).toBe(true);
    expect(isReservedTopLevelField('customField')).toBe(false);
  });

  it('finds reserved keys within objects', () => {
    const invalid = assertNoReservedKeys({ eventKey: 'x', custom: 1 });

    expect(invalid).toEqual(['eventKey']);
  });
});
