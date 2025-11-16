import { vi } from 'vitest';

import type { LogBackend, LogPayload } from '../../src/core/backend';

/**
 * Creates a mock backend logger for testing
 * Tracks all log calls and provides helper methods to query logs
 */
export class MockLoggerBackend {
  private logs: {
    level: string;
    message: string;
    payload: LogPayload;
  }[] = [];

  // The actual backend object that satisfies LogBackend type
  public readonly backend: LogBackend;

  constructor() {
    // Create backend with all log level methods
    this.backend = {
      fatal: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('fatal', message, payload),
      ),
      critical: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('critical', message, payload),
      ),
      alert: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('alert', message, payload),
      ),
      error: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('error', message, payload),
      ),
      warn: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('warn', message, payload),
      ),
      audit: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('audit', message, payload),
      ),
      info: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('info', message, payload),
      ),
      debug: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('debug', message, payload),
      ),
      trace: vi.fn<(message: string, payload: LogPayload) => void>((message, payload) =>
        this.capture('trace', message, payload),
      ),
    };
  }

  private capture(level: string, message: string, payload: LogPayload): void {
    this.logs.push({ level, message, payload });
  }

  /**
   * Get all captured payloads
   */
  getPayloads(): LogPayload[] {
    return this.logs.map((log) => log.payload);
  }

  /**
   * Find first log by event key
   */
  findByKey(key: string): LogPayload | undefined {
    return this.getPayloads().find((p) => p.eventKey === key);
  }

  /**
   * Find all logs by event key
   */
  findAllByKey(key: string): LogPayload[] {
    return this.getPayloads().filter((p) => p.eventKey === key);
  }

  /**
   * Find first log by level
   */
  findByLevel(level: string): LogPayload | undefined {
    return this.logs.find((log) => log.level === level)?.payload;
  }

  /**
   * Find all logs by level
   */
  findAllByLevel(level: string): LogPayload[] {
    return this.logs.filter((log) => log.level === level).map((log) => log.payload);
  }

  /**
   * Get the most recent log payload
   */
  getLastPayload(): LogPayload | undefined {
    return this.logs.at(-1)?.payload;
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Get call count for a specific level
   */
  getCallCount(level: string): number {
    const method = this[level as keyof this];
    if (typeof method === 'function' && 'mock' in method) {
      return (
        method.mock as {
          calls: unknown[][];
        }
      ).calls.length;
    }
    return 0;
  }
}
