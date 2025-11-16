import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { ChroniclerCliConfig } from '../../src/cli/config';
import { generateDocs } from '../../src/cli/generator/docs-generator';
import type { ParsedEventTree } from '../../src/cli/types';

describe('Documentation Generator', () => {
  const outputDir = path.join(__dirname, '../__temp__');
  const markdownPath = path.join(outputDir, 'events.md');
  const jsonPath = path.join(outputDir, 'events.json');

  beforeEach(() => {
    // Clean up output directory
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
  });

  const sampleTree: ParsedEventTree = {
    events: [
      {
        key: 'system.startup',
        level: 'info',
        message: 'Application started',
        doc: 'Logged when the application starts',
        fields: {
          port: { type: 'number', required: true, doc: 'Server port' },
          mode: { type: 'string', required: false, doc: 'Runtime mode' },
        },
      },
      {
        key: 'system.shutdown',
        level: 'info',
        message: 'Application shutdown',
        doc: 'Logged when the application shuts down',
      },
    ],
    groups: [
      {
        key: 'system',
        type: 'system',
        doc: 'System-level events',
        events: {
          startup: {
            key: 'system.startup',
            level: 'info',
            message: 'Application started',
            doc: 'Logged when the application starts',
            fields: {
              port: { type: 'number', required: true, doc: 'Server port' },
            },
          },
        },
        groups: {},
      },
    ],
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

    it('documents correlation groups with auto-events', () => {
      const correlationTree: ParsedEventTree = {
        events: [],
        groups: [
          {
            key: 'api.request',
            type: 'correlation',
            doc: 'API request tracking',
            timeout: 30000,
            events: {},
            groups: {},
          },
        ],
        errors: [],
      };

      const config: ChroniclerCliConfig = {
        eventsFile: './test.ts',
        docs: {
          format: 'markdown',
          outputPath: markdownPath,
        },
      };

      generateDocs(correlationTree, config);

      const content = fs.readFileSync(markdownPath, 'utf-8');

      expect(content).toContain('**Type:** Correlation Group');
      expect(content).toContain('**Timeout:** 30000ms (activity-based)');
      expect(content).toContain('**Auto-Generated Events:**');
      expect(content).toContain('`api.request.start`');
      expect(content).toContain('`api.request.complete`');
      expect(content).toContain('`api.request.timeout`');
      expect(content).toContain('`api.request.metadataWarning`');
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
      expect(json.groups[0].key).toBe('system');
      expect(json.groups[0].type).toBe('system');
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

      const event = json.groups[0].events[0];
      expect(event.key).toBe('system.startup');
      expect(event.level).toBe('info');
      expect(event.message).toBe('Application started');
      expect(event.doc).toBe('Logged when the application starts');
      expect(event.fields).toHaveLength(1);
      expect(event.fields[0].name).toBe('port');
      expect(event.fields[0].type).toBe('number');
      expect(event.fields[0].required).toBe(true);
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
