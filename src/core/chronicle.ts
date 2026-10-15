import { AsyncLocalStorage } from 'node:async_hooks';

import {
  callBackendMethod,
  type CorrelationState,
  createConsoleBackend,
  type LogBackend,
  type LogPayload,
} from './backend';
import type { Chronicle, CorrelationHandle } from './chronicle-types';
import {
  DEFAULT_MAX_ACTIVE_CORRELATIONS,
  DEFAULT_MAX_CONTEXT_KEYS,
  DEFAULT_MAX_FORK_DEPTH,
  DEFAULT_REQUIRED_LEVELS,
  FORK_ID_SEPARATOR,
  LOG_LEVELS,
  type LogLevel,
  ROOT_FORK_ID,
} from './constants';
import { type ContextRecord, ContextStore } from './context';
import { CorrelationTimer } from './correlation-timer';
import { ChroniclerError } from './errors';
import {
  type AnyCorrelationDefinition,
  type AnyEventDefinition,
  type CheckCatalog,
  defineEvents,
  type FieldDefs,
  isCorrelationDefinition,
  isEventDefinition,
  type LifecycleEvents,
  lifecycleEvents,
} from './events';
import { assertNoReservedKeys } from './reserved';
import {
  buildValidationMetadata,
  sanitizeLogFields,
  validateFields,
  type ValidationMetadata,
} from './validation';

export interface ChroniclerLimits {
  readonly maxContextKeys?: number;
  /**
   * Maximum fork nesting depth. A depth of N means N levels of nesting
   * from root (e.g. depth 3 allows root → child → grandchild → great-grandchild).
   * Defaults to {@link DEFAULT_MAX_FORK_DEPTH}.
   */
  readonly maxForkDepth?: number;
  /**
   * Number of active correlations to track. Past it, new correlations still work but aren't
   * counted, and their start event is flagged with `_validation.correlationLimitExceeded`.
   */
  readonly maxActiveCorrelations?: number;
}

export interface ChroniclerConfig<C extends object = object> {
  /** The event catalog, usually from `defineEvents()`. */
  readonly events: C;
  /**
   * Where events go. Defaults to the console. Pass a function to create the backend lazily on
   * the first event, e.g. when transports need config that isn't ready at import time.
   */
  readonly backend?: LogBackend | (() => LogBackend);
  /** Context attached to every event. */
  readonly metadata?: ContextRecord;
  readonly correlationIdGenerator?: () => string;
  readonly limits?: ChroniclerLimits;
  /**
   * When `true`, throws a `ChroniclerError` with code `FIELD_VALIDATION`
   * for field validation errors (missing required fields, type mismatches).
   * Useful for CI/CD enforcement. Defaults to `false`.
   */
  readonly strict?: boolean;
  /**
   * Minimum log level to emit. Events below this level are silently dropped.
   * Uses priority ordering: fatal(0) > critical(1) > ... > trace(8).
   * Defaults to `'trace'` (all events emitted).
   */
  readonly minLevel?: LogLevel;
}

interface ResolvedConfig {
  readonly backend: () => LogBackend;
  readonly maxContextKeys: number;
  readonly maxForkDepth: number;
  readonly maxActiveCorrelations: number;
  readonly minLevel: number;
  readonly strict: boolean;
  readonly correlationIdGenerator: () => string;
}

type CorrelationStatus = 'active' | CorrelationState;

interface Correlation {
  readonly id: string;
  readonly parentId: string | undefined;
  readonly rootId: string;
  readonly lifecycle: LifecycleEvents;
  readonly startedAt: number;
  /** Scope the correlation was started from; the ambient fallback once it has finished. */
  readonly outer: Scope;
  timer: CorrelationTimer | undefined;
  status: CorrelationStatus;
  /** Whether this correlation counts toward `maxActiveCorrelations`. */
  tracked: boolean;
}

const isFinished = (correlation: Correlation): boolean =>
  correlation.status === 'completed' || correlation.status === 'failed';

/** Shared state of one chronicle: config, the ambient store and the correlation counter. */
class Runtime {
  private als: AsyncLocalStorage<Scope> | undefined;
  activeCorrelations = 0;
  /** Backend that replaces the configured one, set by `captureEvents()` in tests. */
  backendOverride: LogBackend | undefined;

  constructor(readonly config: ResolvedConfig) {}

