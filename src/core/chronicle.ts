import {
  callBackendMethod,
  createConsoleBackend,
  type LogBackend,
  type LogLevel,
  type LogPayload,
} from './backend';
import {
  DEFAULT_MAX_ACTIVE_CORRELATIONS,
  DEFAULT_MAX_CONTEXT_KEYS,
  DEFAULT_MAX_FORK_DEPTH,
  DEFAULT_REQUIRED_LEVELS,
  FORK_ID_SEPARATOR,
  LOG_LEVELS,
  ROOT_FORK_ID,
} from './constants';
import { type ContextRecord, ContextStore, type ContextValidationResult } from './context';
import { ChroniclerError } from './errors';
import {
  type CorrelationAutoEvents,
  type CorrelationEventGroup,
  defineCorrelationGroup,
  type EventDefinition,
  type EventFields,
  type EventRecord,
} from './events';
import { assertNoReservedKeys } from './reserved';
import { buildValidationMetadata, sanitizeLogFields, validateFields } from './validation';

export interface ChroniclerLimits {
  readonly maxContextKeys?: number;
  /**
   * Maximum fork nesting depth. A depth of N means N levels of nesting
   * from root (e.g. depth 3 allows root → child → grandchild → great-grandchild).
   * Defaults to {@link DEFAULT_MAX_FORK_DEPTH}.
   */
  readonly maxForkDepth?: number;
  readonly maxActiveCorrelations?: number;
}

export interface ChroniclerConfig {
  readonly backend?: LogBackend;
  readonly metadata: Record<string, string | number | boolean | null>;
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

interface ResolvedLimits {
  readonly maxContextKeys: number;
  readonly maxForkDepth: number;
  readonly maxActiveCorrelations: number;
}

type ResolvedChroniclerConfig = Omit<ChroniclerConfig, 'backend' | 'limits' | 'minLevel'> & {
  readonly backend: LogBackend;
  readonly limits: ResolvedLimits;
  readonly minLevel: number;
};

export interface Chronicler {
  /** Emit a typed event. Fields are validated against the event definition. */
  event<E extends EventDefinition>(event: E, fields: EventFields<E>): void;

  /**
   * Untyped escape hatch — log at any level without a pre-defined event.
   * Useful for incremental adoption or ad-hoc debugging.
   */
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;

  /** Add key-value context that is attached to all subsequent events. */
  addContext(context: ContextRecord): ContextValidationResult;

  /** Start a correlation — a logical unit of work with lifecycle events. */
  startCorrelation(group: CorrelationEventGroup, metadata?: ContextRecord): CorrelationChronicle;

  /** Create an isolated child chronicle that inherits context. */
  fork(context?: ContextRecord): Chronicler;
}

/**
 * A correlation represents a logical unit of work with a defined lifecycle.
 *
 * Unlike a root Chronicler, a correlation:
 * - Has a single shared correlation ID for all events
 * - Has lifecycle events (start, complete, fail, timeout)
 * - Can timeout if not completed within the configured duration
 * - Cannot start nested correlations (use fork() for parallel work within a correlation)
 */
export interface CorrelationChronicle {
  /** Emit a typed event within this correlation. */
  event<E extends EventDefinition>(event: E, fields: EventFields<E>): void;

  /**
   * Untyped escape hatch — log at any level without a pre-defined event.
   * Useful for incremental adoption or ad-hoc debugging.
   */
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;

  /** Add key-value context that is attached to all subsequent events. */
  addContext(context: ContextRecord): ContextValidationResult;

  /** Create an isolated child chronicle that inherits context. */
  fork(context?: ContextRecord): Chronicler;

  /** Mark the correlation as successfully completed. Emits the `.complete` event. */
  complete(fields?: Record<string, unknown>): void;

  /** Mark the correlation as failed. Emits the `.fail` event at error level. */
  fail(error?: unknown, fields?: Record<string, unknown>): void;

