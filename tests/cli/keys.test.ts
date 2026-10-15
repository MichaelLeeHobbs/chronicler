import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildLockfile,
  diffLockfiles,
  formatDiff,
  formatKeyList,
  isBreaking,
  type KeyLockfile,
  parseLockfile,
  readLockfile,
  serializeLockfile,
  writeLockfile,
} from '../../src/cli/keys';
import { parseEventsFile, parseEventsModule } from '../../src/cli/parser/runtime-parser';
import { defineEvents, event, field, span } from '../../src/index';

const lockOf = (catalog: object): KeyLockfile => buildLockfile(parseEventsModule({ catalog }));

const base = defineEvents({
  user: {
    login: event({
      level: 'audit',
      message: 'Login',
      fields: { userId: field.string(), ip: field.string().optional() },
    }),
    logout: event({ level: 'info', message: 'Logout' }),
  },
  job: span({ events: { step: event({ level: 'debug', message: 'Step' }) } }),
});

describe('keys lockfile', () => {
  describe('buildLockfile', () => {
    it('lists every key, including lifecycle keys, sorted, with level and fields', () => {
      const lock = lockOf(base);

      expect(lock.version).toBe(1);
      expect(Object.keys(lock.events)).toEqual([
        'job.complete',
        'job.fail',
        'job.start',
        'job.step',
        'job.timeout',
        'user.login',
        'user.logout',
      ]);
      expect(lock.events['user.login']).toEqual({
        level: 'audit',
        fields: {
          ip: { type: 'string', required: false },
          userId: { type: 'string', required: true },
        },
      });
      expect(lock.events['job.fail']).toEqual({
        level: 'error',
        fields: {
          duration: { type: 'number', required: false },
          error: { type: 'error', required: false },
        },
      });
      expect(lock.events['user.logout']).toEqual({ level: 'info', fields: {} });
    });

    it('builds the lockfile from a fixture file (cross-copy catalog)', async () => {
      const lock = buildLockfile(
        await parseEventsFile(path.join(__dirname, 'fixtures/docs-events.ts')),
      );

      expect(Object.keys(lock.events)).toHaveLength(12);
      expect(lock.events['app.healthCheck']).toEqual({ level: 'debug', fields: {} });
      expect(lock.events['billing.charge']?.fields.amount).toEqual({
        type: 'number',
        required: true,
      });
    });
  });

  describe('serializeLockfile', () => {
    it('is stable regardless of definition order', () => {
      const reordered = defineEvents({
        job: span({ events: { step: event({ level: 'debug', message: 'Step' }) } }),
        user: {
          logout: event({ level: 'info', message: 'Logout' }),
          login: event({
            level: 'audit',
            message: 'Login',
            fields: { ip: field.string().optional(), userId: field.string() },
          }),
        },
      });

      expect(serializeLockfile(lockOf(reordered))).toBe(serializeLockfile(lockOf(base)));
    });

    it('writes 2-space JSON with a trailing newline', () => {
      const text = serializeLockfile(lockOf(base));

      expect(text.endsWith('}\n')).toBe(true);
      expect(text).toContain('\n  "version": 1,\n  "events": {\n    "job.complete": {');
      expect(text).not.toContain('\r\n');
    });

    it('honors CRLF line endings', () => {
      const text = serializeLockfile(lockOf(base), 'crlf');

      expect(text).toContain('\r\n');
      expect(/(?<!\r)\n/.test(text)).toBe(false);
      expect(parseLockfile(text, 'lock.json')).toEqual(lockOf(base));
    });
  });

  describe('parseLockfile', () => {
    it('rejects invalid JSON', () => {
      expect(() => parseLockfile('{', 'lock.json')).toThrow(/lock.json is not valid JSON/);
    });

    it('rejects an unknown shape or version', () => {
      expect(() => parseLockfile('{"version":2,"events":{}}', 'lock.json')).toThrow(
        /not a Chronicler key lockfile/,
      );
      expect(() => parseLockfile('[]', 'lock.json')).toThrow(/not a Chronicler key lockfile/);
    });

    it('rejects malformed entries', () => {
      const text = JSON.stringify({ version: 1, events: { a: { level: 'info' } } });
      expect(() => parseLockfile(text, 'lock.json')).toThrow(/entry "a"/);
    });
  });

  describe('readLockfile / writeLockfile', () => {
    const baseTmp = path.join(__dirname, '../__temp__');
    let dir: string;

    beforeEach(() => {
      fs.mkdirSync(baseTmp, { recursive: true });
      dir = fs.mkdtempSync(path.join(baseTmp, 'keys-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('returns undefined when the lockfile does not exist', () => {
      expect(readLockfile(path.join(dir, 'missing.json'))).toBeUndefined();
    });

    it('round-trips, creating directories as needed', () => {
      const file = path.join(dir, 'nested/chronicler.lock.json');
      writeLockfile(file, lockOf(base), 'crlf');

      expect(fs.readFileSync(file, 'utf-8')).toContain('\r\n');
      expect(readLockfile(file)).toEqual(lockOf(base));
    });
  });

  describe('diffLockfiles', () => {
    const diffAgainstBase = (catalog: object) => diffLockfiles(lockOf(base), lockOf(catalog));

    it('reports no changes for the same catalog', () => {
      const diff = diffAgainstBase(base);

      expect(diff).toEqual({ added: [], removed: [], changed: [], extended: [] });
      expect(isBreaking(diff)).toBe(false);
      expect(formatDiff(diff)).toBe('No changes.');
    });

    it('treats a rename as removed + added (breaking), including lifecycle keys', () => {
      const renamed = defineEvents({
        user: base.user,
        batch: span({ events: { step: event({ level: 'debug', message: 'Step' }) } }),
      });

      const diff = diffAgainstBase(renamed);

      expect(diff.removed).toEqual([
        'job.complete',
        'job.fail',
        'job.start',
        'job.step',
        'job.timeout',
      ]);
      expect(diff.added).toEqual([
        'batch.complete',
        'batch.fail',
        'batch.start',
        'batch.step',
        'batch.timeout',
      ]);
      expect(isBreaking(diff)).toBe(true);
    });

    it('keeps a key stable across a rename with a key override', () => {
      const renamed = defineEvents({
        user: base.user,
        batch: span({
          key: 'job',
          events: { step: event({ level: 'debug', message: 'Step' }) },
        }),
      });

      expect(isBreaking(diffAgainstBase(renamed))).toBe(false);
    });

    it('passes when keys are only added', () => {
      const extended = defineEvents({
        ...base,
        audit: { exported: event({ level: 'audit', message: 'Exported' }) },
      });

      const diff = diffAgainstBase(extended);

      expect(diff.added).toEqual(['audit.exported']);
      expect(isBreaking(diff)).toBe(false);
      expect(formatDiff(diff)).toBe('Non-breaking changes:\n  added: audit.exported');
    });

    it('reports level, field type, required-ness and removed fields as breaking', () => {
      const changed = defineEvents({
        user: {
          login: event({
            level: 'info',
            message: 'Login',
            fields: { userId: field.number(), ip: field.string() },
          }),
          logout: event({ level: 'info', message: 'Logout' }),
        },
        job: span({
          events: {
            step: event({ level: 'debug', message: 'Step', fields: { n: field.number() } }),
          },
        }),
      });
      const removedField = defineEvents({
        user: {
          login: event({ level: 'audit', message: 'Login', fields: { userId: field.string() } }),
          logout: base.user.logout,
        },
        job: base.job,
      });

      const diff = diffAgainstBase(changed);

      expect(diff.changed).toEqual([
        {
          key: 'user.login',
          changes: [
            'level audit → info',
            'field "ip": string, optional → string',
            'field "userId": string → number',
          ],
        },
      ]);
      expect(diff.extended).toEqual([{ key: 'job.step', changes: ['field "n" added (number)'] }]);
      expect(isBreaking(diff)).toBe(true);
      expect(diffAgainstBase(removedField).changed).toEqual([
        { key: 'user.login', changes: ['field "ip" removed'] },
      ]);
      expect(formatDiff(diff)).toBe(
        [
          'Breaking changes:',
          '  changed: user.login (level audit → info; field "ip": string, optional → string; field "userId": string → number)',
          'Non-breaking changes:',
          '  extended: job.step (field "n" added (number))',
        ].join('\n'),
      );
    });
  });

  describe('formatKeyList', () => {
    it('prints one line per key with level and fields', () => {
      const lines = formatKeyList(lockOf(base)).split('\n');

      expect(lines).toHaveLength(7);
      expect(lines).toContain('user.login [audit] { ip?: string, userId: string }');
      expect(lines).toContain('user.logout [info]');
      expect(lines).toContain('job.fail [error] { duration?: number, error?: error }');
    });
  });
});
