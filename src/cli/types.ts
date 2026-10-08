/**
 * Shared types for CLI operations
 */

import type { LogLevel } from '../core/constants';

/**
 * A field of a parsed event, reduced to plain data.
 */
export interface ParsedField {
  /** Field type: `string`, `number`, `boolean` or `error`. */
  readonly type: string;
  readonly required: boolean;
  readonly doc: string;
}

/**
 * An event found in a catalog, reduced to plain data.
 */
export interface ParsedEvent {
  /** Full wire key (path-derived, or the `key` override). */
  readonly key: string;
  /** Dotted path of the event inside its catalog. */
  readonly path: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly doc: string;
  readonly fields: Readonly<Record<string, ParsedField>>;
  /** Key of the span this event belongs to, if any. */
  readonly spanKey?: string;
  /** True for the auto-generated `.start` / `.complete` / `.fail` / `.timeout` events. */
  readonly lifecycle: boolean;
}

/**
 * A namespace or span of a catalog, with its direct children.
 */
export interface ParsedEventGroup {
  /** Key prefix of the group's events (`http.request`). */
  readonly key: string;
  /** Dotted path of the group inside its catalog. */
  readonly path: string;
  readonly kind: 'namespace' | 'span';
  /** `group()` doc for a namespace, `doc` for a span; empty when absent. */
  readonly doc: string;
  /** Idle timeout in milliseconds (spans only; `0` = disabled). */
  readonly timeout?: number;
  /** Events defined directly in this group, by name. Lifecycle events are not included. */
  readonly events: Record<string, ParsedEvent>;
  /** Auto-generated lifecycle events (spans only). */
  readonly lifecycleEvents: ParsedEvent[];
  /** Nested groups, by name. */
  readonly groups: Record<string, ParsedEventGroup>;
}

/**
 * Parsed event tree structure
 */
export interface ParsedEventTree {
  /** Every event in definition order, including span lifecycle events (`lifecycle: true`). */
  readonly events: ParsedEvent[];
  /** Top-level namespaces and spans. */
  readonly groups: ParsedEventGroup[];
  /** Events defined at the root of a catalog (not inside any namespace or span). */
  readonly rootEvents: ParsedEvent[];
  /** Names of the module exports the catalogs were read from. */
  readonly catalogExports: string[];
  readonly errors: ValidationError[];
}

/**
 * Validation error from CLI event validation
 */
export interface ValidationError {
  readonly type:
    | 'invalid-catalog'
    | 'duplicate-key'
    | 'reserved-field'
    | 'reserved-prefix'
    | 'invalid-level'
    | 'invalid-timeout'
    | 'missing-doc'
    | 'parse-error';
  readonly message: string;
}