  /** Mark the correlation as timed out. Called automatically by the timer. */
  timeout(): void;
}

interface BuildPayloadArgs {
  readonly contextStore: ContextStore;
  readonly eventDef: EventDefinition;
  readonly fields: Record<string, unknown>;
  readonly currentCorrelationId: () => string;
  readonly forkId: string;
  readonly strict?: boolean | undefined;
}

/**
 * Build a complete log payload from event definition and runtime data.
 * @internal
 * @param args - Payload construction arguments including context, event, and fields
 * @returns Assembled log payload ready for backend emission
 */
const buildPayload = (args: BuildPayloadArgs): LogPayload => {
  const fieldValidation = validateFields(args.eventDef, args.fields);

  if (args.strict) {
    const issues: string[] = [];
    if (fieldValidation.missingFields.length > 0) {
      issues.push(`missing required fields: ${fieldValidation.missingFields.join(', ')}`);
    }
    if (fieldValidation.typeErrors.length > 0) {
      issues.push(`type errors on fields: ${fieldValidation.typeErrors.join(', ')}`);
    }
    if (fieldValidation.invalidValues.length > 0) {
      issues.push(`invalid values on fields: ${fieldValidation.invalidValues.join(', ')}`);
    }
    if (issues.length > 0) {
      throw new ChroniclerError(
        'FIELD_VALIDATION',
        `Event "${args.eventDef.key}" failed validation: ${issues.join('; ')}`,
      );
    }
  }

  const validationMetadata = buildValidationMetadata(fieldValidation);

  return {
    eventKey: args.eventDef.key,
    fields: fieldValidation.normalizedFields,
    correlationId: args.currentCorrelationId(),
    forkId: args.forkId,
    metadata: args.contextStore.snapshot(),
    timestamp: new Date().toISOString(),
    ...(validationMetadata ? { _validation: validationMetadata } : {}),
  };
};

/** Compute fork nesting depth from a dotted fork ID. */
const forkDepthFromId = (forkId: string): number =>
  forkId === ROOT_FORK_ID ? 0 : forkId.split(FORK_ID_SEPARATOR).length;

/**
 * Derive the next child fork ID and enforce depth limits.
 * @throws {ChroniclerError} `FORK_DEPTH_EXCEEDED` if the new depth exceeds maxDepth
 */
const nextForkId = (parentForkId: string, counter: number, maxDepth: number): string => {
  const childForkId =
    parentForkId === ROOT_FORK_ID
      ? String(counter)
      : `${parentForkId}${FORK_ID_SEPARATOR}${counter}`;
  const depth = forkDepthFromId(childForkId);
  if (depth > maxDepth) {
    throw new ChroniclerError(
      'FORK_DEPTH_EXCEEDED',
      `Fork depth ${depth} exceeds maximum allowed depth of ${maxDepth}`,
    );
  }
  return childForkId;
};

interface ChronicleHooks {
  readonly onActivity?: () => void;
}

type NormalizedCorrelationGroup = Omit<CorrelationEventGroup, 'events' | 'timeout'> & {
  readonly timeout: number;
  readonly events: EventRecord & CorrelationAutoEvents;
};

/** Guard: returns true if the group has already been processed by defineCorrelationGroup. */
const isAlreadyNormalized = (group: CorrelationEventGroup): group is NormalizedCorrelationGroup =>
  typeof group.timeout === 'number' &&
  group.events !== undefined &&
  'start' in group.events &&
  'complete' in group.events &&
  'fail' in group.events &&
  'timeout' in group.events;

/** Normalize a correlation group, skipping if already processed to avoid collision false-positives. */
const resolveCorrelationGroup = (group: CorrelationEventGroup): NormalizedCorrelationGroup =>
  isAlreadyNormalized(group)
    ? group
    : (defineCorrelationGroup(group) as NormalizedCorrelationGroup);

interface ChronicleInstanceArgs {
  readonly config: ResolvedChroniclerConfig;
  readonly contextStore: ContextStore;
  /** Returns the current correlation ID for this chronicle. */
  readonly currentCorrelationId: () => string;
  /** Creates NEW correlation IDs for startCorrelation(). */
  readonly correlationIdGenerator: () => string;
  readonly forkId: string;
  readonly hooks?: ChronicleHooks;
  readonly activeCorrelations?: { count: number };
}

// eslint-disable-next-line max-lines-per-function -- Accepted deviation: object-literal constructor, splitting reduces readability
const createChronicleInstance = (args: ChronicleInstanceArgs): Chronicler => {
  const {
    config,
    contextStore,
    currentCorrelationId,
    correlationIdGenerator,
    forkId,
    hooks = {},
    activeCorrelations = { count: 0 },
  } = args;
  /** Monotonically increasing counter for generating unique child fork IDs. */
  let forkCounter = 0;

  return {
    event(eventDef, fields) {
      if (LOG_LEVELS[eventDef.level] > config.minLevel) return;
      const payload = buildPayload({
        contextStore,
        eventDef,
        // Deliberate type erasure: EventFields<E> → Record<string, unknown>
        fields: fields as Record<string, unknown>,
        currentCorrelationId,
        forkId,
        strict: config.strict,
      });
      callBackendMethod(config.backend, eventDef.level, eventDef.message, payload);
      hooks.onActivity?.();
    },
    log(level, message, fields = {}) {
      if (LOG_LEVELS[level] > config.minLevel) return;
      const payload: LogPayload = {
        eventKey: '',
        fields: sanitizeLogFields(fields),
        correlationId: currentCorrelationId(),
        forkId,
        metadata: contextStore.snapshot(),
        timestamp: new Date().toISOString(),
      };
      callBackendMethod(config.backend, level, message, payload);
      hooks.onActivity?.();
    },
    addContext(context) {
      return contextStore.add(context);
    },
    fork(extraContext = {}) {
      forkCounter++;
      const childForkId = nextForkId(forkId, forkCounter, config.limits.maxForkDepth);
      const forkStore = new ContextStore(contextStore.snapshot(), config.limits.maxContextKeys);
      const forkChronicle = createChronicleInstance({
        config,
        contextStore: forkStore,
        currentCorrelationId,
        correlationIdGenerator,
        forkId: childForkId,
        hooks,
        activeCorrelations,
      });
      if (Object.keys(extraContext).length > 0) {
        forkChronicle.addContext(extraContext);
      }
      return forkChronicle;
    },
    startCorrelation(group, metadata = {}) {
      if (activeCorrelations.count >= config.limits.maxActiveCorrelations) {
        throw new ChroniclerError(
          'CORRELATION_LIMIT_EXCEEDED',
          `Active correlation limit of ${config.limits.maxActiveCorrelations} exceeded`,
        );
      }
      const definedGroup = resolveCorrelationGroup(group);
      activeCorrelations.count++;
      const correlationStore = new ContextStore(
        contextStore.snapshot(),
        config.limits.maxContextKeys,
      );
      if (Object.keys(metadata).length > 0) {
        correlationStore.add(metadata);
      }
      const correlationId = correlationIdGenerator();
      return new CorrelationChronicleImpl({
        config,
        group: definedGroup,
        contextStore: correlationStore,
        currentCorrelationId: () => correlationId,
        correlationIdGenerator,
        forkId,
        activeCorrelations,
      });
    },
  };
};

/**
 * Auto-reset timeout for correlation groups.
 * Resets on any activity; invokes callback if idle for the configured duration.
 */
export class CorrelationTimer {
  private timeoutId: NodeJS.Timeout | undefined;

