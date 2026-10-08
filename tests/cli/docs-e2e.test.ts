import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChroniclerCliConfig } from '../../src/cli/config';
import { generateDocs } from '../../src/cli/generator/docs-generator';
import { parseEventsFile } from '../../src/cli/parser/runtime-parser';
import { validateEventTree } from '../../src/cli/parser/validator';
import type { ParsedEventTree } from '../../src/cli/types';

/**
 * End-to-end test for the docs CLI pipeline:
 *   fixture file → parseEventsFile → generateDocs → verify output
 *
 * This uses a fixture with every field builder, namespaces with group() docs, a span
 * with a nested namespace, a mounted catalog, a key override and a root-level event.
 */
describe('Docs CLI end-to-end', () => {
  const fixturesPath = path.join(__dirname, 'fixtures');
  const fixturePath = path.join(fixturesPath, 'docs-events.ts');
  // Each test gets its own unique temp directory via mkdtempSync, so parallel
  // test files can never delete one another's output. The directory must live
  // inside the project root because generateDocs rejects paths outside cwd.
  const baseTmp = path.join(__dirname, '../__temp__');
  let outputDir: string;
  let markdownPath: string;
  let jsonPath: string;

  let tree: ParsedEventTree;

  beforeEach(async () => {
    fs.mkdirSync(baseTmp, { recursive: true });
    outputDir = fs.mkdtempSync(path.join(baseTmp, 'docs-e2e-'));
    markdownPath = path.join(outputDir, 'events.md');
    jsonPath = path.join(outputDir, 'events.json');
    tree = await parseEventsFile(fixturePath);
  });

  afterEach(() => {
    // Only ever removes this test's own unique directory.
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // ── Parsing ──────────────────────────────────────────────────────

  describe('parsing', () => {
    it('parses without errors', () => {
      expect(tree.errors).toHaveLength(0);
    });

    it('passes validation', () => {
      const errors = validateEventTree(tree);
      expect(errors).toHaveLength(0);
    });

    it('extracts all events, including lifecycle events', () => {
      // 1 root + 3 system + 3 in http.request + 4 lifecycle + 1 billing = 12
      expect(tree.events).toHaveLength(12);
      expect(tree.events.filter((e) => e.lifecycle)).toHaveLength(4);
    });

    it('extracts top-level namespaces', () => {
      expect(tree.groups.map((g) => g.key)).toEqual(['system', 'http', 'billing']);
      expect(tree.groups.map((g) => g.doc)).toEqual([
        'System lifecycle events',
        'HTTP server events',
        '',
      ]);
    });

    it('uses the key override for the root event', () => {
      expect(tree.rootEvents.map((e) => e.key)).toEqual(['app.healthCheck']);
    });

    it('extracts field builder chains into plain field data', () => {
      const startup = tree.events.find((e) => e.key === 'system.startup');
      expect(startup?.fields.port).toEqual({
        type: 'number',
        required: true,
        doc: 'Server port',
        sensitive: false,
      });
      expect(startup?.fields.env).toEqual({
        type: 'string',
        required: false,
        doc: 'Runtime environment',
        sensitive: false,
      });
    });

    it('extracts all four field types (string, number, boolean, error)', () => {
      const error = tree.events.find((e) => e.key === 'system.error');
      expect(error?.fields.error?.type).toBe('error');
      expect(error?.fields.fatal?.type).toBe('boolean');

      const received = tree.events.find((e) => e.key === 'http.request.received');
      expect(received?.fields.method?.type).toBe('string');
      expect(received?.fields.path?.type).toBe('string');

      const completed = tree.events.find((e) => e.key === 'http.request.completed');
      expect(completed?.fields.statusCode?.type).toBe('number');
    });

    it('distinguishes required vs optional fields', () => {
      const received = tree.events.find((e) => e.key === 'http.request.received');
      expect(received?.fields.method?.required).toBe(true);
      expect(received?.fields.ip?.required).toBe(false);
    });

    it('extracts field doc strings', () => {
      const completed = tree.events.find((e) => e.key === 'http.request.completed');
      expect(completed?.fields.statusCode?.doc).toBe('Response status code');
      expect(completed?.fields.duration?.doc).toBe('Duration in ms');
    });

    it('extracts the span with its timeout', () => {
      const request = tree.groups.find((g) => g.key === 'http')!.groups.request;
      expect(request?.kind).toBe('span');
      expect(request?.timeout).toBe(30000);
      expect(request?.doc).toBe('HTTP request lifecycle');
    });

    it('extracts events inside namespaces and spans', () => {
      const systemGroup = tree.groups.find((g) => g.key === 'system');
      expect(Object.keys(systemGroup!.events)).toEqual(['startup', 'shutdown', 'error']);

      const request = tree.groups.find((g) => g.key === 'http')!.groups.request!;
      expect(Object.keys(request.events)).toEqual(['received', 'completed']);
      expect(request.groups.cache?.events.hit?.key).toBe('http.request.cache.hit');
      expect(request.groups.cache?.events.hit?.spanKey).toBe('http.request');
    });

    it('includes the mounted catalog once, under its mount point', () => {
      expect(tree.catalogExports).toEqual(['events']);
      const billing = tree.groups.find((g) => g.key === 'billing');
      expect(Object.keys(billing!.events)).toEqual(['charge']);
    });
  });

  // ── Markdown generation ──────────────────────────────────────────

  describe('markdown generation', () => {
    let markdown: string;

    beforeEach(() => {
      const config: ChroniclerCliConfig = {
        eventsFile: fixturePath,
        docs: { format: 'markdown', outputPath: markdownPath },
      };
      generateDocs(tree, config);
      markdown = fs.readFileSync(markdownPath, 'utf-8');
    });

    it('matches the snapshot', () => {
      expect(markdown).toMatchSnapshot();
    });

    it('includes title and auto-generated notice', () => {
      expect(markdown).toContain('# Chronicler Events');
      expect(markdown).toContain('Auto-generated documentation');
    });

    it('includes table of contents with all top-level groups', () => {
      expect(markdown).toContain('## Table of Contents');
      expect(markdown).toContain('- [system]');
      expect(markdown).toContain('- [http]');
      expect(markdown).toContain('- [billing]');
    });

    // ── System group ────────────────────────────────────────────

    it('documents namespace headings and group() docs', () => {
      expect(markdown).toContain('## system\n\nSystem lifecycle events');
      expect(markdown).toContain('## http\n\nHTTP server events');
    });

    it('documents system.startup event with fields', () => {
      expect(markdown).toContain('### system.startup');
      expect(markdown).toContain('**Level:** `info`');
      expect(markdown).toContain('**Message:** "Application started"');
      expect(markdown).toContain('Emitted when the application starts');
    });

    it('renders required fields with correct type and doc', () => {
      expect(markdown).toContain('**`port`** (`number`, required): Server port');
    });

    it('renders optional fields with correct type and doc', () => {
      expect(markdown).toContain('**`env`** (`string`, optional): Runtime environment');
    });

    it('documents event without fields (no Fields section)', () => {
      // system.shutdown has no fields — the line after its doc should NOT be "**Fields:**"
      const shutdownIdx = markdown.indexOf('### system.shutdown');
      const nextHeadingIdx = markdown.indexOf('###', shutdownIdx + 1);
      const shutdownSection = markdown.slice(shutdownIdx, nextHeadingIdx);
      expect(shutdownSection).not.toContain('**Fields:**');
    });

    it('renders error and boolean field types', () => {
      expect(markdown).toContain('**`error`** (`error`, required): Error details');
      expect(markdown).toContain('**`fatal`** (`boolean`, optional): Whether error is fatal');
    });

    // ── Span group ───────────────────────────────────────

    it('documents the span type and timeout under its namespace', () => {
      expect(markdown).toContain(
        '### http.request\n\n**Type:** Span\n**Timeout:** 30000ms (activity-based)\n\nHTTP request lifecycle',
      );
    });

    it('lists auto-generated span events', () => {
      expect(markdown).toContain('**Auto-Generated Events:**');
      expect(markdown).toContain('`http.request.start` (`info`)');
      expect(markdown).toContain('`http.request.complete` (`info`)');
      expect(markdown).toContain('`http.request.fail` (`error`)');
      expect(markdown).toContain('`http.request.timeout` (`warn`)');
      // Lifecycle events are listed, not documented as separate events
      expect(markdown).not.toContain('#### http.request.start');
    });

    it('documents span events with fields', () => {
      expect(markdown).toContain('#### http.request.received');
      expect(markdown).toContain('**`method`** (`string`, required): HTTP method');
      expect(markdown).toContain('**`ip`** (`string`, optional): Client IP');

      expect(markdown).toContain('#### http.request.completed');
      expect(markdown).toContain('**`statusCode`** (`number`, required): Response status code');
      expect(markdown).toContain('**`duration`** (`number`, required): Duration in ms');
    });

    it('documents namespaces nested inside a span', () => {
      expect(markdown).toContain('#### http.request.cache');
      expect(markdown).toContain('##### http.request.cache.hit');
    });

    it('documents the mounted catalog under its mount point', () => {
      expect(markdown).toContain('## billing');
      expect(markdown).toContain('### billing.charge');
      expect(markdown).toContain('**`amount`** (`number`, required): Amount in cents');
    });

    // ── Standalone events ───────────────────────────────────────

    it('places root-level events in their own section', () => {
      expect(markdown).toContain('## Standalone Events');
      expect(markdown).toContain('### app.healthCheck');
      expect(markdown).toContain('**Level:** `debug`');
      expect(markdown).toContain('Periodic health check ping');
    });
  });

  // ── JSON generation ──────────────────────────────────────────────

  describe('JSON generation', () => {
    interface DocsEvent {
      name?: string;
      key: string;
      level: string;
      message: string;
      doc: string;
      fields: { name: string; type: string; required: boolean; doc: string }[];
    }
    interface DocsGroup {
      name?: string;
      key: string;
      path: string;
      type: string;
      doc: string;
      timeout?: number;
      autoEvents?: string[];
      lifecycleEvents?: DocsEvent[];
      events: DocsEvent[];
      groups: DocsGroup[];
    }
    interface DocsJson {
      generated: string;
      eventCount: number;
      lifecycleEventCount: number;
      groupCount: number;
      groups: DocsGroup[];
      standaloneEvents: DocsEvent[];
    }

    let json: DocsJson;

    beforeEach(() => {
      const config: ChroniclerCliConfig = {
        eventsFile: fixturePath,
        docs: { format: 'json', outputPath: jsonPath },
      };
      generateDocs(tree, config);
      json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as DocsJson;
    });

    it('includes correct top-level counts', () => {
      expect(json.eventCount).toBe(8);
      expect(json.lifecycleEventCount).toBe(4);
      expect(json.groupCount).toBe(3);
    });

    it('includes a generated timestamp', () => {
      expect(json.generated).toBeDefined();
      expect(new Date(json.generated).getTime()).not.toBeNaN();
    });

    // ── System group ────────────────────────────────────────────

    it('serializes system group metadata', () => {
      const systemGroup = json.groups.find((g) => g.key === 'system')!;
      expect(systemGroup.type).toBe('namespace');
      expect(systemGroup.doc).toBe('System lifecycle events');
      expect(systemGroup.autoEvents).toBeUndefined();
    });

    it('serializes system group events with fields', () => {
      const systemGroup = json.groups.find((g) => g.key === 'system')!;
      expect(systemGroup.events.length).toBe(3);

      const startup = systemGroup.events.find((e) => e.name === 'startup')!;
      expect(startup.key).toBe('system.startup');
      expect(startup.level).toBe('info');
      expect(startup.message).toBe('Application started');
      expect(startup.doc).toBe('Emitted when the application starts');
      expect(startup.fields).toEqual(
        expect.arrayContaining([
          { name: 'port', type: 'number', required: true, doc: 'Server port', sensitive: false },
          {
            name: 'env',
            type: 'string',
            required: false,
            doc: 'Runtime environment',
            sensitive: false,
          },
        ]),
      );
    });

    it('serializes events without fields as empty array', () => {
      const systemGroup = json.groups.find((g) => g.key === 'system')!;
      const shutdown = systemGroup.events.find((e) => e.name === 'shutdown')!;
      expect(shutdown.fields).toEqual([]);
    });

    it('serializes error and boolean field types', () => {
      const systemGroup = json.groups.find((g) => g.key === 'system')!;
      const errorEvent = systemGroup.events.find((e) => e.name === 'error')!;
      expect(errorEvent.fields).toEqual(
        expect.arrayContaining([
          { name: 'error', type: 'error', required: true, doc: 'Error details', sensitive: false },
          {
            name: 'fatal',
            type: 'boolean',
            required: false,
            doc: 'Whether error is fatal',
            sensitive: false,
          },
        ]),
      );
    });

    // ── Span group ───────────────────────────────────────

    const findRequest = () =>
      json.groups.find((g) => g.key === 'http')!.groups.find((g) => g.name === 'request')!;

    it('serializes the span with timeout and auto-events', () => {
      const httpGroup = findRequest();
      expect(httpGroup.key).toBe('http.request');
      expect(httpGroup.path).toBe('http.request');
      expect(httpGroup.type).toBe('span');
      expect(httpGroup.doc).toBe('HTTP request lifecycle');
      expect(httpGroup.timeout).toBe(30000);
      expect(httpGroup.autoEvents).toEqual(['start', 'complete', 'fail', 'timeout']);
      expect(httpGroup.lifecycleEvents?.find((e) => e.key === 'http.request.fail')?.fields).toEqual(
        [
          {
            name: 'duration',
            type: 'number',
            required: false,
            doc: 'Duration of the span in milliseconds',
            sensitive: false,
          },
          {
            name: 'error',
            type: 'error',
            required: false,
            doc: 'Error that caused the failure',
            sensitive: false,
          },
        ],
      );
    });

    it('serializes span events with fields', () => {
      const httpGroup = findRequest();
      expect(httpGroup.events.length).toBe(2);

      const received = httpGroup.events.find((e) => e.name === 'received')!;
      expect(received.key).toBe('http.request.received');
      expect(received.fields).toEqual(
        expect.arrayContaining([
          { name: 'method', type: 'string', required: true, doc: 'HTTP method', sensitive: false },
          { name: 'path', type: 'string', required: true, doc: 'Request path', sensitive: false },
          { name: 'ip', type: 'string', required: false, doc: 'Client IP', sensitive: false },
        ]),
      );
    });

    // ── Standalone events ───────────────────────────────────────

    it('places standalone events outside groups', () => {
      expect(json.standaloneEvents.length).toBe(1);
      expect(json.standaloneEvents[0]!.key).toBe('app.healthCheck');
      expect(json.standaloneEvents[0]!.level).toBe('debug');
      expect(json.standaloneEvents[0]!.doc).toBe('Periodic health check ping');
      expect(json.standaloneEvents[0]!.fields).toEqual([]);
    });

    it('serializes namespaces nested inside a span', () => {
      const cache = findRequest().groups.find((g) => g.name === 'cache')!;
      expect(cache.type).toBe('namespace');
      expect(cache.events.map((e) => e.key)).toEqual(['http.request.cache.hit']);
    });
  });
});
