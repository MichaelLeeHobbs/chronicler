import {
  callBackendMethod,
  createConsoleBackend,
  type LogBackend,
  type LogPayload,
  validateBackendMethods,
  type ValidationMetadata,
} from './backend';
import {
  DEFAULT_HOSTNAME,
  DEFAULT_MAX_ACTIVE_CORRELATIONS,
  DEFAULT_MAX_CONTEXT_KEYS,
  DEFAULT_MAX_FORK_DEPTH,
  DEFAULT_REQUIRED_LEVELS,
  FORK_ID_SEPARATOR,
  ROOT_FORK_ID,
} from './constants';
import {
  type ContextCollisionDetail,
  type ContextRecord,
  ContextStore,
  type ContextValidationResult,
} from './ContextStore';
import { CorrelationTimer } from './CorrelationTimer';
import {
  CorrelationLimitExceededError,
  ForkDepthExceededError,
  ReservedFieldError,
  UnsupportedLogLevelError,
} from './errors';
import {
  type CorrelationAutoEvents,
  type CorrelationEventGroup,
  defineCorrelationGroup,
  type EventDefinition,
  type EventFields,
  type EventRecord,
} from './events';
import { assertNoReservedKeys } from './reserved';
import { chroniclerSystemEvents } from './system-events';
import { stringifyValue } from './utils';
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
}

interface ResolvedLimits {
  maxContextKeys: number;
  maxForkDepth: number;
  maxActiveCorrelations: number;
}

type ResolvedChroniclerConfig = Omit<ChroniclerConfig, 'backend' | 'limits'> & {
  backend: LogBackend;
  limits: ResolvedLimits;
};

interface ActiveCorrelationCounter {
  count: number;
}

export interface Chronicler {
  event<E extends EventDefinition>(event: E, fields: EventFields<E>): void;

  addContext(context: ContextRecord): void;

  startCorrelation(group: CorrelationEventGroup, metadata?: ContextRecord): CorrelationChronicle;

  fork(context?: ContextRecord): Chronicler;
}

/**
 * A correlation represents a logical unit of work with a defined lifecycle.
 *
 * Unlike a root Chronicler, a correlation:
 * - Has a single shared correlation ID for all events
 * - Has lifecycle events (start, complete, timeout, metadataWarning)
 * - Can timeout if not completed within the configured duration
 * - Cannot start nested correlations (use fork() for parallel work within a correlation)
 */
export interface CorrelationChronicle {
  event<E extends EventDefinition>(event: E, fields: EventFields<E>): void;

  addContext(context: ContextRecord): void;

  fork(context?: ContextRecord): Chronicler;