  constructor(
    private readonly timeout: number,
    private readonly onTimeout: () => void,
  ) {}

  start(): void {
    this.clear();
    if (this.timeout > 0) {
      this.timeoutId = setTimeout(this.onTimeout, this.timeout);
      this.timeoutId.unref();
    }
  }

  /** Reset the timer (keep-alive on activity). */
  touch(): void {
    this.start();
  }

  clear(): void {
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }
}

interface CorrelationChronicleArgs {
  readonly config: ResolvedChroniclerConfig;
  readonly group: NormalizedCorrelationGroup;
  readonly contextStore: ContextStore;
  readonly currentCorrelationId: () => string;
  readonly correlationIdGenerator: () => string;
  readonly forkId: string;
  readonly activeCorrelations?: { count: number };
}

class CorrelationChronicleImpl implements CorrelationChronicle {
  private readonly config: ResolvedChroniclerConfig;
  private readonly group: NormalizedCorrelationGroup;
  private readonly contextStore: ContextStore;
  private readonly currentCorrelationId: () => string;
  private readonly correlationIdGenerator: () => string;
  private readonly forkId: string;
  private readonly activeCorrelations: { count: number };
  private readonly timer: CorrelationTimer;
  private completed = false;
  private readonly startedAt = Date.now();
  private readonly autoEvents: CorrelationAutoEvents;
  private forkCounter = 0;

