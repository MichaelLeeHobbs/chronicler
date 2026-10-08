import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateDocs } from '../../src/cli/generator/docs-generator';
import { buildLockfile, diffLockfiles, formatDiff, isBreaking } from '../../src/cli/keys';
import { parseEventsModule } from '../../src/cli/parser/runtime-parser';
import { formatFieldType } from '../../src/cli/types';
import { defineEvents, event, field, type FieldDefs } from '../../src/index';

const catalogWith = (fields: FieldDefs) =>
  defineEvents({ user: { login: event({ level: 'audit', message: 'Login', fields }) } });

const catalog = catalogWith({
  outcome: field.enum(['success', 'failure']).doc('Result'),
  roles: field.array(field.string()).optional(),
  states: field.array(field.enum(['a', 'b'])).optional(),
  email: field.string().sensitive().doc('Email'),
});

const parse = (c: object) => parseEventsModule({ catalog: c });
const lockOf = (c: object) => buildLockfile(parse(c));

describe('CLI field types', () => {
  it('parses enum values, array item types and the sensitive flag', () => {
    const fields = parse(catalog).events[0]!.fields;
    expect(fields.outcome).toEqual({
      type: 'enum',
      required: true,
      doc: 'Result',
      sensitive: false,
      values: ['success', 'failure'],
    });
    expect(fields.roles).toMatchObject({ type: 'array', items: 'string' });
    expect(fields.states).toMatchObject({ type: 'array', items: 'enum', values: ['a', 'b'] });
    expect(fields.email).toMatchObject({ type: 'string', sensitive: true });
  });

  it('formats display types', () => {
    const fields = parse(catalog).events[0]!.fields;
    expect(formatFieldType(fields.outcome!)).toBe("'success' | 'failure'");
    expect(formatFieldType(fields.roles!)).toBe('string[]');
    expect(formatFieldType(fields.states!)).toBe("('a' | 'b')[]");
    expect(formatFieldType(fields.email!)).toBe('string');
  });

  describe('markdown docs', () => {
    let dir: string;
    beforeEach(() => {
      const baseTmp = path.join(__dirname, '../__temp__');
      fs.mkdirSync(baseTmp, { recursive: true });
      dir = fs.mkdtempSync(path.join(baseTmp, 'field-types-'));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('shows display types and the sensitive flag', () => {
      const outputPath = path.join(dir, 'events.md');
      generateDocs(parse(catalog), {
        eventsFile: './x.ts',
        docs: { format: 'markdown', outputPath },
      });
      const md = fs.readFileSync(outputPath, 'utf-8');
      expect(md).toContain("- **`outcome`** (`'success' | 'failure'`, required): Result");
      expect(md).toContain('- **`email`** (`string`, required, sensitive): Email');
      expect(md).toContain("- **`states`** (`('a' | 'b')[]`, optional)");
    });
  });

  describe('lockfile', () => {
    it('records values, array item types and sensitivity', () => {
      expect(lockOf(catalog).events['user.login']?.fields).toEqual({
        email: { type: 'string', required: true, sensitive: true },
        outcome: { type: 'enum', required: true, values: ['failure', 'success'] },
        roles: { type: 'string[]', required: false },
        states: { type: 'enum[]', required: false, values: ['a', 'b'] },
      });
    });

    it('treats added enum values as non-breaking and removed ones as breaking', () => {
      const before = lockOf(catalogWith({ outcome: field.enum(['success', 'failure']) }));
      const added = diffLockfiles(
        before,
        lockOf(catalogWith({ outcome: field.enum(['success', 'failure', 'locked']) })),
      );
      expect(isBreaking(added)).toBe(false);
      expect(formatDiff(added)).toContain(`field "outcome": values added ('locked')`);

      const removed = diffLockfiles(
        before,
        lockOf(catalogWith({ outcome: field.enum(['success']) })),
      );
      expect(isBreaking(removed)).toBe(true);
      expect(formatDiff(removed)).toContain(`field "outcome": values removed ('failure')`);
    });

    it('treats dropping or adding .sensitive() as breaking', () => {
      const plain = lockOf(catalogWith({ email: field.string() }));
      const sensitive = lockOf(catalogWith({ email: field.string().sensitive() }));
      expect(formatDiff(diffLockfiles(sensitive, plain))).toContain(
        'field "email": string, sensitive → string',
      );
      expect(isBreaking(diffLockfiles(plain, sensitive))).toBe(true);
    });

    it('treats a changed array item type as breaking', () => {
      const diff = diffLockfiles(
        lockOf(catalogWith({ roles: field.array(field.string()) })),
        lockOf(catalogWith({ roles: field.array(field.number()) })),
      );
      expect(formatDiff(diff)).toContain('field "roles": string[] → number[]');
    });
  });
});
