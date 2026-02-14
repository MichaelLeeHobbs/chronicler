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
 * This uses a fixture with t.* field builders, system groups, correlation groups,
 * optional/required fields, and standalone events to cover every variation.
 */
describe('Docs CLI end-to-end', () => {
  const fixturesPath = path.join(__dirname, 'fixtures');
  const fixturePath = path.join(fixturesPath, 'docs-events.ts');
  const outputDir = path.join(__dirname, '../__temp__/docs-e2e');
  const markdownPath = path.join(outputDir, 'events.md');
  const jsonPath = path.join(outputDir, 'events.json');

  let tree: ParsedEventTree;

  beforeEach(async () => {
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    tree = await parseEventsFile(fixturePath);
  });

  afterEach(() => {
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
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

    it('extracts all flat events', () => {
      // 1 standalone + 3 in system + 2 in http.request = 6
      expect(tree.events).toHaveLength(6);
    });

    it('extracts both groups', () => {
      expect(tree.groups).toHaveLength(2);
      const keys = tree.groups.map((g) => g.key);
      expect(keys).toContain('system');
      expect(keys).toContain('http.request');
    });

    it('extracts t.* field builder chains into FieldBuilder objects', () => {
      const startup = tree.events.find((e) => e.key === 'system.startup');
      expect(startup?.fields?.port).toEqual({
        _type: 'number',
        _required: true,
        _doc: 'Server port',
      });
      expect(startup?.fields?.env).toEqual({
        _type: 'string',
        _required: false,
        _doc: 'Runtime environment',
      });
    });

    it('extracts all four field types (string, number, boolean, error)', () => {
      const error = tree.events.find((e) => e.key === 'system.error');
      expect(error?.fields?.error?._type).toBe('error');
      expect(error?.fields?.fatal?._type).toBe('boolean');

      const received = tree.events.find((e) => e.key === 'http.request.received');
      expect(received?.fields?.method?._type).toBe('string');
      expect(received?.fields?.path?._type).toBe('string');

      const completed = tree.events.find((e) => e.key === 'http.request.completed');
      expect(completed?.fields?.statusCode?._type).toBe('number');
    });

    it('distinguishes required vs optional fields', () => {
      const received = tree.events.find((e) => e.key === 'http.request.received');
      expect(received?.fields?.method?._required).toBe(true);
      expect(received?.fields?.ip?._required).toBe(false);
    });

    it('extracts field doc strings', () => {
      const completed = tree.events.find((e) => e.key === 'http.request.completed');
      expect(completed?.fields?.statusCode?._doc).toBe('Response status code');
      expect(completed?.fields?.duration?._doc).toBe('Duration in ms');
    });

    it('extracts correlation group timeout', () => {
      const httpGroup = tree.groups.find((g) => g.key === 'http.request');
      expect(httpGroup?.timeout).toBe(30000);
    });

    it('extracts inline events inside groups', () => {
      const systemGroup = tree.groups.find((g) => g.key === 'system');
      expect(Object.keys(systemGroup!.events)).toEqual(
        expect.arrayContaining(['startup', 'shutdown', 'error']),
      );

      const httpGroup = tree.groups.find((g) => g.key === 'http.request');
      expect(Object.keys(httpGroup!.events)).toEqual(
        expect.arrayContaining(['received', 'completed']),
      );
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

    it('includes title and auto-generated notice', () => {
      expect(markdown).toContain('# Chronicler Events');
      expect(markdown).toContain('Auto-generated documentation');
    });

    it('includes table of contents with all groups', () => {
      expect(markdown).toContain('## Table of Contents');
      expect(markdown).toContain('- [system]');
      expect(markdown).toContain('- [http.request]');
    });

    // ── System group ────────────────────────────────────────────

    it('documents system group heading and description', () => {
      expect(markdown).toContain('## system');
      expect(markdown).toContain('System lifecycle events');
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

    // ── Correlation group ───────────────────────────────────────

    it('documents correlation group type and timeout', () => {
      expect(markdown).toContain('**Type:** Correlation Group');
      expect(markdown).toContain('**Timeout:** 30000ms (activity-based)');
    });

    it('lists auto-generated correlation events', () => {
      expect(markdown).toContain('**Auto-Generated Events:**');
      expect(markdown).toContain('`http.request.start`');
      expect(markdown).toContain('`http.request.complete`');
      expect(markdown).toContain('`http.request.timeout`');
      expect(markdown).toContain('`http.request.metadataWarning`');
    });

    it('documents correlation group inline events with fields', () => {
      expect(markdown).toContain('### http.request.received');
      expect(markdown).toContain('**`method`** (`string`, required): HTTP method');
      expect(markdown).toContain('**`ip`** (`string`, optional): Client IP');

      expect(markdown).toContain('### http.request.completed');
      expect(markdown).toContain('**`statusCode`** (`number`, required): Response status code');
      expect(markdown).toContain('**`duration`** (`number`, required): Duration in ms');
    });

    // ── Standalone events ───────────────────────────────────────

    it('places standalone events in their own section', () => {
      expect(markdown).toContain('## Standalone Events');
      expect(markdown).toContain('### app.healthCheck');
      expect(markdown).toContain('**Level:** `debug`');
      expect(markdown).toContain('Periodic health check ping');
    });
  });

  // ── JSON generation ──────────────────────────────────────────────

  describe('JSON generation', () => {
    interface DocsJson {
      generated: string;
      eventCount: number;
      groupCount: number;
      groups: {
        key: string;
        type: string;
        doc: string;
        timeout?: number;
        autoEvents?: string[];
        events: {
          name: string;
          key: string;
          level: string;
          message: string;
          doc: string;
          fields: { name: string; type: string; required: boolean; doc: string }[];
        }[];
        groups: unknown[];
      }[];
      standaloneEvents: {
        key: string;
        level: string;
        message: string;
        doc: string;
        fields: { name: string; type: string; required: boolean; doc: string }[];
      }[];
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
      expect(json.eventCount).toBe(6);
      expect(json.groupCount).toBe(2);
    });

    it('includes a generated timestamp', () => {
      expect(json.generated).toBeDefined();
      expect(new Date(json.generated).getTime()).not.toBeNaN();
    });

    // ── System group ────────────────────────────────────────────

    it('serializes system group metadata', () => {
      const systemGroup = json.groups.find((g) => g.key === 'system')!;
      expect(systemGroup.type).toBe('system');
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
          { name: 'port', type: 'number', required: true, doc: 'Server port' },
          { name: 'env', type: 'string', required: false, doc: 'Runtime environment' },
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
          { name: 'error', type: 'error', required: true, doc: 'Error details' },
          { name: 'fatal', type: 'boolean', required: false, doc: 'Whether error is fatal' },
        ]),
      );
    });

    // ── Correlation group ───────────────────────────────────────

    it('serializes correlation group with timeout and auto-events', () => {
      const httpGroup = json.groups.find((g) => g.key === 'http.request')!;
      expect(httpGroup.type).toBe('correlation');
      expect(httpGroup.doc).toBe('HTTP request lifecycle');
      expect(httpGroup.timeout).toBe(30000);
      expect(httpGroup.autoEvents).toEqual([
        'start',
        'complete',
        'fail',
        'timeout',
        'metadataWarning',
      ]);
    });

    it('serializes correlation group events with fields', () => {
      const httpGroup = json.groups.find((g) => g.key === 'http.request')!;
      expect(httpGroup.events.length).toBe(2);

      const received = httpGroup.events.find((e) => e.name === 'received')!;
      expect(received.key).toBe('http.request.received');
      expect(received.fields).toEqual(
        expect.arrayContaining([
          { name: 'method', type: 'string', required: true, doc: 'HTTP method' },
          { name: 'path', type: 'string', required: true, doc: 'Request path' },
          { name: 'ip', type: 'string', required: false, doc: 'Client IP' },
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
  });
});
