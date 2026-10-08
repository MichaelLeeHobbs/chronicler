import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChroniclerCliConfig } from '../../src/cli/config';
import { generateDocs } from '../../src/cli/generator/docs-generator';
import type { ParsedEvent, ParsedEventTree } from '../../src/cli/types';

describe('Documentation Generator', () => {
  // Each test gets its own unique temp directory via mkdtempSync, so parallel
  // test files can never delete one another's output. The directory must live
  // inside the project root because generateDocs rejects paths outside cwd.
  const baseTmp = path.join(__dirname, '../__temp__');
  let outputDir: string;
  let markdownPath: string;
  let jsonPath: string;

  beforeEach(() => {
    fs.mkdirSync(baseTmp, { recursive: true });
    outputDir = fs.mkdtempSync(path.join(baseTmp, 'docs-generator-'));
    markdownPath = path.join(outputDir, 'events.md');
    jsonPath = path.join(outputDir, 'events.json');
  });

  afterEach(() => {
    // Only ever removes this test's own unique directory.
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  const startup: ParsedEvent = {
    key: 'system.startup',
    path: 'system.startup',
    level: 'info',
    message: 'Application started',
    doc: 'Logged when the application starts',
    fields: {
      port: { type: 'number', required: true, doc: 'Server port' },
      mode: { type: 'string', required: false, doc: 'Runtime mode' },
    },
    lifecycle: false,
  };

  const healthCheck: ParsedEvent = {
    key: 'healthCheck',
    path: 'healthCheck',
    level: 'debug',
    message: 'Health check',
    doc: 'Periodic ping',
    fields: {},
    lifecycle: false,
  };

  const sampleTree: ParsedEventTree = {
    events: [startup, healthCheck],
    groups: [
      {
        key: 'system',
        path: 'system',
        kind: 'namespace',
        doc: 'System-level events',
        events: { startup },
        lifecycleEvents: [],
        groups: {},
      },
    ],
    rootEvents: [healthCheck],
    catalogExports: ['events'],
    errors: [],
  };

  const lifecycle = (key: string, level: ParsedEvent['level']): ParsedEvent => ({
    key,
    path: key,
    level,
    message: key,
    doc: 'Auto-generated',
    fields: {},
    correlationKey: 'api.request',
    lifecycle: true,
  });

  const correlationTree: ParsedEventTree = {
    events: [],
    groups: [
      {
        key: 'api',
        path: 'api',
        kind: 'namespace',
        doc: 'API events',
        events: {},
        lifecycleEvents: [],
        groups: {
          request: {
            key: 'api.request',
            path: 'api.request',
            kind: 'correlation',
            doc: 'API request tracking',
            timeout: 30000,
            events: {},
            lifecycleEvents: [
              lifecycle('api.request.start', 'info'),
              lifecycle('api.request.complete', 'info'),
              lifecycle('api.request.fail', 'error'),
              lifecycle('api.request.timeout', 'warn'),
            ],
            groups: {},
          },
        },
      },
    ],
    rootEvents: [],
    catalogExports: ['events'],
    errors: [],
  };

  describe('Markdown Generation', () => {
    it('generates markdown documentation', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: markdownPath,
        },
      };

      generateDocs(sampleTree, config);

      expect(fs.existsSync(markdownPath)).toBe(true);

      const content = fs.readFileSync(markdownPath, 'utf-8');

      // Check for main heading
      expect(content).toContain('# Chronicler Events');

      // Check for group documentation
      expect(content).toContain('## system');
      expect(content).toContain('System-level events');

      // Check for event documentation
      expect(content).toContain('### system.startup');
      expect(content).toContain('**Level:** `info`');
      expect(content).toContain('**Message:** "Application started"');

      // Check for field documentation
      expect(content).toContain('**Fields:**');
      expect(content).toContain('**`port`** (`number`, required): Server port');
    });

    it('documents correlations with timeout and lifecycle events', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: markdownPath,
        },
      };

      generateDocs(correlationTree, config);

      const content = fs.readFileSync(markdownPath, 'utf-8');

      expect(content).toContain('## api\n\nAPI events');
      expect(content).toContain('### api.request');
      expect(content).toContain('**Type:** Correlation');
      expect(content).toContain('**Timeout:** 30000ms (activity-based)');
      expect(content).toContain('**Auto-Generated Events:**');
      expect(content).toContain('- `api.request.start` (`info`) - Logged when correlation starts');
      expect(content).toContain('`api.request.complete` (`info`)');
      expect(content).toContain('`api.request.fail` (`error`)');
      expect(content).toContain('`api.request.timeout` (`warn`)');
      // The TOC lists top-level groups only
      expect(content).toContain('- [api](#api)');
      expect(content).not.toContain('- [api.request]');
    });

    it('shows a disabled timeout', () => {
      const group = correlationTree.groups[0]!.groups.request!;
      const tree: ParsedEventTree = {
        ...correlationTree,
        groups: [{ ...group, timeout: 0 }],
      };
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: { format: 'markdown', outputPath: markdownPath },
      };

      generateDocs(tree, config);

      expect(fs.readFileSync(markdownPath, 'utf-8')).toContain('**Timeout:** Disabled');
    });

    it('documents root-level events as standalone events', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: { format: 'markdown', outputPath: markdownPath },
      };

      generateDocs(sampleTree, config);

      const content = fs.readFileSync(markdownPath, 'utf-8');
      expect(content).toContain('## Standalone Events\n\n### healthCheck');
    });
  });

  describe('JSON Generation', () => {
    it('generates JSON documentation', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'json',
          outputPath: jsonPath,
        },
      };

      generateDocs(sampleTree, config);

      expect(fs.existsSync(jsonPath)).toBe(true);

      const content = fs.readFileSync(jsonPath, 'utf-8');
      const json = JSON.parse(content) as {
        eventCount: number;
        groupCount: number;
        groups: { key: string; type: string }[];
      };

      expect(json.eventCount).toBe(2);
      expect(json.groupCount).toBe(1);
      expect(json.groups).toHaveLength(1);
      expect(json.groups[0]!.key).toBe('system');
      expect(json.groups[0]!.type).toBe('namespace');
    });

    it('includes all event properties in JSON', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'json',
          outputPath: jsonPath,
        },
      };

      generateDocs(sampleTree, config);

      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
        groups: {
          events: {
            key: string;
            level: string;
            message: string;
            doc: string;
            fields: { name: string; type: string; required: boolean }[];
          }[];
        }[];
      };

      const event = json.groups[0]!.events[0]!;
      expect(event.key).toBe('system.startup');
      expect(event.level).toBe('info');
      expect(event.message).toBe('Application started');
      expect(event.doc).toBe('Logged when the application starts');
      expect(event.fields).toHaveLength(2);
      expect(event.fields[0]!.name).toBe('port');
      expect(event.fields[0]!.type).toBe('number');
      expect(event.fields[0]!.required).toBe(true);
    });

    it('serializes nested correlations with lifecycle events', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: { format: 'json', outputPath: jsonPath },
      };

      generateDocs(correlationTree, config);

      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
        groups: {
          type: string;
          groups: {
            name: string;
            key: string;
            type: string;
            timeout: number;
            autoEvents: string[];
            lifecycleEvents: { key: string; level: string }[];
          }[];
        }[];
      };

      const request = json.groups[0]!.groups[0]!;
      expect(request.name).toBe('request');
      expect(request.key).toBe('api.request');
      expect(request.type).toBe('correlation');
      expect(request.timeout).toBe(30000);
      expect(request.autoEvents).toEqual(['start', 'complete', 'fail', 'timeout']);
      expect(request.lifecycleEvents.map((e) => e.level)).toEqual([
        'info',
        'info',
        'error',
        'warn',
      ]);
    });
  });

  describe('Line Endings', () => {
    it('defaults to LF line endings when eol is not configured', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: markdownPath,
        },
      };

      generateDocs(sampleTree, config);

      const content = fs.readFileSync(markdownPath, 'utf-8');
      expect(content).toContain('\n');
      expect(content).not.toContain('\r\n');
    });

    it('writes CRLF line endings when eol is "crlf"', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: markdownPath,
          eol: 'crlf',
        },
      };

      generateDocs(sampleTree, config);

      const content = fs.readFileSync(markdownPath, 'utf-8');
      // Every newline must be CRLF — no bare LF should remain.
      expect(content).toContain('\r\n');
      expect(/(?<!\r)\n/.test(content)).toBe(false);
    });

    it('writes LF line endings when eol is "lf"', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: markdownPath,
          eol: 'lf',
        },
      };

      generateDocs(sampleTree, config);

      const content = fs.readFileSync(markdownPath, 'utf-8');
      expect(content).toContain('\n');
      expect(content).not.toContain('\r\n');
    });

    it('applies CRLF normalization to JSON output as well', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'json',
          outputPath: jsonPath,
          eol: 'crlf',
        },
      };

      generateDocs(sampleTree, config);

      const content = fs.readFileSync(jsonPath, 'utf-8');
      expect(content).toContain('\r\n');
      expect(/(?<!\r)\n/.test(content)).toBe(false);
      // Content must still be valid JSON after normalization.
      expect(() => {
        JSON.parse(content);
      }).not.toThrow();
    });

    it('produces identical content across repeated regenerations (CRLF)', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: markdownPath,
          eol: 'crlf',
        },
      };

      generateDocs(sampleTree, config);
      const first = fs.readFileSync(markdownPath, 'utf-8');

      generateDocs(sampleTree, config);
      const second = fs.readFileSync(markdownPath, 'utf-8');

      expect(second).toBe(first);
    });
  });

  describe('Path Traversal Prevention', () => {
    it('rejects output paths that escape the project directory', () => {
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: '../../../etc/cron.d/exploit',
        },
      };

      expect(() => generateDocs(sampleTree, config)).toThrow(
        /resolves outside the project directory/,
      );
    });
  });

  describe('Directory Creation', () => {
    it('creates output directory if it does not exist', () => {
      const deepPath = path.join(outputDir, 'nested/deep/path/events.md');
      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: deepPath,
        },
      };

      generateDocs(sampleTree, config);

      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });
});
