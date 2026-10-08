import type { LogLevel } from './constants';
import type { ContextRecord, ContextValidationResult } from './context';
import type { CorrelationDefinition, EventDefinition, FieldDefs } from './events';
import type { InferFields } from './fields';

/**
 * Arguments of an emitter: no argument for events without required fields, otherwise the
 * typed fields object. Events that declare no fields accept no extra keys.
 */
export type EmitterArgs<F extends FieldDefs> = [keyof F] extends [never]
  ? [fields?: Record<string, never>]
  : Record<never, never> extends InferFields<F>
    ? [fields?: InferFields<F>]
    : [fields: InferFields<F>];

/** A function that logs one event. `key` is the event's full dotted key. */
export interface Emitter<F extends FieldDefs> {
  (...args: EmitterArgs<F>): void;
  readonly key: string;
}

/** Methods every scope (the root chronicle, a fork, a correlation) has next to its emitters. */
export interface ScopeMethods<Self> {
  /**
   * Create a child scope with its own fork id. `context` overrides inherited values.
   *
   * @throws {ChroniclerError} `FORK_DEPTH_EXCEEDED` past `limits.maxForkDepth`
   */
  fork(context?: ContextRecord): Self;
  /**
   * Run `fn` with this scope as the ambient scope: emitters of the root chronicle called inside
   * `fn`, including after `await`, log to this scope. On the root chronicle, `run` clears any
   * ambient correlation; use it for background work started during a request.
   */
  run<T>(fn: () => T): T;
  /** Untyped escape hatch: log at any level without a defined event. */
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  /** Add context to this scope. Existing keys keep their value (first write wins). */
  addContext(context: ContextRecord): ContextValidationResult;
}

/**
 * The emitter tree for a catalog: every event becomes a function and every correlation a
 * {@link CorrelationStarter}, at the same path as in the catalog.
 */
export type Emitters<C> = {
  readonly [K in keyof C]: C[K] extends EventDefinition<infer F extends FieldDefs>
    ? Emitter<F>
    : C[K] extends CorrelationDefinition<infer E extends object>
      ? CorrelationStarter<E>
      : Emitters<C[K]>;
};

/**
 * A chronicle: the emitter tree for catalog `C` plus {@link ScopeMethods}.
 * Annotate exported instances with it (`export const chronicle: Chronicle<typeof events>`)
 * to keep generated declaration files small.
 */
export type Chronicle<C> = Emitters<C> & ScopeMethods<Chronicle<C>>;

/** A fork inside a correlation: the correlation's own events, sharing its correlation id. */
export type CorrelationFork<E> = Emitters<E> &
  ScopeMethods<CorrelationFork<E>> & {
    /** Id of the correlation, e.g. to propagate to downstream services. */
    readonly correlationId: string;
  };

/** A running correlation: its events, scope methods and lifecycle. */
export type CorrelationHandle<E> = CorrelationFork<E> & {
  /** End the correlation successfully. Emits `<key>.complete` with `duration`. */
  complete(fields?: Record<string, unknown>): void;
  /** End the correlation with a failure. Emits `<key>.fail` with `duration` and `error`. */
  fail(error?: unknown, fields?: Record<string, unknown>): void;
};

/** Starts a correlation. Found in the emitter tree where the catalog has a `correlation()`. */
export interface CorrelationStarter<E> {
  /** Full dotted key of the correlation. */
  readonly key: string;
  /**
   * Start the correlation and return its handle. Never throws: past
   * `limits.maxActiveCorrelations` the correlation still works but is not counted, and its start
   * event is flagged in `_validation`. Started inside another correlation, it is nested: its
   * events carry `parentCorrelationId` and `rootCorrelationId`.
   */
  begin(context?: ContextRecord): CorrelationHandle<E>;
  /**
   * Start the correlation and run `fn` with it as the ambient scope. The correlation is not
   * completed when `fn` returns (call `complete()`); it is failed if `fn` throws or rejects.
   */
  run<T>(fn: (correlation: CorrelationHandle<E>) => T): T;
  run<T>(context: ContextRecord, fn: (correlation: CorrelationHandle<E>) => T): T;
}

/** The handle type of a correlation starter: `HandleOf<typeof chronicle.http.request>`. */
export type HandleOf<S> = S extends CorrelationStarter<infer E> ? CorrelationHandle<E> : never;

/** The fields object of an event definition or emitter. */
export type FieldsOf<T> =
  T extends EventDefinition<infer F extends FieldDefs>
    ? InferFields<F>
    : T extends Emitter<infer F extends FieldDefs>
      ? InferFields<F>
      : never;
