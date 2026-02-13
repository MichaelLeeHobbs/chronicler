import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEventsFile } from '../../src/cli/parser/ast-parser';
import { validateEventTree } from '../../src/cli/parser/validator';

describe('AST Parser', () => {
  const fixturesPath = path.join(__dirname, 'fixtures');

  describe('parseEventsFile', () => {
    it('parses valid event definitions', () => {
      const filePath = path.join(fixturesPath, 'valid-events.ts');
      const tree = parseEventsFile(filePath);

      expect(tree.events.length).toBeGreaterThan(0);
      expect(tree.errors.length).toBe(0);

      // Check that we found the startup event
      const startupEvent = tree.events.find((e) => e.key === 'system.startup');
      expect(startupEvent).toBeDefined();
      expect(startupEvent?.level).toBe('info');
      expect(startupEvent?.message).toBe('Application started');
      expect(startupEvent?.fields).toBeDefined();
      expect(startupEvent?.fields?.port).toBeDefined();
      expect(startupEvent!.fields!.port!._type).toBe('number');
      expect(startupEvent!.fields!.port!._required).toBe(true);
    });

    it('extracts all event properties correctly', () => {
      const filePath = path.join(fixturesPath, 'valid-events.ts');
      const tree = parseEventsFile(filePath);

      const queryEvent = tree.events.find((e) => e.key === 'api.query.executed');
      expect(queryEvent).toBeDefined();
      expect(queryEvent?.key).toBe('api.query.executed');
      expect(queryEvent?.level).toBe('info');
      expect(queryEvent?.message).toBe('Query executed');
      expect(queryEvent?.doc).toBe('Logged when query completes');
      expect(queryEvent?.fields).toBeDefined();
      expect(Object.keys(queryEvent?.fields ?? {})).toHaveLength(2);
    });
  });

  describe('validator', () => {
    it('passes validation for valid events', () => {
      const filePath = path.join(fixturesPath, 'valid-events.ts');
      const tree = parseEventsFile(filePath);
      const errors = validateEventTree(tree);

      expect(errors).toHaveLength(0);
    });

    it('detects invalid log levels', () => {
      // Create a mock tree with invalid level
      const tree = {
        events: [
          {
            key: 'test.event',
            level: 'invalid' as 'info',
            message: 'test',
            doc: 'test',
          },
        ],
        groups: [],
        errors: [],
      };

      const errors = validateEventTree(tree);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.type).toBe('invalid-level');
    });

    it('detects reserved field usage', () => {
      const tree = {
        events: [
          {
            key: 'test.event',
            level: 'info' as const,
            message: 'test',
            doc: 'test',
            fields: {
              eventKey: { _type: 'string', _required: true, _doc: 'bad' },
            },
          },
        ],
        groups: [],
        errors: [],
      };

      const errors = validateEventTree(tree);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.type).toBe('reserved-field');
      expect(errors[0]!.message).toContain('eventKey');
    });
  });
});