  backend(): LogBackend {
    return this.backendOverride ?? this.config.backend();
  }

  /** Run `fn` with `scope` ambient. The store is created on first use, so apps that never call `run` pay nothing. */
  runIn<T>(scope: Scope, fn: () => T): T {
    this.als ??= new AsyncLocalStorage<Scope>();
    return this.als.run(scope, fn);
  }

  /**
   * The scope that ambient emitters log to: the ambient scope, or `root`. Finished
   * correlations are skipped and reported as `staleId`.
   */
  current(root: Scope): ResolvedScope {
    let scope = this.als?.getStore() ?? root;
    let staleId: string | undefined;
    while (scope.correlation !== undefined && isFinished(scope.correlation)) {
      staleId ??= scope.correlation.id;
      scope = scope.correlation.outer;
    }
    return staleId === undefined ? { scope } : { scope, staleId };
  }
}

interface ResolvedScope {
  readonly scope: Scope;
  readonly staleId?: string;
}

const staleMetadata = (staleId: string | undefined): ValidationMetadata | undefined =>
  staleId === undefined ? undefined : { staleCorrelationId: staleId };

const mergeValidation = (
  a: ValidationMetadata | undefined,
  b: ValidationMetadata | undefined,
): ValidationMetadata | undefined => (a && b ? { ...a, ...b } : (a ?? b));

const assertValid = (def: AnyEventDefinition, result: ReturnType<typeof validateFields>): void => {
  const issues: string[] = [];
  if (result.missingFields.length > 0) {
    issues.push(`missing required fields: ${result.missingFields.join(', ')}`);
  }
  if (result.typeErrors.length > 0) {
    issues.push(`type errors on fields: ${result.typeErrors.join(', ')}`);
  }
  if (result.invalidValues.length > 0) {
    issues.push(`invalid values on fields: ${result.invalidValues.join(', ')}`);
  }
  if (issues.length > 0) {
    throw new ChroniclerError(
      'FIELD_VALIDATION',
      `Event "${def.key}" failed validation: ${issues.join('; ')}`,
    );
  }
};

/**
 * One logging scope: a context store, a fork id and an optional correlation.
 * The root chronicle, forks and correlations are all scopes.
 */
class Scope {
  private forkCounter = 0;

  constructor(
    readonly runtime: Runtime,
    readonly context: ContextStore,
    readonly forkId: string,
    readonly correlation: Correlation | undefined,
  ) {}

  /** Log an event defined in the catalog. */
  emit(
    def: AnyEventDefinition,
    fields: Record<string, unknown> | undefined,
    extra?: ValidationMetadata,
    reportedStatus: CorrelationStatus | undefined = this.correlation?.status,
  ): void {
    const { config } = this.runtime;
    if (LOG_LEVELS[def.level] > config.minLevel) return;
    const result = validateFields(def, fields);
    if (config.strict) assertValid(def, result);
    const validation = mergeValidation(buildValidationMetadata(result), extra);
    const payload: LogPayload = {
      ...this.basePayload(def.key, result.normalizedFields, reportedStatus),
      ...(validation ? { _validation: validation } : {}),
    };
    callBackendMethod(this.runtime.backend(), def.level, def.message, payload);
    this.touch();
  }

  /** Untyped escape hatch. */
  log(level: LogLevel, message: string, fields: Record<string, unknown>, staleId?: string): void {
    const { config } = this.runtime;
    if (LOG_LEVELS[level] > config.minLevel) return;
    const validation = staleMetadata(staleId);
    const payload: LogPayload = {
      ...this.basePayload('', sanitizeLogFields(fields), this.correlation?.status),
      ...(validation ? { _validation: validation } : {}),
    };
    callBackendMethod(this.runtime.backend(), level, message, payload);
    this.touch();
  }

  /** Create a child scope with the next fork id. */
  fork(context: ContextRecord = {}): Scope {
    const { config } = this.runtime;
    this.forkCounter++;
    const childForkId =
      this.forkId === ROOT_FORK_ID
        ? String(this.forkCounter)
        : `${this.forkId}${FORK_ID_SEPARATOR}${this.forkCounter}`;
    const depth = childForkId.split(FORK_ID_SEPARATOR).length;
    if (depth > config.maxForkDepth) {
      throw new ChroniclerError(
        'FORK_DEPTH_EXCEEDED',
        `Fork depth ${depth} exceeds maximum allowed depth of ${config.maxForkDepth}`,
      );
    }
    const { store } = this.context.derive(context);
    this.touch();
    return new Scope(this.runtime, store, childForkId, this.correlation);
  }

