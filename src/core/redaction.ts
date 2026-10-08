import { createHmac } from 'node:crypto';

import { ChroniclerError } from './errors';
import type { FieldBuilder } from './fields';

/** What happens to a sensitive value before the payload reaches the backend. */
export type RedactionMode = 'mask' | 'hash' | 'drop';

/** Redaction settings of a chronicle. */
export interface RedactionConfig {
  /**
   * `'mask'` (default) replaces the value with `[REDACTED]`. `'hash'` replaces it with an
   * HMAC-SHA256 of the value (`hmac:<hex>`), so equal values still match across events without
   * being readable; it requires `hashKey`. `'drop'` removes the field.
   */
  readonly mode?: RedactionMode;
  /** Secret key for `'hash'` mode. Keep it out of the logs and stable across deploys. */
  readonly hashKey?: string | undefined;
  /**
   * Names to redact wherever they appear at the top level of `fields` (including untyped
   * `log()` fields and undeclared fields) or of the context in `metadata`, e.g. `['email']`.
   */
  readonly keys?: readonly string[];
}

/** Placeholder written in place of a masked value. */
export const REDACTED = '[REDACTED]';

/** Applies a chronicle's redaction settings to payload records. */
export interface Redactor {
  /** Redact sensitive declared fields and `keys` in an event's normalized fields. */
  fields(
    defs: Readonly<Record<string, FieldBuilder>>,
    fields: Record<string, unknown>,
  ): Record<string, unknown>;
  /** Redact `keys` in an untyped record (`log()` fields, context). */
  record<T extends Record<string, unknown>>(record: T): T;
}

const serialize = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));

/**
 * Build a redactor from the chronicle config.
 *
 * @throws {ChroniclerError} `INVALID_CONFIG` when `mode` is `'hash'` without a `hashKey`
 */
export const createRedactor = (config: RedactionConfig = {}): Redactor => {
  const mode = config.mode ?? 'mask';
  if (mode === 'hash' && (config.hashKey === undefined || config.hashKey === '')) {
    throw new ChroniclerError('INVALID_CONFIG', "redact.mode 'hash' requires redact.hashKey");
  }
  const keys = new Set(config.keys ?? []);
  const replace = (value: unknown): unknown =>
    mode === 'hash'
      ? `hmac:${createHmac('sha256', config.hashKey ?? '')
          .update(serialize(value))
          .digest('hex')}`
      : REDACTED;

  const redact = (
    record: Record<string, unknown>,
    isSensitive: (name: string) => boolean,
  ): Record<string, unknown> => {
    let result: Record<string, unknown> | undefined;
    for (const [name, value] of Object.entries(record)) {
      if (!isSensitive(name)) continue;
      result ??= { ...record };
      if (mode === 'drop') delete result[name];
      else result[name] = replace(value);
    }
    return result ?? record;
  };

  return {
    fields: (defs, fields) =>
      redact(fields, (name) => keys.has(name) || defs[name]?._sensitive === true),
    record: <T extends Record<string, unknown>>(record: T): T =>
      keys.size === 0 ? record : (redact(record, (name) => keys.has(name)) as T),
  };
};
