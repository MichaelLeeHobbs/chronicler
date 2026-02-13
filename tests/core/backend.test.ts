import { describe, expect, it, vi } from 'vitest';

import {
  callBackendMethod,
  createBackend,
  createConsoleBackend,
  type LogBackend,
  LogLevel,
  type LogPayload,
  validateBackendMethods,
} from '../../src/core/backend';
import { MockLoggerBackend } from '../helpers/mock-logger';

describe('Backend Validation', () => {
  describe('validateBackendMethods', () => {
    it('returns empty array when all required methods exist', () => {
      // @ts-expect-error Testing partial backend
      const backend: LogBackend = {
        info: () => void 0,
        error: () => void 0,
        warn: () => void 0,
      };

      const missing = validateBackendMethods(backend, ['info', 'error', 'warn']);
      expect(missing).toEqual([]);
    });

    it('returns missing levels when methods do not exist', () => {
      // @ts-expect-error Testing partial backend
      const backend: LogBackend = {
        info: () => void 0,
      };

      const missing = validateBackendMethods(backend, ['info', 'error', 'warn']);
      expect(missing).toEqual(['error', 'warn']);
    });

    it('detects non-function properties as missing', () => {
      const backend: LogBackend = {
        info: () => void 0,
        // @ts-expect-error Testing invalid backend
        error: 'not a function',
      };

      const missing = validateBackendMethods(backend, ['info', 'error']);
      expect(missing).toEqual(['error']);
    });

    it('handles empty backend object', () => {
      // @ts-expect-error Testing partial backend
      const backend: LogBackend = {};

      const missing = validateBackendMethods(backend, ['info', 'error', 'warn']);
      expect(missing).toEqual(['info', 'error', 'warn']);
    });

    it('validates all Chronicler log levels', () => {
      const backend: LogBackend = {
        fatal: () => void 0,
        critical: () => void 0,
        alert: () => void 0,
        error: () => void 0,
        warn: () => void 0,
        audit: () => void 0,
        info: () => void 0,
        debug: () => void 0,
        trace: () => void 0,
      };

      const allLevels: LogLevel[] = [
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
      const missing = validateBackendMethods(backend, allLevels);
      expect(missing).toEqual([]);
    });
  });

  describe('callBackendMethod', () => {
    it('calls the backend method with message and payload', () => {
      const mock = new MockLoggerBackend();

      const payload: LogPayload = {
        eventKey: 'test',
        fields: {},
        correlationId: 'corr-123',
        forkId: '0',
        metadata: {},
        timestamp: '2025-11-16T00:00:00Z',
      };

      callBackendMethod(mock.backend, 'info', 'Test message', payload);

      const capturedPayload = mock.getLastPayload();
      expect(capturedPayload).toEqual(payload);
      expect(capturedPayload?.eventKey).toBe('test');

      // Verify the info method was called
      expect(mock.backend.info).toHaveBeenCalledTimes(1);
      expect(mock.backend.info).toHaveBeenCalledWith('Test message', payload);
    });

    it('throws error when method does not exist', () => {
      // @ts-expect-error Testing partial backend
      const backend: LogBackend = {};
      const payload: LogPayload = {
        eventKey: 'test',
        fields: {},
        correlationId: 'corr-123',
        forkId: '0',
        metadata: {},
        timestamp: '2025-11-16T00:00:00Z',
      };

      expect(() => {
        callBackendMethod(backend, 'info', 'Test', payload);
      }).toThrow('Backend does not support log level: info');
    });

    it('throws error when property is not a function', () => {
      const backend: LogBackend = {
        // @ts-expect-error Testing invalid backend
        info: 'not a function',
      };
      const payload: LogPayload = {
        eventKey: 'test',
        fields: {},
        correlationId: 'corr-123',
        forkId: '0',
        metadata: {},
        timestamp: '2025-11-16T00:00:00Z',
      };

      expect(() => {
        callBackendMethod(backend, 'info', 'Test', payload);
      }).toThrow('Backend does not support log level: info');
    });

    it('passes complete payload structure to backend', () => {
      const mock = new MockLoggerBackend();

      const payload: LogPayload = {
        eventKey: 'test.event',
        fields: { userId: '123', action: 'test' },
        correlationId: 'corr-456',
        forkId: '1.2',
        metadata: { service: 'test-service' },
        timestamp: '2025-11-16T00:00:00Z',
        _validation: { missingFields: ['field1'] },
        _perf: { heapUsed: 1000, heapTotal: 2000, external: 100, rss: 3000 },
      };

      callBackendMethod(mock.backend, 'info', 'Test', payload);

      const capturedPayload = mock.getLastPayload();
      expect(capturedPayload).toEqual(payload);
      expect(capturedPayload?._validation).toEqual({ missingFields: ['field1'] });
      expect(capturedPayload?._perf).toBeDefined();
      expect(capturedPayload?._perf?.heapUsed).toBe(1000);
    });
  });
});

const ALL_LEVELS: LogLevel[] = [
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

const testPayload: LogPayload = {
  eventKey: 'test',
  fields: {},
  correlationId: 'c-1',
  forkId: '0',
  metadata: {},
  timestamp: '2025-01-01T00:00:00Z',
};

describe('createConsoleBackend', () => {
  it('returns a backend with all 9 level methods', () => {
    const backend = createConsoleBackend();
    for (const level of ALL_LEVELS) {
      expect(typeof backend[level]).toBe('function');
    }
  });

  it('passes backend validation', () => {
    const backend = createConsoleBackend();
    const missing = validateBackendMethods(backend, ALL_LEVELS);
    expect(missing).toEqual([]);
  });

  it('calls the correct console methods', () => {
    const backend = createConsoleBackend();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(vi.fn());
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(vi.fn());

    backend.fatal('fatal msg', testPayload);
    expect(errorSpy).toHaveBeenCalledWith('fatal msg', testPayload);

    backend.warn('warn msg', testPayload);
    expect(warnSpy).toHaveBeenCalledWith('warn msg', testPayload);

    backend.info('info msg', testPayload);
    expect(infoSpy).toHaveBeenCalledWith('info msg', testPayload);

    backend.debug('debug msg', testPayload);
    expect(debugSpy).toHaveBeenCalledWith('debug msg', testPayload);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });
});

describe('createBackend', () => {
  it('uses provided handlers directly', () => {
    const handler = vi.fn();
    const backend = createBackend({ info: handler });

    backend.info('msg', testPayload);
    expect(handler).toHaveBeenCalledWith('msg', testPayload);
  });

  it('falls back through the chain to a provided handler', () => {
    const errorHandler = vi.fn();
    const backend = createBackend({ error: errorHandler });

    // fatal falls back to error (via critical → error)
    backend.fatal('fatal msg', testPayload);
    expect(errorHandler).toHaveBeenCalledWith('fatal msg', testPayload);
  });

  it('falls back to console when no handler matches', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(vi.fn());
    const backend = createBackend({});

    backend.info('msg', testPayload);
    expect(infoSpy).toHaveBeenCalledWith('msg', testPayload);

    infoSpy.mockRestore();
  });

  it('passes backend validation', () => {
    const backend = createBackend({});
    const missing = validateBackendMethods(backend, ALL_LEVELS);
    expect(missing).toEqual([]);
  });
});