  /** Start a correlation from this scope. Nested when this scope is inside an unfinished correlation. */
  startCorrelation(def: AnyCorrelationDefinition, context: ContextRecord = {}): Scope {
    const runtime = this.runtime;
    const { config } = runtime;
    const parent =
      this.correlation !== undefined && !isFinished(this.correlation)
        ? this.correlation
        : undefined;
    const tracked = runtime.activeCorrelations < config.maxActiveCorrelations;
    if (tracked) runtime.activeCorrelations++;
    const id = config.correlationIdGenerator();
    const correlation: Correlation = {
      id,
      parentId: parent?.id,
      rootId: parent?.rootId ?? id,
      lifecycle: lifecycleEvents(def.key, def),
      startedAt: Date.now(),
      outer: this,
      timer: undefined,
      status: 'active',
      tracked,
    };
    const scope = new Scope(runtime, this.context.derive(context).store, this.forkId, correlation);
    correlation.timer = new CorrelationTimer(def.timeout, () => scope.endCorrelation('timedOut'));
    correlation.timer.start();
    scope.emit(
      correlation.lifecycle.start,
      {},
      tracked ? undefined : { correlationLimitExceeded: true },
    );
    return scope;
  }

  /**
   * End this scope's correlation. `complete()` and `fail()` are accepted once, also after a
   * timeout (a late end reports the real duration); a timeout only fires while active.
   */
  endCorrelation(status: CorrelationState, error?: unknown, fields: Record<string, unknown> = {}) {
    const correlation = this.correlation;
    const previous = correlation && this.release(correlation, status);
    if (correlation === undefined || previous === undefined) return;
    const { lifecycle } = correlation;
    if (status === 'timedOut') {
      this.emit(lifecycle.timeout, {}, undefined, previous);
      return;
    }
    const duration = Date.now() - correlation.startedAt;
    const errorField =
      status === 'failed' && error !== undefined ? { error: describeError(error) } : {};
    const def = status === 'completed' ? lifecycle.complete : lifecycle.fail;
    this.emit(def, { duration, ...errorField, ...fields }, undefined, previous);
  }

  /** Move a correlation to `status`. Returns its previous status, or `undefined` if the move isn't allowed. */
  private release(
    correlation: Correlation,
    status: CorrelationState,
  ): CorrelationStatus | undefined {
    if (isFinished(correlation)) return undefined;
    if (status === 'timedOut' && correlation.status !== 'active') return undefined;
    const previous = correlation.status;
    correlation.timer?.clear();
    if (correlation.tracked) {
      this.runtime.activeCorrelations--;
      correlation.tracked = false;
    }
    correlation.status = status;
    return previous;
  }

  private touch(): void {
    if (this.correlation?.status === 'active') this.correlation.timer?.touch();
  }

  private basePayload(
    eventKey: string,
    fields: Record<string, unknown>,
    status: CorrelationStatus | undefined,
  ): LogPayload {
    const correlation = this.correlation;
    return {
      eventKey,
      fields,
      correlationId: correlation?.id ?? '',
      ...(correlation?.parentId !== undefined ? { parentCorrelationId: correlation.parentId } : {}),
      ...(correlation !== undefined ? { rootCorrelationId: correlation.rootId } : {}),
      ...(status !== undefined && status !== 'active' ? { correlationState: status } : {}),
      forkId: this.forkId,
      metadata: this.context.snapshot(),
      timestamp: new Date().toISOString(),
    };
  }
}

type Resolve = () => ResolvedScope;

