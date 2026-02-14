import {
  callBackendMethod,
  createConsoleBackend,
  type LogBackend,
  type LogLevel,
  type LogPayload,
  validateBackendMethods,
  type ValidationMetadata,
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
import { type ContextRecord, ContextStore, type ContextValidationResult } from './context-store';
import { CorrelationTimer } from './correlation-timer';
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
import { buildValidationMetadata, validateFields } from './validation';

export interface ChroniclerLimits {
  maxContextKeys?: number;
  maxForkDepth?: number;
  maxActiveCorrelations?: number;
}

export interface ChroniclerConfig {
  backend?: LogBackend;
  metadata: Record<string, string | number | boolean | null>;
  correlationIdGenerator?: () => string;
  limits?: ChroniclerLimits;
  /**
   * Strip ANSI escape sequences and replace newlines in string field values.
   * Prevents log injection attacks. Defaults to `false`.
   */
  sanitizeStrings?: boolean;
  /**
   * When `true`, emits `console.warn` for field validation errors
   * (missing required fields, type mismatches). Defaults to `false`.
   */
  strict?: boolean;
  /**
   * Minimum log level to emit. Events below this level are silently dropped.
   * Uses priority ordering: fatal(0) > critical(1) > ... > trace(8).
   * Defaults to `'trace'` (all events emitted).
   */
  minLevel?: LogLevel;
}

interface ResolvedLimits {
  maxContextKeys: number;
  maxForkDepth: number;
  maxActiveCorrelations: number;
}

type ResolvedChroniclerConfig = Omit<ChroniclerConfig, 'backend' | 'limits' | 'minLevel'> & {
  backend: LogBackend;
  limits: ResolvedLimits;
  minLevel: number;
};

interface ActiveCorrelationCounter {
  count: number;
}

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
  complete(fields?: ContextRecord): void;

  /** Mark the correlation as failed. Emits the `.fail` event at error level. */
  fail(error?: unknown, fields?: ContextRecord): void;

  /** Mark the correlation as timed out. Called automatically by the timer. */
  timeout(): void;
}

/**
 * Build a complete log payload from event definition and runtime data
 *
 * This function orchestrates multiple validation and sampling operations:
 * 1. Field validation - checks required fields and types
 * 2. Validation metadata - aggregates validation errors
 * 3. Payload assembly - combines all data into final structure
 *
 * @param contextStore - Context storage for metadata snapshot
 * @param eventDef - Event definition with field requirements
 * @param fields - Actual field values being logged
 * @param currentCorrelationId - Function to get current correlation ID
 * @param forkId - Hierarchical fork identifier (e.g., '0', '1', '1.1')
 * @param validationOverrides - Additional validation metadata (e.g., from correlations)
 * @returns Complete log payload ready for backend
 *
 * @internal This is an internal implementation detail
 */
const buildPayload = (
  contextStore: ContextStore,
  eventDef: EventDefinition,
  fields: Record<string, unknown>,
  currentCorrelationId: () => string,
  forkId: string,
  validationOverrides?: Partial<ValidationMetadata>,
  sanitizeStrings?: boolean,
  strict?: boolean,
): LogPayload => {
  const fieldValidation = validateFields(
    eventDef,
    fields,
    sanitizeStrings ? { sanitizeStrings } : {},
  );

  if (strict) {
    if (fieldValidation.missingFields.length > 0) {
      console.warn(
        `[chronicler] Event "${eventDef.key}" missing required fields: ${fieldValidation.missingFields.join(', ')}`,
      );
    }
    if (fieldValidation.typeErrors.length > 0) {
      console.warn(
        `[chronicler] Event "${eventDef.key}" has type errors on fields: ${fieldValidation.typeErrors.join(', ')}`,
      );
    }
  }

  const validationMetadata = buildValidationMetadata(fieldValidation, validationOverrides);
  const payload: LogPayload = {
    eventKey: eventDef.key,
    fields: fieldValidation.normalizedFields,
    correlationId: currentCorrelationId(),
    forkId,
    metadata: contextStore.snapshot(),
    timestamp: new Date().toISOString(),
  };

  if (validationMetadata) {
    payload._validation = validationMetadata;
  }

  return payload;
};

const forkDepthFromId = (forkId: string): number =>
  forkId === ROOT_FORK_ID ? 0 : forkId.split(FORK_ID_SEPARATOR).length;

interface ChronicleHooks {
  onActivity?: () => void;
  onContextValidation?: (validation: ContextValidationResult) => void;
}

type NormalizedCorrelationGroup = Omit<CorrelationEventGroup, 'events' | 'timeout'> & {
  timeout: number;
  events: EventRecord & CorrelationAutoEvents;
};

