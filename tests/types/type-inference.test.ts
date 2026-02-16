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
import { t } from '../../src/core/fields';

describe('Type Inference Tests', () => {
  describe('Field Type Inference', () => {
    it('infers field types correctly', () => {
      const event = defineEvent({
        key: 'test.event',
        level: 'info',
        message: 'Test',
        doc: 'Test event',
        fields: {
          name: t.string().doc('Name'),
          count: t.number().optional().doc('Count'),
        },
      } as const);

      expect(event.fields).toBeDefined();
      expect(event.fields?.name._type).toBe('string');
      expect(event.fields?.name._required).toBe(true);
      expect(event.fields?.count._type).toBe('number');
      expect(event.fields?.count._required).toBe(false);
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

  describe('doc is optional', () => {
    it('allows event definition without doc', () => {
      const event = defineEvent({
        key: 'test.nodoc',
        level: 'info',
        message: 'Test without doc',
        fields: {
          count: t.number(),
        },
      });

      expect(event.key).toBe('test.nodoc');
      expect(event.doc).toBeUndefined();
      expect(event.fields?.count._type).toBe('number');
    });

    it('allows event group without doc', () => {
      const group = defineEventGroup({
        key: 'nodoc',
        type: 'system',
        events: {
          ping: defineEvent({
            key: 'nodoc.ping',
            level: 'info',
            message: 'Ping',
          }),
        },
      });

      expect(group.key).toBe('nodoc');
      expect((group as Record<string, unknown>).doc).toBeUndefined();
      expect(group.events.ping.key).toBe('nodoc.ping');
    });

    it('allows correlation group without doc', () => {
      const group = defineCorrelationGroup({
        key: 'nodoc.corr',
        type: 'correlation',
        events: {},
      });

      expect((group as Record<string, unknown>).doc).toBeUndefined();
      expect(group.events.start.key).toBe('nodoc.corr.start');
    });
  });

  describe('as const is not required', () => {
    it('infers field types correctly without as const', () => {
      const event = defineEvent({
        key: 'test.noconst',
        level: 'info',
        message: 'Test',
        doc: 'Test event without as const',
        fields: {
          name: t.string().doc('Name'),
          count: t.number().optional().doc('Count'),
          active: t.boolean(),
          err: t.error().optional(),
        },
      });

      expect(event.key).toBe('test.noconst');
      expect(event.fields?.name._type).toBe('string');
      expect(event.fields?.name._required).toBe(true);
      expect(event.fields?.count._type).toBe('number');
      expect(event.fields?.count._required).toBe(false);
      expect(event.fields?.active._type).toBe('boolean');
      expect(event.fields?.active._required).toBe(true);
      expect(event.fields?.err._type).toBe('error');
      expect(event.fields?.err._required).toBe(false);
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

  describe('Auto-derived Event Keys', () => {
    it('auto-prefixes short keys with group key', () => {
      const group = defineEventGroup({
        key: 'billing',
        type: 'system',
        doc: 'Billing events',
        events: {
          charged: defineEvent({
            key: 'charged',
            level: 'info',
            message: 'Charged',
            doc: 'Customer charged',
          }),
          refunded: defineEvent({
            key: 'billing.refunded', // already qualified
            level: 'info',
            message: 'Refunded',
            doc: 'Customer refunded',
          }),
        },
      });

      expect(group.events.charged.key).toBe('billing.charged');
      expect(group.events.refunded.key).toBe('billing.refunded');
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