  constructor(args: CorrelationChronicleArgs) {
    this.config = args.config;
    this.group = args.group;
    this.contextStore = args.contextStore;
    this.currentCorrelationId = args.currentCorrelationId;
    this.correlationIdGenerator = args.correlationIdGenerator;
    this.forkId = args.forkId;
    this.activeCorrelations = args.activeCorrelations ?? { count: 0 };
    this.timer = new CorrelationTimer(this.group.timeout, () => this.timeout());
    this.autoEvents = this.group.events as CorrelationAutoEvents;
    this.timer.start();
    this.emitAutoEvent(this.autoEvents.start, {});
  }

  event<E extends EventDefinition>(eventDef: E, fields: EventFields<E>): void {
    if (this.completed) return;
    if (LOG_LEVELS[eventDef.level] > this.config.minLevel) return;
    const payload = buildPayload({
      contextStore: this.contextStore,
      eventDef,
      // Deliberate type erasure: EventFields<E> → Record<string, unknown>
      fields: fields as Record<string, unknown>,
      currentCorrelationId: this.currentCorrelationId,
      forkId: this.forkId,
      strict: this.config.strict,
    });
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
    this.timer.touch();
  }

  log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    if (this.completed) return;
    if (LOG_LEVELS[level] > this.config.minLevel) return;
    const payload: LogPayload = {
      eventKey: '',
      fields: sanitizeLogFields(fields),
      correlationId: this.currentCorrelationId(),
      forkId: this.forkId,
      metadata: this.contextStore.snapshot(),
      timestamp: new Date().toISOString(),
    };
    callBackendMethod(this.config.backend, level, message, payload);
    this.timer.touch();
  }

  addContext(context: ContextRecord): ContextValidationResult {
    return this.contextStore.add(context);
  }

  fork(extraContext: ContextRecord = {}): Chronicler {
    this.forkCounter++;
    const childForkId = nextForkId(this.forkId, this.forkCounter, this.config.limits.maxForkDepth);
    const forkStore = new ContextStore(
      this.contextStore.snapshot(),
      this.config.limits.maxContextKeys,
    );

    const forkChronicle = createChronicleInstance({
      config: this.config,
      contextStore: forkStore,
      currentCorrelationId: this.currentCorrelationId,
      correlationIdGenerator: this.correlationIdGenerator,
      forkId: childForkId,
      hooks: { onActivity: () => this.timer.touch() },
      activeCorrelations: this.activeCorrelations,
    });

    if (extraContext && Object.keys(extraContext).length > 0) {
      forkChronicle.addContext(extraContext);
    }

    return forkChronicle;
  }

  complete(fields: Record<string, unknown> = {}): void {
    if (!this.finalize()) return;
    this.emitAutoEvent(this.autoEvents.complete, {
      duration: Date.now() - this.startedAt,
      ...fields,
    });
  }

  fail(error?: unknown, fields: Record<string, unknown> = {}): void {
    if (!this.finalize()) return;
    this.emitAutoEvent(this.autoEvents.fail, {
      duration: Date.now() - this.startedAt,
      error,
      ...fields,
    });
  }

