import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEventsFile, parseEventsModule } from '../../src/cli/parser/runtime-parser';
import { validateEventTree } from '../../src/cli/parser/validator';
import type { ParsedEvent, ParsedEventTree } from '../../src/cli/types';
import { defineEvents, event, field, span } from '../../src/index';

const fixturesPath = path.join(__dirname, 'fixtures');
const fixture = (name: string) => path.join(fixturesPath, name);

const makeEvent = (overrides: Partial<ParsedEvent> = {}): ParsedEvent => ({
  key: 'test.event',
  path: 'test.event',
  level: 'info',
  message: 'test',
  doc: 'test',
  fields: {},
  lifecycle: false,
  ...overrides,
});

const makeTree = (overrides: Partial<ParsedEventTree> = {}): ParsedEventTree => ({
  events: [],
  groups: [],
  rootEvents: [],
  catalogExports: ['events'],
  errors: [],
  ...overrides,
});

describe('Runtime Parser', () => {
  describe('parseEventsFile', () => {
    it('parses a valid catalog', async () => {
      const tree = await parseEventsFile(fixture('valid-events.ts'));

      expect(tree.errors).toHaveLength(0);
      expect(tree.catalogExports).toEqual(['events']);

      const startup = tree.events.find((e) => e.key === 'system.startup');
      expect(startup).toBeDefined();
      expect(startup?.level).toBe('info');
      expect(startup?.message).toBe('Application started');
      expect(startup?.fields.port).toEqual({ type: 'number', required: true, doc: 'Server port' });
      expect(startup?.fields.mode).toEqual({
        type: 'string',
        required: false,
        doc: 'Runtime mode',
      });
    });

    it('dedupes a catalog exported under two names (named + default)', async () => {
      const tree = await parseEventsFile(fixture('valid-events.ts'));

      expect(tree.catalogExports).toEqual(['events']);
      expect(tree.events.filter((e) => e.key === 'system.startup')).toHaveLength(1);
    });

    it('lists every event, including span lifecycle events', async () => {
      const tree = await parseEventsFile(fixture('valid-events.ts'));

      expect(tree.events.map((e) => e.key)).toEqual([
        'system.startup',
        'system.shutdown',
        'api.query.start',
        'api.query.complete',
        'api.query.fail',
        'api.query.timeout',
        'api.query.executed',
      ]);
      const lifecycle = tree.events.filter((e) => e.lifecycle);
      expect(lifecycle).toHaveLength(4);
      expect(lifecycle.every((e) => e.spanKey === 'api.query')).toBe(true);
    });

    it('builds namespaces with group() docs', async () => {
      const tree = await parseEventsFile(fixture('valid-events.ts'));

      const system = tree.groups.find((g) => g.key === 'system');
      expect(system?.kind).toBe('namespace');
      expect(system?.doc).toBe('System-level events');
      expect(Object.keys(system!.events)).toEqual(['startup', 'shutdown']);
    });

    it('nests spans with timeout and lifecycle events under their namespace', async () => {
      const tree = await parseEventsFile(fixture('valid-events.ts'));

      const api = tree.groups.find((g) => g.key === 'api');
      expect(api?.kind).toBe('namespace');
      expect(api?.doc).toBe('');

      const query = api!.groups.query!;
      expect(query.kind).toBe('span');
      expect(query.key).toBe('api.query');
      expect(query.doc).toBe('API query operations');
      expect(query.timeout).toBe(30000);
      expect(query.lifecycleEvents.map((e) => e.key)).toEqual([
        'api.query.start',
        'api.query.complete',
        'api.query.fail',
        'api.query.timeout',
      ]);
      expect(Object.keys(query.events)).toEqual(['executed']);
      expect(query.events.executed?.spanKey).toBe('api.query');
    });

    it('skips catalogs mounted inside another exported catalog', async () => {
      const tree = await parseEventsFile(fixture('docs-events.ts'));

      expect(tree.catalogExports).toEqual(['events']);
      expect(tree.events.filter((e) => e.key === 'billing.charge')).toHaveLength(1);
      expect(tree.events.some((e) => e.key === 'charge')).toBe(false);
    });

    it('uses the export named by exportName (eventsExport)', async () => {
      const tree = await parseEventsFile(fixture('docs-events.ts'), {
        exportName: 'billingEvents',
      });

      expect(tree.errors).toHaveLength(0);
      expect(tree.catalogExports).toEqual(['billingEvents']);
      expect(tree.events.map((e) => e.key)).toEqual(['charge']);
      expect(tree.rootEvents.map((e) => e.key)).toEqual(['charge']);
    });

    it('reports a missing eventsExport', async () => {
      const tree = await parseEventsFile(fixture('valid-events.ts'), { exportName: 'nope' });

      expect(tree.errors).toEqual([
        { type: 'parse-error', message: expect.stringContaining('"nope"') as string },
      ]);
    });

    it('reports an eventsExport that is not a catalog', async () => {
      const tree = await parseEventsFile(fixture('no-catalog.ts'), { exportName: 'notACatalog' });

      expect(tree.errors[0]?.type).toBe('parse-error');
      expect(tree.errors[0]?.message).toContain('not an event catalog');
    });

    it('reports a clear parse error when no catalog is exported', async () => {
      const tree = await parseEventsFile(fixture('no-catalog.ts'));

      expect(tree.events).toHaveLength(0);
      expect(tree.errors).toHaveLength(1);
      expect(tree.errors[0]?.type).toBe('parse-error');
      expect(tree.errors[0]?.message).toContain('No event catalog exported');
      expect(tree.errors[0]?.message).toContain('legacyGroup');
    });

    it('surfaces INVALID_CATALOG thrown while importing as a validation error', async () => {
      const tree = await parseEventsFile(fixture('invalid-catalog.ts'));

      expect(tree.events).toHaveLength(0);
      expect(tree.errors).toHaveLength(1);
      expect(tree.errors[0]?.type).toBe('invalid-catalog');
      expect(tree.errors[0]?.message).toContain('reserved name "fork"');
    });
  });

  describe('parseEventsModule', () => {
    it('surfaces INVALID_CATALOG from walkCatalog as a validation error', () => {
      const catalog = defineEvents({ ok: event({ level: 'info', message: 'ok' }) });
      // Corrupt the catalog after definition so walkCatalog rejects it.
      (catalog as Record<string, unknown>).broken = undefined;

      const tree = parseEventsModule({ events: catalog });

      expect(tree.errors).toHaveLength(1);
      expect(tree.errors[0]?.type).toBe('invalid-catalog');
      expect(tree.errors[0]?.message).toMatch(/^events: .*"broken" is undefined/);
    });

    it('merges several root catalogs and reports keys defined in both', () => {
      const a = defineEvents({ user: { created: event({ level: 'info', message: 'a' }) } });
      const b = defineEvents({
        user: { created: event({ level: 'warn', message: 'b' }) },
        job: span({ events: {} }),
      });

      const tree = parseEventsModule({ a, b });

      expect(tree.catalogExports).toEqual(['a', 'b']);
      expect(tree.events.map((e) => e.key)).toEqual([
        'user.created',
        'job.start',
        'job.complete',
        'job.fail',
        'job.timeout',
      ]);
      expect(tree.errors).toEqual([
        {
          type: 'duplicate-key',
          message: 'Event key "user.created" in export "b" is already defined in export "a".',
        },
      ]);
    });

    it('uses key overrides as event keys', () => {
      const catalog = defineEvents({
        renamed: event({ key: 'legacy.name', level: 'info', message: 'x', doc: 'd' }),
        job: span({
          key: 'batch.job',
          events: { step: event({ level: 'info', message: 's', fields: { n: field.number() } }) },
        }),
      });

      const tree = parseEventsModule({ catalog });

      expect(tree.rootEvents.map((e) => e.key)).toEqual(['legacy.name']);
      expect(tree.rootEvents[0]?.path).toBe('renamed');
      const job = tree.groups[0]!;
      expect(job.key).toBe('batch.job');
      expect(job.path).toBe('job');
      expect(job.events.step?.key).toBe('batch.job.step');
      expect(job.lifecycleEvents[0]?.key).toBe('batch.job.start');
    });
  });

  describe('validator', () => {
    it('passes validation for valid events', async () => {
      const tree = await parseEventsFile(fixture('valid-events.ts'));
      expect(validateEventTree(tree)).toHaveLength(0);
    });

    it('reports missing docs, reserved fields and the reserved chronicler prefix', async () => {
      const tree = await parseEventsFile(fixture('lint-events.ts'));
      const errors = validateEventTree(tree);

      expect(errors.map((e) => e.type)).toEqual([
        'missing-doc',
        'reserved-field',
        'reserved-prefix',
        'reserved-prefix',
      ]);
      expect(errors[0]!.message).toContain('user.created');
      expect(errors[1]!.message).toContain('eventKey');
      expect(errors[2]!.message).toContain('chronicler.internal');
      expect(errors[3]!.message).toContain('Span key "chronicler.job"');
    });

    it('does not validate auto-generated lifecycle events', () => {
      const tree = makeTree({
        events: [makeEvent({ key: 'chronicler.x.start', doc: '', lifecycle: true })],
      });
      expect(validateEventTree(tree)).toHaveLength(0);
    });

    it('detects invalid log levels', () => {
      const tree = makeTree({ events: [makeEvent({ level: 'invalid' as 'info' })] });

      const errors = validateEventTree(tree);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.type).toBe('invalid-level');
    });

    it('detects reserved field usage', () => {
      const tree = makeTree({
        events: [makeEvent({ fields: { spanId: { type: 'string', required: true, doc: '' } } })],
      });

      const errors = validateEventTree(tree);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.type).toBe('reserved-field');
      expect(errors[0]!.message).toContain('spanId');
    });

    it('detects invalid span timeouts in nested groups', () => {
      const tree = makeTree({
        groups: [
          {
            key: 'a',
            path: 'a',
            kind: 'namespace',
            doc: '',
            events: {},
            lifecycleEvents: [],
            groups: {
              job: {
                key: 'a.job',
                path: 'a.job',
                kind: 'span',
                doc: '',
                timeout: -1,
                events: {},
                lifecycleEvents: [],
                groups: {},
              },
            },
          },
        ],
      });

      const errors = validateEventTree(tree);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.type).toBe('invalid-timeout');
    });

    it('keeps parse errors from the tree', () => {
      const tree = makeTree({ errors: [{ type: 'parse-error', message: 'boom' }] });
      expect(validateEventTree(tree)).toEqual([{ type: 'parse-error', message: 'boom' }]);
    });
  });
});