/** Turn any thrown value into something the `error` field accepts, so the reason isn't lost. */
const describeError = (error: unknown): Error | string => {
  if (error instanceof Error || typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

/** Fail a correlation from an error path; never let logging replace or add to the caller's error. */
const failQuietly = (handle: Handle, err: unknown): void => {
  try {
    handle.fail(err);
  } catch {
    // Logging must not mask the caller's error or cause an unhandled rejection.
  }
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

const makeEmitter = (def: AnyEventDefinition, resolve: Resolve) => {
  const emitter = (fields?: Record<string, unknown>): void => {
    const { scope, staleId } = resolve();
    scope.emit(def, fields, staleMetadata(staleId));
  };
  Object.defineProperty(emitter, 'key', { value: def.key, enumerable: true });
  return emitter;
};

type Handle = CorrelationHandle<object, FieldDefs, FieldDefs>;

/** Run `fn` with the correlation ambient; fail the correlation if `fn` throws or rejects. */
const runCorrelation = <T>(handle: Handle, fn: (handle: Handle) => T): T => {
  let result: T;
  try {
    result = handle.run(() => fn(handle));
  } catch (err: unknown) {
    failQuietly(handle, err);
    throw err;
  }
  if (isPromiseLike(result)) {
    result.then(undefined, (err: unknown) => failQuietly(handle, err));
  }
  return result;
};

const makeStarter = (def: AnyCorrelationDefinition, resolve: Resolve) => {
  const begin = (context?: ContextRecord): Handle =>
    makeCorrelationTree(def, resolve().scope.startCorrelation(def, context), true) as Handle;
  return {
    key: def.key,
    begin,
    run: <T>(
      contextOrFn: ContextRecord | ((handle: Handle) => T),
      maybeFn?: (handle: Handle) => T,
    ): T => {
      const [context, fn] =
        typeof contextOrFn === 'function' ? [undefined, contextOrFn] : [contextOrFn, maybeFn];
      if (fn === undefined) {
        throw new TypeError('run() requires a function');
      }
      return runCorrelation(begin(context), fn);
    },
  };
};

/**
 * Bind every event and correlation under `node` into `target`. Namespaces are bound lazily, on
 * first access, so forks of a large catalog stay cheap.
 */
const bindNode = (node: object, resolve: Resolve, target: Record<string, unknown>): void => {
  for (const [name, child] of Object.entries(node as Record<string, unknown>)) {
    if (isEventDefinition(child)) {
      target[name] = makeEmitter(child, resolve);
    } else if (isCorrelationDefinition(child)) {
      target[name] = makeStarter(child, resolve);
    } else {
      Object.defineProperty(target, name, {
        enumerable: true,
        configurable: true,
        get() {
          const bound: Record<string, unknown> = {};
          bindNode(child as object, resolve, bound);
          Object.defineProperty(target, name, { value: bound, enumerable: true });
          return bound;
        },
      });
    }
  }
};

const addScopeMethods = (
  tree: Record<string, unknown>,
  resolve: Resolve,
  runScope: () => Scope,
  fork: (scope: Scope, context?: ContextRecord) => unknown,
): void => {
  tree.fork = (context?: ContextRecord) => fork(resolve().scope, context);
  tree.run = <T>(fn: () => T): T => {
    const scope = runScope();
    return scope.runtime.runIn(scope, fn);
  };
  tree.log = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
    const { scope, staleId } = resolve();
    scope.log(level, message, fields, staleId);
  };
  tree.addContext = (context: ContextRecord) => resolve().scope.context.add(context);
};

const makeCorrelationTree = (
  def: AnyCorrelationDefinition,
  scope: Scope,
  withLifecycle: boolean,
): Record<string, unknown> => {
  const resolve: Resolve = () => ({ scope });
  const tree: Record<string, unknown> = {};
  bindNode(def.events, resolve, tree);
  tree.correlationId = scope.correlation?.id ?? '';
  addScopeMethods(
    tree,
    resolve,
    () => scope,
    (from, context) => makeCorrelationTree(def, from.fork(context), false),
  );
  if (withLifecycle) {
    tree.complete = (fields?: Record<string, unknown>) =>
      scope.endCorrelation('completed', undefined, fields);
    tree.fail = (error?: unknown, fields?: Record<string, unknown>) =>
      scope.endCorrelation('failed', error, fields);
  }
  return tree;
};

/**
 * Non-enumerable hook on every chronicle tree, used by `@ubercode/chronicler/testing` to swap the
 * backend of an existing chronicle. `Symbol.for` so it works across copies of the package.
 */
export const BACKEND_HOOK = Symbol.for('chronicler.backendHook');

/** The hook stored under {@link BACKEND_HOOK}. */
export interface BackendHook {
  /** Replace the backend (or restore the configured one with `undefined`); returns the previous override. */
  setOverride(backend: LogBackend | undefined): LogBackend | undefined;
}

const makeChronicleTree = (
  catalog: object,
  resolve: Resolve,
  runScope: () => Scope,
): Record<string, unknown> => {
  const tree: Record<string, unknown> = {};
  bindNode(catalog, resolve, tree);
  const { runtime } = runScope();
  const hook: BackendHook = {
    setOverride(backend) {
      const previous = runtime.backendOverride;
      runtime.backendOverride = backend;
      return previous;
    },
  };
  Object.defineProperty(tree, BACKEND_HOOK, { value: hook, enumerable: false });
  addScopeMethods(tree, resolve, runScope, (from, context) => {
    const child = from.fork(context);
    return makeChronicleTree(
      catalog,
      () => ({ scope: child }),
      () => child,
    );
  });
  return tree;
};

const checkBackend = (backend: LogBackend): LogBackend => {
  const missingLevels = DEFAULT_REQUIRED_LEVELS.filter(
    (level) => typeof backend[level] !== 'function',
  );
  if (missingLevels.length > 0) {
    throw new ChroniclerError(
      'UNSUPPORTED_LOG_LEVEL',
      `Log backend is missing level(s): ${missingLevels.join(', ')}. A valid backend must implement all 9 levels: ${DEFAULT_REQUIRED_LEVELS.join(', ')}. Use createBackend() for automatic fallback handling.`,
    );
  }
  return backend;
};

const resolveBackend = (backend: ChroniclerConfig['backend']): (() => LogBackend) => {
  if (typeof backend === 'function') {
    let resolved: LogBackend | undefined;
    return () => (resolved ??= checkBackend(backend()));
  }
  const resolved = checkBackend(backend ?? createConsoleBackend());
  return () => resolved;
};

// eslint-disable-next-line complexity -- config resolution checks each optional setting
const resolveConfig = (config: ChroniclerConfig): ResolvedConfig => {
  const reservedMetadata = assertNoReservedKeys(config.metadata ?? {});
  if (reservedMetadata.length > 0) {
    throw new ChroniclerError(
      'RESERVED_FIELD',
      `Reserved fields cannot be used in metadata: ${reservedMetadata.join(', ')}`,
    );
  }
  return {
    backend: resolveBackend(config.backend),
    maxContextKeys: config.limits?.maxContextKeys ?? DEFAULT_MAX_CONTEXT_KEYS,
    maxForkDepth: config.limits?.maxForkDepth ?? DEFAULT_MAX_FORK_DEPTH,
    maxActiveCorrelations: config.limits?.maxActiveCorrelations ?? DEFAULT_MAX_ACTIVE_CORRELATIONS,
    minLevel: LOG_LEVELS[config.minLevel ?? 'trace'],
    strict: config.strict ?? false,
    correlationIdGenerator: config.correlationIdGenerator ?? (() => crypto.randomUUID()),
  };
};

/**
 * Create a chronicle: the typed emitter tree for an event catalog.
 *
 * @example
 * ```typescript
 * export const chronicle = createChronicle({ events, backend, metadata: { service: 'api' } });
 * export const { admin, http } = chronicle;
 *
 * admin.login({ userId: 'u-1', success: true });
 * ```
 *
 * @param config - The catalog plus backend, metadata, limits and validation options
 * @returns The emitter tree with `fork`, `run`, `log` and `addContext`
 * @throws {ChroniclerError} `INVALID_CATALOG` if the catalog is malformed
 * @throws {ChroniclerError} `UNSUPPORTED_LOG_LEVEL` if the backend is missing required methods
 * @throws {ChroniclerError} `RESERVED_FIELD` if `config.metadata` contains reserved field names
 */
export const createChronicle = <const C extends object>(
  config: ChroniclerConfig<C> & { readonly events: CheckCatalog<C> },
): Chronicle<C> => {
  const catalog = defineEvents(config.events as object);
  const resolved = resolveConfig(config);
  const runtime = new Runtime(resolved);
  const root = new Scope(
    runtime,
    new ContextStore(config.metadata ?? {}, resolved.maxContextKeys),
    ROOT_FORK_ID,
    undefined,
  );
  return makeChronicleTree(
    catalog,
    () => runtime.current(root),
    () => root,
  ) as Chronicle<C>;
};
