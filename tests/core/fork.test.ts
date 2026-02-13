import { describe, expect, it } from 'vitest';

import { createChronicle } from '../../src/core/chronicle';
import { defineCorrelationGroup, defineEvent } from '../../src/core/events';
import { t } from '../../src/core/fields';
import { MockLoggerBackend } from '../helpers/mock-logger';

const sampleEvent = defineEvent({
  key: 'system.task',
  level: 'info',
  message: 'task executed',
  doc: 'A task event',
  fields: {
    taskId: t.string().doc('Task ID'),
  },
} as const);

const correlationGroup = defineCorrelationGroup({
  key: 'workflow',
  type: 'correlation',
  doc: 'Workflow correlation',
  timeout: 1000,
  events: {},
});

describe('Fork System', () => {
  describe('5.1 Fork ID Generation', () => {
    it('assigns forkId "0" to root chronicle', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      chronicle.event(sampleEvent, { taskId: 'root' });

      expect(mock.getLastPayload()?.forkId).toBe('0');
    });

    it('assigns sequential IDs to forks from root', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const fork1 = chronicle.fork({ task: 'A' });
      const fork2 = chronicle.fork({ task: 'B' });

      fork1.event(sampleEvent, { taskId: 'A' });
      fork2.event(sampleEvent, { taskId: 'B' });

      const payloads = mock.getPayloads();
      expect(payloads[0]!.forkId).toBe('1');
      expect(payloads[1]!.forkId).toBe('2');
    });

    it('creates hierarchical IDs for nested forks', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const fork1 = chronicle.fork({ forkLevel: '1' });
      const fork1_1 = fork1.fork({ forkLevel: '1.1' });
      const fork1_2 = fork1.fork({ forkLevel: '1.2' });

      fork1.event(sampleEvent, { taskId: '1' });
      fork1_1.event(sampleEvent, { taskId: '1.1' });
      fork1_2.event(sampleEvent, { taskId: '1.2' });

      const payloads = mock.getUserPayloads();
      expect(payloads[0]!.forkId).toBe('1');
      expect(payloads[1]!.forkId).toBe('1.1');
      expect(payloads[2]!.forkId).toBe('1.2');
    });

    it('maintains separate fork counters per instance', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const fork1 = chronicle.fork({ branch: '1' });
      const fork2 = chronicle.fork({ branch: '2' });

      const fork1_1 = fork1.fork({ sub: '1.1' });
      const fork2_1 = fork2.fork({ sub: '2.1' });

      fork1_1.event(sampleEvent, { taskId: '1.1' });
      fork2_1.event(sampleEvent, { taskId: '2.1' });

      const payloads = mock.getPayloads();
      expect(payloads[0]!.forkId).toBe('1.1');
      expect(payloads[1]!.forkId).toBe('2.1');
    });
  });

  describe('5.2 Fork Context Inheritance', () => {
    it('inherits parent context', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({
        backend: mock.backend,
        metadata: { application: 'api' },
      });

      chronicle.addContext({ userId: '123' });
      const fork = chronicle.fork({ taskId: 'task1' });

      fork.event(sampleEvent, { taskId: 'task1' });

      const payload = mock.getLastPayload();
      expect(payload?.metadata).toMatchObject({
        application: 'api',
        userId: '123',
        taskId: 'task1',
      });
    });

    it('does not propagate context changes upward', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      chronicle.addContext({ original: 'value' });
      const fork = chronicle.fork();

      fork.addContext({ forkOnly: 'data' });

      // Log from fork
      fork.event(sampleEvent, { taskId: 'fork' });
      const forkPayload = mock.getPayloads()[0]!;

      // Log from parent
      chronicle.event(sampleEvent, { taskId: 'parent' });
      const parentPayload = mock.getLastPayload();

      expect(forkPayload.metadata).toMatchObject({
        original: 'value',
        forkOnly: 'data',
      });

      expect(parentPayload?.metadata).toMatchObject({
        original: 'value',
      });
      expect(parentPayload?.metadata).not.toHaveProperty('forkOnly');
    });

    it('allows nested forks to inherit from intermediate forks', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const fork1 = chronicle.fork({ branch: 'fork1' });
      fork1.addContext({ extra: 'data' });
      const fork1_1 = fork1.fork({ subbranch: 'fork1.1' });

      fork1_1.event(sampleEvent, { taskId: 'nested' });

      expect(mock.getLastPayload()?.metadata).toMatchObject({
        branch: 'fork1',
        subbranch: 'fork1.1',
        extra: 'data',
      });
    });
  });

  describe('5.3 Correlation and Fork Integration', () => {
    it('preserves forkId through correlation', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const fork = chronicle.fork({ task: 'A' });
      const correlation = fork.startCorrelation(correlationGroup, { workflowId: 'wf1' });

      correlation.event(sampleEvent, { taskId: 'corr-task' });

      const payloads = mock.getPayloads();
      // start event
      expect(payloads[0]!.forkId).toBe('1');
      // correlation event
      expect(payloads[1]!.forkId).toBe('1');
    });

    it('allows forks from within correlations', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const correlation = chronicle.startCorrelation(correlationGroup);
      const fork = correlation.fork({ parallel: 'task1' });

      fork.event(sampleEvent, { taskId: 'parallel-task' });

      // Start event has forkId "0", fork event has "1"
      const payloads = mock.getPayloads();
      expect(payloads[0]!.forkId).toBe('0'); // start
      expect(payloads[1]!.forkId).toBe('1'); // fork
    });

    it('fork events trigger parent correlation activity timer', async () => {
      const { vi } = await import('vitest');
      vi.useFakeTimers();
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const correlation = chronicle.startCorrelation(correlationGroup);
      const fork = correlation.fork();

      // Log from fork should reset parent timer
      fork.event(sampleEvent, { taskId: 'keep-alive' });
      vi.advanceTimersByTime(500);
      fork.event(sampleEvent, { taskId: 'keep-alive-2' });
      vi.advanceTimersByTime(500);

      // Should NOT timeout because fork kept it alive
      fork.event(sampleEvent, { taskId: 'final' });
      vi.advanceTimersByTime(1100);

      // Now should timeout
      const payloads = mock.getPayloads();
      const eventKeys = payloads.map((p) => p.eventKey);

      // start, keep-alive, keep-alive-2, final, timeout
      expect(eventKeys).toContain('workflow.timeout');

      vi.useRealTimers();
    });

    it('inherits correlation metadata in fork', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const correlation = chronicle.startCorrelation(correlationGroup, {
        workflowId: 'wf123',
      });
      const fork = correlation.fork({ parallelTask: 'task1' });

      fork.event(sampleEvent, { taskId: 'test' });

      expect(mock.getLastPayload()?.metadata).toMatchObject({
        workflowId: 'wf123',
        parallelTask: 'task1',
      });
    });

    it('fork from correlation shares same correlationId', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const correlation = chronicle.startCorrelation(correlationGroup);
      const fork = correlation.fork();

      correlation.event(sampleEvent, { taskId: 'parent' });
      fork.event(sampleEvent, { taskId: 'child' });

      const payloads = mock.getPayloads();
      const correlationId = payloads[0]!.correlationId; // start event

      // All events should share the same correlationId
      expect(payloads[1]!.correlationId).toBe(correlationId);
      expect(payloads[2]!.correlationId).toBe(correlationId);
    });
  });

  describe('5.4 Fork Deep Nesting', () => {
    it('handles deeply nested fork hierarchies', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      let current = chronicle;
      const expectedIds = ['0', '1', '1.1', '1.1.1', '1.1.1.1'];

      // Log root
      current.event(sampleEvent, { taskId: 'root' });

      // Create 4 levels of nesting
      for (let i = 0; i < 4; i++) {
        current = current.fork({ depth: i });
        current.event(sampleEvent, { taskId: `level-${i}` });
      }

      const payloads = mock.getUserPayloads();
      payloads.forEach((payload, idx) => {
        expect(payload.forkId).toBe(expectedIds[idx]);
      });
    });
  });

  describe('5.5 Context Collision in Forks', () => {
    it('tracks context collisions in forks', () => {
      const mock = new MockLoggerBackend();
      const chronicle = createChronicle({ backend: mock.backend, metadata: {} });

      const fork = chronicle.fork({ userId: '123' });
      fork.addContext({ userId: '456' }); // Collision

      // Check that chronicler.contextCollision event was emitted
      const collisionEvent = mock.findByKey('chronicler.contextCollision');
      expect(collisionEvent).toBeDefined();
      expect(collisionEvent?.fields.keys).toBe('userId');
      expect(collisionEvent?.fields.count).toBe(1);
      expect(collisionEvent?.metadata.userId).toBe('123'); // Original preserved
    });
  });
});
