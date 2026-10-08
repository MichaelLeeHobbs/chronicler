import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createChronicle } from '../../src/core/chronicle';
import { ChroniclerError } from '../../src/core/errors';
import { defineEvents, event, span } from '../../src/core/events';
import { field } from '../../src/core/fields';
import { REDACTED, type RedactionConfig } from '../../src/core/redaction';
import { MockLoggerBackend } from '../helpers/mock-logger';

const events = defineEvents({
  user: {
    created: event({
      level: 'info',
      message: 'created',
      fields: {
        userId: field.string(),
        email: field.string().sensitive().doc('Email'),
        phone: field.string().optional().sensitive(),
        tags: field.array(field.string()).sensitive().optional(),
      },
    }),
  },
  signup: span({
    complete: { email: field.string().sensitive() },
    events: {},
  }),
});

const build = (redact?: RedactionConfig) => {
  const mock = new MockLoggerBackend();
  const chronicle = createChronicle({
    events,
    backend: mock.backend,
    ...(redact ? { redact } : {}),
  });
  return { mock, chronicle };
};

describe('sensitive fields', () => {
  it('marks the builder', () => {
    expect(events.user.created.fields.email._sensitive).toBe(true);
    expect(events.user.created.fields.phone._sensitive).toBe(true);
    expect(events.user.created.fields.userId._sensitive).toBe(false);
  });

  it('masks by default', () => {
    const { mock, chronicle } = build();
    chronicle.user.created({ userId: 'u1', email: 'a@b.com', tags: ['x'] });
    expect(mock.getLastPayload()?.fields).toEqual({
      userId: 'u1',
      email: REDACTED,
      tags: REDACTED,
    });
  });

  it('still validates the original value', () => {
    const { mock, chronicle } = build();
    (chronicle.user.created as unknown as (f: Record<string, unknown>) => void)({
      userId: 'u1',
      email: 5,
    });
    expect(mock.getLastPayload()?.fields).toEqual({ userId: 'u1' });
    expect(mock.getLastPayload()?._validation).toEqual({ typeErrors: ['email'] });
  });

  it('hashes with an HMAC in hash mode', () => {
    const { mock, chronicle } = build({ mode: 'hash', hashKey: 'secret' });
    chronicle.user.created({ userId: 'u1', email: 'a@b.com' });
    chronicle.user.created({ userId: 'u2', email: 'a@b.com' });
    const expected = `hmac:${createHmac('sha256', 'secret').update('a@b.com').digest('hex')}`;
    const [first, second] = mock.getPayloads();
    expect(first?.fields.email).toBe(expected);
    expect(second?.fields.email).toBe(expected);
  });

  it('drops in drop mode', () => {
    const { mock, chronicle } = build({ mode: 'drop' });
    chronicle.user.created({ userId: 'u1', email: 'a@b.com' });
    expect(mock.getLastPayload()?.fields).toEqual({ userId: 'u1' });
  });

  it('redacts declared lifecycle fields', () => {
    const { mock, chronicle } = build();
    chronicle.signup.begin().complete({ email: 'a@b.com' });
    expect(mock.getLastPayload()?.fields).toMatchObject({ email: REDACTED });
  });

  it('requires a hashKey in hash mode', () => {
    expect(() => build({ mode: 'hash' })).toThrow(ChroniclerError);
    expect(() => build({ mode: 'hash', hashKey: '' })).toThrow(/hashKey/);
  });
});

describe('redact.keys', () => {
  it('redacts listed names in fields, untyped logs, undeclared fields and context', () => {
    const { mock, chronicle } = build({ keys: ['userId', 'ssn'] });
    chronicle.addContext({ userId: 'u1', region: 'us' });
    chronicle.user.created({ userId: 'u1', email: 'a@b.com' });
    expect(mock.getLastPayload()?.fields).toEqual({ userId: REDACTED, email: REDACTED });
    expect(mock.getLastPayload()?.metadata).toEqual({ userId: REDACTED, region: 'us' });

    chronicle.log('info', 'raw', { ssn: '123', ok: 1 });
    expect(mock.getLastPayload()?.fields).toEqual({ ssn: REDACTED, ok: 1 });

    (chronicle.user.created as unknown as (f: Record<string, unknown>) => void)({
      userId: 'u1',
      email: 'a@b.com',
      ssn: '123',
    });
    expect(mock.getLastPayload()?.fields.ssn).toBe(REDACTED);
  });

  it('leaves records alone when nothing matches', () => {
    const { mock, chronicle } = build({ keys: ['ssn'] });
    chronicle.log('info', 'raw', { ok: 1 });
    expect(mock.getLastPayload()?.fields).toEqual({ ok: 1 });
  });
});