const correlationGroupCache = new WeakMap<CorrelationEventGroup, NormalizedCorrelationGroup>();

const resolveCorrelationGroup = (group: CorrelationEventGroup): NormalizedCorrelationGroup => {
  let resolved = correlationGroupCache.get(group);
  if (!resolved) {
    resolved = defineCorrelationGroup(group) as NormalizedCorrelationGroup;
    correlationGroupCache.set(group, resolved);
  }
  return resolved;
};

/**
 * Create a Chronicle instance
 *
 * @param config
 * @param contextStore
 * @param currentCorrelationId - Function that returns the current correlation ID for this chronicle.
 *   For root chronicles: generates a NEW ID each time (no correlation, events are independent).
 *   For correlation chronicles: returns the SAME ID (all events share the correlation ID).
 * @param correlationIdGenerator - Function that creates NEW correlation IDs.
 *   Used when startCorrelation() is called on root chronicles.
 *   Also used by forks to create child correlations.
 * @param forkId
 * @param hooks
 */
const createChronicleInstance = (
  config: ResolvedChroniclerConfig,
  contextStore: ContextStore,
  currentCorrelationId: () => string,
  correlationIdGenerator: () => string,
  forkId: string,
  hooks: ChronicleHooks = {},
  activeCorrelations: ActiveCorrelationCounter = { count: 0 },
): Chronicler => {
  let forkCounter = 0;

  return {
    event(eventDef, fields) {
      if (LOG_LEVELS[eventDef.level] > config.minLevel) return;
      const payload = buildPayload(
        contextStore,
        eventDef,
        // Deliberate type erasure: EventFields<E> is erased to Record<string, unknown>
        // at this validation boundary so buildPayload can validate fields generically
        fields as Record<string, unknown>,
        currentCorrelationId,
        forkId,
        undefined,
        config.sanitizeStrings,
        config.strict,
      );
      callBackendMethod(config.backend, eventDef.level, eventDef.message, payload);
      hooks.onActivity?.();
    },
    log(level, message, fields = {}) {
      if (LOG_LEVELS[level] > config.minLevel) return;
      const payload: LogPayload = {
        eventKey: '',
        fields,
        correlationId: currentCorrelationId(),
        forkId,
        metadata: contextStore.snapshot(),
        timestamp: new Date().toISOString(),
      };
      callBackendMethod(config.backend, level, message, payload);
      hooks.onActivity?.();
    },
    addContext(context) {
      const validation = contextStore.add(context);
      hooks.onContextValidation?.(validation);
      return validation;
    },
    fork(extraContext = {}) {
      forkCounter++;
      const childForkId =
        forkId === ROOT_FORK_ID
          ? String(forkCounter)
          : `${forkId}${FORK_ID_SEPARATOR}${forkCounter}`;
      const depth = forkDepthFromId(childForkId);
      if (depth > config.limits.maxForkDepth) {
        throw new ChroniclerError(
          'FORK_DEPTH_EXCEEDED',
          `Fork depth ${depth} exceeds maximum allowed depth of ${config.limits.maxForkDepth}`,
        );
      }
      const forkStore = new ContextStore(contextStore.snapshot(), config.limits.maxContextKeys);
      const forkChronicle = createChronicleInstance(
        config,
        forkStore,
        currentCorrelationId,
        correlationIdGenerator,
        childForkId,
        hooks,
        activeCorrelations,
      );
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
      activeCorrelations.count++;
      const definedGroup = resolveCorrelationGroup(group);
      const correlationStore = new ContextStore(
        { ...contextStore.snapshot(), ...metadata },
        config.limits.maxContextKeys,
      );
      const correlationId = correlationIdGenerator();
      return new CorrelationChronicleImpl(
        config,
        definedGroup,
        correlationStore,
        () => correlationId,
        correlationIdGenerator,
        forkId,
        activeCorrelations,
      );
    },
  };
};

class CorrelationChronicleImpl implements CorrelationChronicle {
  private readonly timer: CorrelationTimer;
  private completed = false;
  private readonly startedAt = Date.now();
  private readonly autoEvents: CorrelationAutoEvents;
  private forkCounter = 0;

  constructor(
    private readonly config: ResolvedChroniclerConfig,
    private readonly group: NormalizedCorrelationGroup,
    private readonly contextStore: ContextStore,
    private readonly currentCorrelationId: () => string,
    private readonly correlationIdGenerator: () => string,
    private readonly forkId: string,
    private readonly activeCorrelations: ActiveCorrelationCounter = { count: 0 },
  ) {
    this.timer = new CorrelationTimer(this.group.timeout, () => this.timeout());
    this.autoEvents = this.group.events as CorrelationAutoEvents;
    this.timer.start();
    this.emitAutoEvent(this.autoEvents.start, {});
  }

