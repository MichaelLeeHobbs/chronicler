import type { LogLevel } from './constants';
import type { ContextRecord, ContextValidationResult } from './context';
import type { EventDefinition, FieldDefs, NoFields, SpanDefinition } from './events';
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

/** Methods every scope (the root chronicle, a fork, a span) has next to its emitters. */
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
   * ambient span; use it for background work started during a request.
   */
  run<T>(fn: () => T): T;
  /** Untyped escape hatch: log at any level without a defined event. */
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  /** Add context to this scope. Existing keys keep their value (first write wins). */
  addContext(context: ContextRecord): ContextValidationResult;
}

/**
 * The emitter tree for a catalog: every event becomes a function and every span a
 * {@link SpanStarter}, at the same path as in the catalog.
 */
export type Emitters<C> = {
  readonly [K in keyof C]: C[K] extends EventDefinition<infer F extends FieldDefs>
    ? Emitter<F>
    : C[K] extends SpanDefinition<
          infer E extends object,
          infer CF extends FieldDefs,
          infer FF extends FieldDefs
        >
      ? SpanStarter<E, CF, FF>
      : Emitters<C[K]>;
};

/**
 * A chronicle: the emitter tree for catalog `C` plus {@link ScopeMethods}.
 * Annotate exported instances with it (`export const chronicle: Chronicle<typeof events>`)
 * to keep generated declaration files small.
 */
export type Chronicle<C> = Emitters<C> & ScopeMethods<Chronicle<C>>;

/** A fork inside a span: the span's own events, sharing its trace and span ids. */
export type SpanFork<E> = Emitters<E> &
  ScopeMethods<SpanFork<E>> & {
    /** W3C trace id of the span, e.g. to propagate to downstream services. */
    readonly traceId: string;
    /** W3C span id of the span. */
    readonly spanId: string;
    /**
     * W3C `traceparent` header for this span (`00-<traceId>-<spanId>-01`). Send it on outgoing
     * requests so the next service continues the trace.
     */
    readonly traceparent: string;
  };

/** Options for starting a span. */
export interface SpanOptions {
  /**
   * Incoming W3C `traceparent` header, e.g. `req.get('traceparent')`. A top-level span joins that
   * trace: it takes the header's trace id, and the header's span id becomes its `parentSpanId`.
   * Ignored inside another span. An invalid header starts a new trace and sets
   * `_validation.invalidTraceparent` on the start event; `undefined` is ignored.
   */
  readonly traceparent?: string | undefined;
}

/**
 * A running span: its events, scope methods and lifecycle. `CF` and `FF` are the extra
 * fields declared with `span({ complete, fail })`.
 */
export type SpanHandle<
  E,
  CF extends FieldDefs = NoFields,
  FF extends FieldDefs = NoFields,
> = SpanFork<E> & {
  /** End the span successfully. Emits `<key>.complete` with `duration` and the declared fields. */
  complete(...fields: EmitterArgs<CF>): void;
  /** End the span with a failure. Emits `<key>.fail` with `duration`, `error` and the declared fields. */
  fail(error?: unknown, ...fields: EmitterArgs<FF>): void;
};

/** Starts a span. Found in the emitter tree where the catalog has a `span()`. */
export interface SpanStarter<E, CF extends FieldDefs = NoFields, FF extends FieldDefs = NoFields> {
  /** Full dotted key of the span. */
  readonly key: string;
  /**
   * Start the span and return its handle. Never throws: past `limits.maxActiveSpans` the span
   * still works but is not counted, and its start event is flagged in `_validation`. Started
   * inside another span, it is nested: its events share the parent's `traceId` and carry the
   * parent's span id as `parentSpanId`.
   */
  begin(context?: ContextRecord, options?: SpanOptions): SpanHandle<E, CF, FF>;
  /**
   * Start the span and run `fn` with it as the ambient scope. The span is not
   * completed when `fn` returns (call `complete()`); it is failed if `fn` throws or rejects.
   */
  run<T>(fn: (span: SpanHandle<E, CF, FF>) => T): T;
  run<T>(context: ContextRecord, fn: (span: SpanHandle<E, CF, FF>) => T): T;
  run<T>(context: ContextRecord, options: SpanOptions, fn: (span: SpanHandle<E, CF, FF>) => T): T;
}

/** The handle type of a span starter: `HandleOf<typeof chronicle.http.request>`. */
export type HandleOf<S> =
  S extends SpanStarter<infer E, infer CF, infer FF> ? SpanHandle<E, CF, FF> : never;

/** The fields object of an event definition or emitter. */
export type FieldsOf<T> =
  T extends EventDefinition<infer F extends FieldDefs>
    ? InferFields<F>
    : T extends Emitter<infer F extends FieldDefs>
      ? InferFields<F>
      : never;
