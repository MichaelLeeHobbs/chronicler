/**
 * Integration tests for end-to-end flows
 * Tests complete workflows from initialization through correlation and forking
 */

import { describe, expect, it, vi } from 'vitest';

import { createChronicle } from '../../src/core/chronicle';
import { defineCorrelationGroup, defineEvent, defineEventGroup } from '../../src/core/events';
import { MockLoggerBackend } from '../helpers/mock-logger';

describe('Integration Tests', () => {
  const systemEvents = defineEventGroup({
    key: 'system',
    type: 'system',
    doc: 'System events',
    events: {
      startup: defineEvent({
        key: 'system.startup',
        level: 'info',
        message: 'Application started',
        doc: 'Logged when application starts',
        fields: {
          port: { type: 'number', required: true, doc: 'Server port' },
          mode: { type: 'string', required: false, doc: 'Runtime mode' },
        },
      }),
      shutdown: defineEvent({
        key: 'system.shutdown',
        level: 'info',
        message: 'Application shutdown',
        doc: 'Logged when application shuts down',
      }),
    },
  });

  const requestCorrelation = defineCorrelationGroup({
    key: 'api.request',
    type: 'correlation',
    doc: 'API request tracking',
    timeout: 5000,
    events: {
      validated: defineEvent({
        key: 'api.request.validated',
        level: 'info',
        message: 'Request validated',
        doc: 'Request passed validation',
        fields: {
          method: { type: 'string', required: true, doc: 'HTTP method' },
          path: { type: 'string', required: true, doc: 'Request path' },
        },
      }),
      processed: defineEvent({
        key: 'api.request.processed',
        level: 'info',
        message: 'Request processed',
        doc: 'Request successfully processed',
        fields: {
          statusCode: { type: 'number', required: true, doc: 'HTTP status code' },
          duration: { type: 'number', required: true, doc: 'Processing time in ms' },
        },
      }),
    },
  });

  describe('End-to-End Application Flow', () => {
    it('complete application lifecycle with correlation and forks', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({
        backend: mock.backend,
        metadata: {
          application: 'test-api',
          env: 'test',
        },
        monitoring: {
          memory: true,
          cpu: true,
        },
      });

      // Application startup
      chronicle.event(systemEvents.events.startup, {
        port: 3000,
        mode: 'production',
      });

      // Add runtime context
      chronicle.addContext({ deploymentId: 'deploy-123' });

      // Start request correlation
      const request = chronicle.startCorrelation(requestCorrelation, {
        requestId: 'req-456',
      });

      // Validate request
      request.event(requestCorrelation.events.validated, {
        method: 'POST',
        path: '/api/users',
      });

      // Process in parallel using forks
      const task1 = request.fork({ taskId: 'task-1', operation: 'validateData' });
      const task2 = request.fork({ taskId: 'task-2', operation: 'checkPermissions' });

      task1.event(systemEvents.events.startup, { port: 0 }); // Dummy event for task1
      task2.event(systemEvents.events.startup, { port: 0 }); // Dummy event for task2

      // Complete request
      request.event(requestCorrelation.events.processed, {
        statusCode: 200,
        duration: 150,
      });

      request.complete();

      // Application shutdown
      chronicle.event(systemEvents.events.shutdown, {});

      // Assertions
      const payloads = mock.getPayloads();

      expect(payloads.length).toBeGreaterThan(6); // At least: startup, start, validated, 2 forks, processed, complete, shutdown

      // Check startup event
      const startup = mock.findByKey('system.startup');
      expect(startup).toBeDefined();
      expect(startup?.fields.port).toBe(3000);
      expect(startup?.metadata.application).toBe('test-api');
      expect(startup?.metadata.env).toBe('test');
      expect(startup?._perf).toBeDefined();
      expect(startup?._perf?.heapUsed).toBeGreaterThan(0);
      expect(startup?._perf?.cpuUser).toBeGreaterThanOrEqual(0);

      // Check correlation start
      const start = mock.findByKey('api.request.start');
      expect(start).toBeDefined();
      expect(start?.metadata.requestId).toBe('req-456');
      expect(start?.correlationId).toBeDefined();

      // Check validated event
      const validated = mock.findByKey('api.request.validated');
      expect(validated).toBeDefined();
      expect(validated?.fields.method).toBe('POST');
      expect(validated?.fields.path).toBe('/api/users');
      expect(validated?.correlationId).toBe(start?.correlationId);

      // Check fork IDs
      const forkLogs = payloads.filter((p) => p.forkId !== '0');
      expect(forkLogs.length).toBeGreaterThan(0);
      expect(forkLogs.some((p) => p.forkId === '1')).toBe(true);
      expect(forkLogs.some((p) => p.forkId === '2')).toBe(true);

      // Check fork context inheritance
      const fork1Log = payloads.find((p) => p.forkId === '1');
      expect(fork1Log?.metadata.taskId).toBe('task-1');
      expect(fork1Log?.metadata.requestId).toBe('req-456'); // Inherited
      expect(fork1Log?.metadata.deploymentId).toBe('deploy-123'); // Inherited

      // Check correlation complete
      const complete = mock.findByKey('api.request.complete');
      expect(complete).toBeDefined();
      expect(complete?.fields.duration).toBeGreaterThan(0);
      expect(complete?.correlationId).toBe(start?.correlationId);

      // Check shutdown
      const shutdown = mock.findByKey('system.shutdown');
      expect(shutdown).toBeDefined();
    });
  });

  describe('Correlation Timeout Handling', () => {
    it('emits timeout event when no activity occurs', () => {
      vi.useFakeTimers();
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      chronicle.startCorrelation(requestCorrelation);

      // Advance time beyond timeout
      vi.advanceTimersByTime(6000);

      const timeout = mock.findByKey('api.request.timeout');
      expect(timeout).toBeDefined();
      expect(timeout?.correlationId).toBeDefined();

      vi.useRealTimers();
    });

    it('resets timer on activity including fork activity', () => {
      vi.useFakeTimers();
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const correlation = chronicle.startCorrelation(requestCorrelation);

      // Activity at 2s
      vi.advanceTimersByTime(2000);
      correlation.event(requestCorrelation.events.validated, {
        method: 'GET',
        path: '/',
      });

      // Activity from fork at 4s (total 6s, but only 4s since last activity)
      vi.advanceTimersByTime(2000);
      const fork = correlation.fork();
      fork.event(systemEvents.events.startup, { port: 0 });

      // Advance another 4s (total 10s, but only 4s since fork activity)
      vi.advanceTimersByTime(4000);

      // Should NOT have timed out yet
      let timeout = mock.findByKey('api.request.timeout');
      expect(timeout).toBeUndefined();

      // Advance beyond timeout from last activity
      vi.advanceTimersByTime(2000);

      // NOW should have timed out
      timeout = mock.findByKey('api.request.timeout');
      expect(timeout).toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('Context Collision Detection', () => {
    it('detects and warns about metadata collisions', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: { userId: '123' } });

      chronicle.addContext({ sessionId: 'abc' });
      chronicle.addContext({ userId: '456' }); // Collision!

      chronicle.event(systemEvents.events.startup, { port: 3000 });

      const payload = mock.getPayloads()[0];
      expect(payload._validation?.contextCollisions).toContain('userId');
      expect(payload.metadata.userId).toBe('123'); // Original preserved
    });

    it('emits metadata warning in correlations', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const correlation = chronicle.startCorrelation(requestCorrelation, {
        userId: 'original',
      });

      correlation.addContext({ userId: 'attempted' }); // Collision

      const warning = mock.findByKey('api.request.metadataWarning');
      expect(warning).toBeDefined();
      expect(warning?.fields.attemptedKey).toBe('userId');
    });
  });

  describe('Validation Errors', () => {
    it('tracks missing required fields', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      // @ts-expect-error - intentionally missing required field for testing
      chronicle.event(systemEvents.events.startup, {});

      const payload = mock.getPayloads()[0];
      expect(payload._validation?.missingFields).toContain('port');
    });

    it('tracks type errors', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      // @ts-expect-error - intentionally wrong type for testing
      chronicle.event(systemEvents.events.startup, { port: 'not-a-number' });

      const payload = mock.getPayloads()[0];
      expect(payload._validation?.typeErrors).toContain('port');
    });
  });

  describe('Fork Hierarchy', () => {
    it('maintains correct fork IDs through deep nesting', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const fork1 = chronicle.fork({ level: '1' });
      const fork1_1 = fork1.fork({ level: '1.1' });
      const fork1_1_1 = fork1_1.fork({ level: '1.1.1' });

      chronicle.event(systemEvents.events.startup, { port: 0 });
      fork1.event(systemEvents.events.startup, { port: 1 });
      fork1_1.event(systemEvents.events.startup, { port: 2 });
      fork1_1_1.event(systemEvents.events.startup, { port: 3 });

      const payloads = mock.getPayloads();
      expect(payloads[0].forkId).toBe('0');
      expect(payloads[1].forkId).toBe('1');
      expect(payloads[2].forkId).toBe('1.1');
      expect(payloads[3].forkId).toBe('1.1.1');
    });

    it('isolates context between fork branches', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: { shared: 'value' } });

      const branch1 = chronicle.fork({ branch: '1', data: 'branch1-data' });
      const branch2 = chronicle.fork({ branch: '2', data: 'branch2-data' });

      branch1.addContext({ branch1Only: 'b1' });
      branch2.addContext({ branch2Only: 'b2' });

      branch1.event(systemEvents.events.startup, { port: 1 });
      branch2.event(systemEvents.events.startup, { port: 2 });

      const payloads = mock.getPayloads();
      const b1 = payloads.find((p) => p.fields.port === 1);
      const b2 = payloads.find((p) => p.fields.port === 2);

      // Both inherit shared
      expect(b1?.metadata.shared).toBe('value');
      expect(b2?.metadata.shared).toBe('value');

      // Each has own data
      expect(b1?.metadata.data).toBe('branch1-data');
      expect(b2?.metadata.data).toBe('branch2-data');

      // Context isolation
      expect(b1?.metadata.branch1Only).toBe('b1');
      expect(b1?.metadata).not.toHaveProperty('branch2Only');

      expect(b2?.metadata.branch2Only).toBe('b2');
      expect(b2?.metadata).not.toHaveProperty('branch1Only');
    });
  });

  describe('Performance Monitoring Integration', () => {
    it('includes performance metrics across all log types', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({
        backend: mock.backend,
        metadata: {},
        monitoring: { memory: true, cpu: true },
      });

      // System event
      chronicle.event(systemEvents.events.startup, { port: 3000 });

      // Correlation
      const correlation = chronicle.startCorrelation(requestCorrelation);
      correlation.event(requestCorrelation.events.validated, {
        method: 'GET',
        path: '/',
      });
      correlation.complete();

      // Fork
      const fork = chronicle.fork();
      fork.event(systemEvents.events.startup, { port: 4000 });

      // All should have perf metrics
      const payloads = mock.getPayloads();
      payloads.forEach((payload) => {
        expect(payload._perf).toBeDefined();
        expect(payload._perf?.heapUsed).toBeGreaterThan(0);
        expect(typeof payload._perf?.cpuUser).toBe('number');
        expect(typeof payload._perf?.cpuSystem).toBe('number');
      });
    });
  });

  describe('Multiple Correlation Completes', () => {
    it('allows multiple complete() calls with validation warning', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const correlation = chronicle.startCorrelation(requestCorrelation);
      correlation.complete();
      correlation.complete(); // Second complete

      const completes = mock.findAllByKey('api.request.complete');
      expect(completes.length).toBe(2);

      // First complete should have duration
      expect(completes[0].fields.duration).toBeGreaterThanOrEqual(0);
      expect(completes[0]._validation?.multipleCompletes).toBeUndefined();

      // Second complete should have warning
      expect(completes[1]._validation?.multipleCompletes).toBe(true);
    });
  });

  describe('Error Serialization', () => {
    it('safely serializes error fields', () => {
      const errorEvent = defineEvent({
        key: 'system.error',
        level: 'error',
        message: 'Error occurred',
        doc: 'Error event',
        fields: {
          error: { type: 'error', required: true, doc: 'The error' },
          code: { type: 'string', required: true, doc: 'Error code' },
        },
      });

      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const error = new Error('Test error');
      error.stack = 'Stack trace here';

      chronicle.event(errorEvent, {
        error,
        code: 'ERR_TEST',
      });

      const payload = mock.getPayloads()[0];
      expect(payload.fields.error).toBeDefined();
      // Error should be serialized as string by stderr-lib
      expect(typeof payload.fields.error).toBe('string');
      expect(payload.fields.error).toContain('Test error');
    });
  });
});