  event<E extends EventDefinition>(eventDef: E, fields: EventFields<E>): void {
    if (LOG_LEVELS[eventDef.level] > this.config.minLevel) return;
    const payload = buildPayload(
      this.contextStore,
      eventDef,
      // Deliberate type erasure: EventFields<E> is erased to Record<string, unknown>
      // at this validation boundary so buildPayload can validate fields generically
      fields as Record<string, unknown>,
      this.currentCorrelationId,
      this.forkId,
      undefined,
      this.config.sanitizeStrings,
      this.config.strict,
    );
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
    this.timer.touch();
  }

  log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    if (LOG_LEVELS[level] > this.config.minLevel) return;
    const payload: LogPayload = {
      eventKey: '',
      fields,
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
    const childForkId =
      this.forkId === ROOT_FORK_ID
        ? String(this.forkCounter)
        : `${this.forkId}${FORK_ID_SEPARATOR}${this.forkCounter}`;
    const depth = forkDepthFromId(childForkId);
    if (depth > this.config.limits.maxForkDepth) {
      throw new ChroniclerError(
        'FORK_DEPTH_EXCEEDED',
        `Fork depth ${depth} exceeds maximum allowed depth of ${this.config.limits.maxForkDepth}`,
      );
    }
    const forkStore = new ContextStore(
      this.contextStore.snapshot(),
      this.config.limits.maxContextKeys,
    );

    const forkChronicle = createChronicleInstance(
      this.config,
      forkStore,
      this.currentCorrelationId,
      this.correlationIdGenerator,
      childForkId,
      {
        onActivity: () => this.timer.touch(),
      },
      this.activeCorrelations,
    );

    if (extraContext && Object.keys(extraContext).length > 0) {
      forkChronicle.addContext(extraContext);
    }

    return forkChronicle;
  }

  complete(fields: ContextRecord = {}): void {
    if (this.completed) {
      return;
    }
    this.activeCorrelations.count--;
    this.completed = true;
    this.timer.clear();
    this.emitAutoEvent(
      this.autoEvents.complete,
      { duration: Date.now() - this.startedAt, ...fields },
      undefined,
      false,
    );
  }

  fail(error?: unknown, fields: ContextRecord = {}): void {
    if (!this.completed) {
      this.activeCorrelations.count--;
    }
    this.completed = true;
    this.timer.clear();
    this.emitAutoEvent(
      this.autoEvents.fail,
      { duration: Date.now() - this.startedAt, error, ...fields },
      undefined,
      false,
    );
  }

  timeout(): void {
    if (this.completed) {
      return;
    }
    this.activeCorrelations.count--;
    this.completed = true;
    this.timer.clear();
    this.emitAutoEvent(this.autoEvents.timeout, {}, undefined, false);
  }

  private emitAutoEvent(
    eventDef: EventDefinition,
    fields: Record<string, unknown>,
    overrides?: Partial<ValidationMetadata>,
    touchTimer = true,
  ): void {
    const payload = buildPayload(
      this.contextStore,
      eventDef,
      fields,
      this.currentCorrelationId,
      this.forkId,
      overrides,
      this.config.sanitizeStrings,
      this.config.strict,
    );
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
    if (touchTimer) {
      this.timer.touch();
    }
  }
}

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
  const resolvedBackend = config.backend ?? createConsoleBackend();

  const missing = validateBackendMethods(resolvedBackend, DEFAULT_REQUIRED_LEVELS);
  if (missing.length > 0) {
    throw new ChroniclerError(
      'UNSUPPORTED_LOG_LEVEL',
      `Log backend is missing level(s): ${missing.join(', ')}. A valid backend must implement all 9 levels: ${DEFAULT_REQUIRED_LEVELS.join(', ')}. Use createBackend() for automatic fallback handling.`,
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

  const baseContextStore = new ContextStore(config.metadata, resolvedLimits.maxContextKeys);
  const correlationIdGenerator = config.correlationIdGenerator ?? (() => crypto.randomUUID());

  const resolvedConfig: ResolvedChroniclerConfig = {
    ...config,
    backend: resolvedBackend,
    limits: resolvedLimits,
    minLevel: LOG_LEVELS[config.minLevel ?? 'trace'],
  };

  const activeCorrelations: ActiveCorrelationCounter = { count: 0 };

  return createChronicleInstance(
    resolvedConfig,
    baseContextStore,
    () => correlationIdGenerator(),
    correlationIdGenerator,
    ROOT_FORK_ID,
    {},
    activeCorrelations,
  );
};