  complete(fields?: ContextRecord): void;

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
): LogPayload => {
  const fieldValidation = validateFields(eventDef, fields);
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

const emitContextValidationEvents = (
  validation: ContextValidationResult,
  emitEvent: (eventDef: EventDefinition, fields: Record<string, unknown>) => void,
): void => {
  if (validation.collisionDetails.length > 0) {
    const keys = validation.collisionDetails.map((d) => d.key).join(', ');
    emitEvent(chroniclerSystemEvents.events.contextCollision, {
      keys,
      count: validation.collisionDetails.length,
    });
  }

  if (validation.reserved.length > 0) {
    const keys = validation.reserved.join(', ');
    emitEvent(chroniclerSystemEvents.events.reservedFieldAttempt, {
      keys,
      count: validation.reserved.length,
    });
  }

  if (validation.dropped.length > 0) {
    const keys = validation.dropped.join(', ');
    emitEvent(chroniclerSystemEvents.events.contextLimitReached, {
      keys,
      count: validation.dropped.length,
    });
  }
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
      const payload = buildPayload(
        contextStore,
        eventDef,
        // Deliberate type erasure: EventFields<E> is erased to Record<string, unknown>
        // at this validation boundary so buildPayload can validate fields generically
        fields as Record<string, unknown>,
        currentCorrelationId,
        forkId,
      );
      callBackendMethod(config.backend, eventDef.level, eventDef.message, payload);
      hooks.onActivity?.();
    },
    addContext(context) {
      const validation = contextStore.add(context);
      emitContextValidationEvents(validation, (eventDef, fields) => this.event(eventDef, fields));
      hooks.onContextValidation?.(validation);
    },
    fork(extraContext = {}) {
      forkCounter++;
      const childForkId =
        forkId === ROOT_FORK_ID
          ? String(forkCounter)
          : `${forkId}${FORK_ID_SEPARATOR}${forkCounter}`;
      const depth = forkDepthFromId(childForkId);
      if (depth > config.limits.maxForkDepth) {
        throw new ForkDepthExceededError(depth, config.limits.maxForkDepth);
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
        throw new CorrelationLimitExceededError(config.limits.maxActiveCorrelations);
      }
      activeCorrelations.count++;
      const definedGroup = defineCorrelationGroup(group) as NormalizedCorrelationGroup;
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
  private completionCount = 0;
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
    const payload = buildPayload(
      this.contextStore,
      eventDef,
      // Deliberate type erasure: EventFields<E> is erased to Record<string, unknown>
      // at this validation boundary so buildPayload can validate fields generically
      fields as Record<string, unknown>,
      this.currentCorrelationId,
      this.forkId,
    );
    callBackendMethod(this.config.backend, eventDef.level, eventDef.message, payload);
    this.timer.touch();
  }

  addContext(context: ContextRecord): void {
    const validation = this.contextStore.add(context);
    emitContextValidationEvents(validation, (eventDef, fields) => this.event(eventDef, fields));

    if (validation.collisionDetails.length > 0) {
      this.emitMetadataWarnings(validation.collisionDetails);
    }
  }

  fork(extraContext: ContextRecord = {}): Chronicler {
    this.forkCounter++;
    const childForkId =
      this.forkId === ROOT_FORK_ID
        ? String(this.forkCounter)
        : `${this.forkId}${FORK_ID_SEPARATOR}${this.forkCounter}`;
    const depth = forkDepthFromId(childForkId);
    if (depth > this.config.limits.maxForkDepth) {
      throw new ForkDepthExceededError(depth, this.config.limits.maxForkDepth);
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
    if (!this.completed) {
      this.activeCorrelations.count--;
    }
    this.completionCount += 1;
    this.completed = true;
    this.timer.clear();

    const overrides: Partial<ValidationMetadata> | undefined =
      this.completionCount > 1 ? { multipleCompletes: true } : undefined;
    this.emitAutoEvent(
      this.autoEvents.complete,
      { duration: Date.now() - this.startedAt, ...fields },
      overrides,
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

  private emitMetadataWarnings(details: ContextCollisionDetail[]): void {
    if (details.length === 0) {
      return;
    }
    details.forEach((detail) =>
      this.emitAutoEvent(this.autoEvents.metadataWarning, {
        attemptedKey: detail.key,
        existingValue: stringifyValue(detail.existingValue),
        attemptedValue: stringifyValue(detail.attemptedValue),
      }),
    );
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
 * @throws {UnsupportedLogLevelError} If the backend is missing required log-level methods
 * @throws {ReservedFieldError} If `config.metadata` contains reserved field names
 */
export const createChronicle = (config: ChroniclerConfig): Chronicler => {
  const resolvedBackend = config.backend ?? createConsoleBackend();

  const missing = validateBackendMethods(resolvedBackend, DEFAULT_REQUIRED_LEVELS);
  if (missing.length > 0) {
    throw new UnsupportedLogLevelError(missing.join(', '));
  }

  const reservedMetadata = assertNoReservedKeys(config.metadata);
  if (reservedMetadata.length > 0) {
    throw new ReservedFieldError(reservedMetadata);
  }

  const resolvedLimits: ResolvedLimits = {
    maxContextKeys: config.limits?.maxContextKeys ?? DEFAULT_MAX_CONTEXT_KEYS,
    maxForkDepth: config.limits?.maxForkDepth ?? DEFAULT_MAX_FORK_DEPTH,
    maxActiveCorrelations: config.limits?.maxActiveCorrelations ?? DEFAULT_MAX_ACTIVE_CORRELATIONS,
  };

  const baseContextStore = new ContextStore(config.metadata, resolvedLimits.maxContextKeys);
  const correlationIdGenerator =
    config.correlationIdGenerator ??
    (() => `${config.metadata.hostname ?? DEFAULT_HOSTNAME}_${Date.now()}`);

  const resolvedConfig: ResolvedChroniclerConfig = {
    ...config,
    backend: resolvedBackend,
    limits: resolvedLimits,
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