  timeout(): void {
    if (!this.finalize()) return;
    this.emitAutoEvent(this.autoEvents.timeout, {});
  }

  /** Mark correlation as done: decrement counter, clear timer. Returns false if already completed. */
  private finalize(): boolean {
    if (this.completed) return false;
    this.activeCorrelations.count--;
    this.completed = true;
    this.timer.clear();
    return true;
  }

  private emitAutoEvent(eventDef: EventDefinition, fields: Record<string, unknown>): void {
    if (LOG_LEVELS[eventDef.level] > this.config.minLevel) return;
    const payload = buildPayload({
      contextStore: this.contextStore,
      eventDef,
      fields,
      currentCorrelationId: this.currentCorrelationId,
      forkId: this.forkId,
      strict: this.config.strict,
    });
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
  }
}

/** Validate and resolve user-provided config into fully-resolved internal config. */
const resolveChroniclerConfig = (
  config: ChroniclerConfig,
  // eslint-disable-next-line complexity -- config resolution requires checking all option paths
): { resolved: ResolvedChroniclerConfig; correlationIdGenerator: () => string } => {
  const resolvedBackend = config.backend ?? createConsoleBackend();

  const missingLevels = DEFAULT_REQUIRED_LEVELS.filter(
    (level) => typeof resolvedBackend[level] !== 'function',
  );
  if (missingLevels.length > 0) {
    throw new ChroniclerError(
      'UNSUPPORTED_LOG_LEVEL',
      `Log backend is missing level(s): ${missingLevels.join(', ')}. A valid backend must implement all 9 levels: ${DEFAULT_REQUIRED_LEVELS.join(', ')}. Use createBackend() for automatic fallback handling.`,
    );
  }

  const reservedMetadata = assertNoReservedKeys(config.metadata);
  if (reservedMetadata.length > 0) {
    throw new ChroniclerError(
      'RESERVED_FIELD',
      `Reserved fields cannot be used in metadata: ${reservedMetadata.join(', ')}`,
    );
  }

  const resolvedLimits: ResolvedLimits = {
    maxContextKeys: config.limits?.maxContextKeys ?? DEFAULT_MAX_CONTEXT_KEYS,
    maxForkDepth: config.limits?.maxForkDepth ?? DEFAULT_MAX_FORK_DEPTH,
    maxActiveCorrelations: config.limits?.maxActiveCorrelations ?? DEFAULT_MAX_ACTIVE_CORRELATIONS,
  };

  return {
    // Spread includes unresolved config first; explicit properties below override them.
    resolved: {
      ...config,
      backend: resolvedBackend,
      limits: resolvedLimits,
      minLevel: LOG_LEVELS[config.minLevel ?? 'trace'],
    },
    correlationIdGenerator: config.correlationIdGenerator ?? (() => crypto.randomUUID()),
  };
};

/**
 * Create a root Chronicler instance.
 *
 * This is the main entry point for the library. The returned `Chronicler`
 * can log events, add context, start correlations, and create forks.
 *
 * @param config - Chronicler configuration with optional backend, metadata, and optional correlation settings
 * @returns A configured `Chronicler` instance
 * @throws {ChroniclerError} `UNSUPPORTED_LOG_LEVEL` if the backend is missing required methods
 * @throws {ChroniclerError} `RESERVED_FIELD` if `config.metadata` contains reserved field names
 */
export const createChronicle = (config: ChroniclerConfig): Chronicler => {
  const { resolved, correlationIdGenerator } = resolveChroniclerConfig(config);
  const baseContextStore = new ContextStore(config.metadata, resolved.limits.maxContextKeys);

  return createChronicleInstance({
    config: resolved,
    contextStore: baseContextStore,
    currentCorrelationId: () => '',
    correlationIdGenerator,
    forkId: ROOT_FORK_ID,
    /** Shared mutable counter tracking uncompleted correlations for limit enforcement. */
    activeCorrelations: { count: 0 },
  });
};
