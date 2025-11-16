/**
 * Type tests for Chronicler type inference
 * These tests verify that TypeScript correctly infers types from event definitions
 */

import { describe, expect, it } from 'vitest';

import {
  defineCorrelationGroup,
  defineEvent,
  defineEventGroup,
  LogLevel,
} from '../../src/core/events';

describe('Type Inference Tests', () => {
  describe('Field Type Inference', () => {
    it('infers field types correctly', () => {
      const event = defineEvent({
        key: 'test.event',
        level: 'info',
        message: 'Test',
        doc: 'Test event',
        fields: {
          name: { type: 'string', required: true, doc: 'Name' },
          count: { type: 'number', required: false, doc: 'Count' },
        },
      });

      expect(event.fields).toBeDefined();
      expect(event.fields?.name.type).toBe('string');
      expect(event.fields?.name.required).toBe(true);
      expect(event.fields?.count.type).toBe('number');
      expect(event.fields?.count.required).toBe(false);
    });

    it('handles events without fields', () => {
      const event = defineEvent({
        key: 'test.nofields',
        level: 'info',
        message: 'Test',
        doc: 'Test',
      });

      expect(event.fields).toBeUndefined();
    });
  });

  describe('Event Definition Structure', () => {
    it('preserves event definition properties', () => {
      const event = defineEvent({
        key: 'api.request',
        level: 'info',
        message: 'API request received',
        doc: 'Logged when API receives a request',
      });

      expect(event.key).toBe('api.request');
      expect(event.level).toBe('info');
      expect(event.message).toBe('API request received');
      expect(event.doc).toBe('Logged when API receives a request');
    });

    it('preserves all log levels', () => {
      const levels = [
        'fatal',
        'critical',
        'alert',
        'error',
        'warn',
        'audit',
        'info',
        'debug',
        'trace',
      ];

      levels.forEach((level) => {
        const event = defineEvent({
          key: 'test',
          level: level as LogLevel,
          message: 'test',
          doc: 'test',
        });
        expect(event.level).toBe(level);
      });
    });
  });

  describe('Event Group Structure', () => {
    it('preserves event group structure', () => {
      const group = defineEventGroup({
        key: 'api',
        type: 'system',
        doc: 'API events',
        events: {
          started: defineEvent({
            key: 'api.started',
            level: 'info',
            message: 'API started',
            doc: 'API server started',
          }),
        },
      });

      expect(group.key).toBe('api');
      expect(group.type).toBe('system');
      expect(group.events.started).toBeDefined();
      expect(group.events.started.key).toBe('api.started');
    });

    it('preserves nested group structure', () => {
      const group = defineEventGroup({
        key: 'api',
        type: 'system',
        doc: 'API events',
        events: {},
        groups: {
          v1: defineEventGroup({
            key: 'api.v1',
            type: 'system',
            doc: 'API v1',
            events: {},
          }),
        },
      });

      expect(group.groups.v1).toBeDefined();
      expect(group.groups.v1.key).toBe('api.v1');
    });
  });

  describe('Correlation Group Structure', () => {
    it('preserves correlation group with timeout', () => {
      const group = defineCorrelationGroup({
        key: 'workflow',
        type: 'correlation',
        doc: 'Workflow tracking',
        timeout: 30000,
        events: {},
      });

      expect(group.type).toBe('correlation');
      expect(group.timeout).toBe(30000);
    });

    it('defaults timeout to 300000ms when omitted', () => {
      const group = defineCorrelationGroup({
        key: 'workflow',
        type: 'correlation',
        doc: 'Workflow tracking',
        events: {},
      });

      expect(group.type).toBe('correlation');
      expect(group.timeout).toBe(300000); // Default 300s
    });
  });
});
