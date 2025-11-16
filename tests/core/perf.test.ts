import { describe, expect, it, vi } from 'vitest';

import type { LogBackend, LogPayload } from '../../src/core/backend';
import { createChronicle } from '../../src/core/chronicle';
import { defineEvent } from '../../src/core/events';

const createBackend = () => {
  const log = vi.fn<LogBackend['log']>();
  const backend: LogBackend = {
    log,
    supportsLevel: () => true,
  };
  return { backend, log };
};

const sampleEvent = defineEvent({
  key: 'perf.test',
  level: 'info',
  message: 'performance test',
  doc: 'Event for testing performance monitoring',
  fields: {
    action: { type: 'string', required: true, doc: 'Action performed' },
  },
});

const lastPayload = (log: ReturnType<typeof vi.fn>): LogPayload => {
  const call = log.mock.calls.at(-1);
  if (!call) {
    throw new Error('no log');
  }
  return call[2] as LogPayload;
};

describe('Performance Monitoring', () => {
  describe('6.1 Memory Monitoring', () => {
    it('does not include _perf when monitoring disabled', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({ backend, metadata: {} });

      chronicle.event(sampleEvent, { action: 'test' });

      expect(lastPayload(log)._perf).toBeUndefined();
    });

    it('includes memory metrics when memory monitoring enabled', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { memory: true },
      });

      chronicle.event(sampleEvent, { action: 'test' });

      const perf = lastPayload(log)._perf;
      expect(perf).toBeDefined();
      expect(typeof perf!.heapUsed).toBe('number');
      expect(typeof perf!.heapTotal).toBe('number');
      expect(typeof perf!.external).toBe('number');
      expect(typeof perf!.rss).toBe('number');
      expect(perf!.heapUsed).toBeGreaterThan(0);
    });
  });

  describe('6.2 CPU Monitoring', () => {
    it('includes CPU metrics when cpu monitoring enabled', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { cpu: true },
      });

      chronicle.event(sampleEvent, { action: 'test' });

      const perf = lastPayload(log)._perf;
      expect(perf).toBeDefined();
      expect(typeof perf!.cpuUser).toBe('number');
      expect(typeof perf!.cpuSystem).toBe('number');
      expect(perf!.cpuUser).toBeGreaterThanOrEqual(0);
      expect(perf!.cpuSystem).toBeGreaterThanOrEqual(0);
    });

    it('tracks CPU delta between events', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { cpu: true },
      });

      // First event establishes baseline
      chronicle.event(sampleEvent, { action: 'first' });

      // Do some work
      for (let i = 0; i < 100000; i++) {
        Math.sqrt(i);
      }

      // Second event should show CPU usage delta
      chronicle.event(sampleEvent, { action: 'second' });
      const secondPayload = lastPayload(log);

      expect(secondPayload._perf?.cpuUser).toBeDefined();
      expect(secondPayload._perf?.cpuSystem).toBeDefined();

      // CPU usage should be measurable (though exact values vary)
      expect(typeof secondPayload._perf!.cpuUser).toBe('number');
      expect(typeof secondPayload._perf!.cpuSystem).toBe('number');
    });

    it('does not include CPU metrics when cpu monitoring disabled', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { memory: true }, // Only memory, not CPU
      });

      chronicle.event(sampleEvent, { action: 'test' });

      const perf = lastPayload(log)._perf;
      expect(perf).toBeDefined();
      expect(perf!.cpuUser).toBeUndefined();
      expect(perf!.cpuSystem).toBeUndefined();
    });
  });

  describe('6.3 Combined Monitoring', () => {
    it('includes both memory and CPU when both enabled', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { memory: true, cpu: true },
      });

      chronicle.event(sampleEvent, { action: 'test' });

      const perf = lastPayload(log)._perf;
      expect(perf).toBeDefined();

      // Memory metrics
      expect(typeof perf!.heapUsed).toBe('number');
      expect(typeof perf!.heapTotal).toBe('number');
      expect(typeof perf!.external).toBe('number');
      expect(typeof perf!.rss).toBe('number');

      // CPU metrics
      expect(typeof perf!.cpuUser).toBe('number');
      expect(typeof perf!.cpuSystem).toBe('number');
    });

    it('propagates monitoring config through forks', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { memory: true, cpu: true },
      });

      const fork = chronicle.fork({ task: 'child' });
      fork.event(sampleEvent, { action: 'fork-event' });

      const perf = lastPayload(log)._perf;
      expect(perf).toBeDefined();
      expect(perf!.heapUsed).toBeGreaterThan(0);
      expect(typeof perf!.cpuUser).toBe('number');
    });

    it('propagates monitoring config through correlations', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { memory: true, cpu: true },
      });

      const correlation = chronicle.startCorrelation(
        {
          key: 'test.correlation',
          type: 'correlation',
          doc: 'Test correlation',
          timeout: 1000,
        },
        {},
      );

      correlation.event(sampleEvent, { action: 'corr-event' });

      const payloads = log.mock.calls.map((call) => call[2]);

      // Start event should have perf
      expect(payloads[0]._perf).toBeDefined();
      expect(payloads[0]._perf!.heapUsed).toBeGreaterThan(0);

      // Correlation event should have perf
      expect(payloads[1]._perf).toBeDefined();
      expect(payloads[1]._perf!.heapUsed).toBeGreaterThan(0);
    });
  });

  describe('6.4 Performance Overhead', () => {
    it('has minimal overhead when monitoring disabled', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        // No monitoring
      });

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        chronicle.event(sampleEvent, { action: `test-${i}` });
      }
      const elapsed = Date.now() - start;

      // Should complete quickly (< 100ms for 1000 events)
      expect(elapsed).toBeLessThan(100);
      expect(log.mock.calls.length).toBe(1000);
    });

    it('sampling overhead is acceptable', () => {
      const { backend, log } = createBackend();
      const chronicle = createChronicle({
        backend,
        metadata: {},
        monitoring: { memory: true, cpu: true },
      });

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        chronicle.event(sampleEvent, { action: `test-${i}` });
      }
      const elapsed = Date.now() - start;

      // Even with monitoring, should be reasonable (< 50ms for 100 events)
      expect(elapsed).toBeLessThan(50);

      // Verify all have perf data
      const payloads = log.mock.calls.map((call) => call[2]);
      payloads.forEach((payload) => {
        expect(payload._perf).toBeDefined();
      });
    });
  });
});
