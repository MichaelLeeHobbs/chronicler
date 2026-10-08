import { DEFAULT_CORRELATION_TIMEOUT_MS, LOG_LEVELS, type LogLevel } from './constants';
import { ChroniclerError } from './errors';
import { field, type FieldBuilder } from './fields';

/** A record of field builders, as passed to `event({ fields })`. */
export type FieldDefs = Record<string, FieldBuilder<string, boolean>>;

/** Field definitions of an event that declares no fields. */
export type NoFields = Record<never, never>;

/** Discriminant stored on every event definition. A string, so it survives two copies of the package. */
export const EVENT_KIND = 'chronicler:event';
/** Discriminant stored on every correlation definition. */
export const CORRELATION_KIND = 'chronicler:correlation';

/** Non-enumerable marker on objects returned by `defineEvents()`. */
const CATALOG_MARK = Symbol.for('chronicler.catalog');
/** Non-enumerable marker set on a catalog once another `defineEvents()` call has mounted it. */
const MOUNTED_MARK = Symbol.for('chronicler.mounted');
/** Non-enumerable doc string attached to a namespace by `group()`. */
const NAMESPACE_DOC = Symbol.for('chronicler.namespaceDoc');

/**
 * A single loggable event.
 *
 * Created with {@link event}. Its `key` is empty until the event is placed in a catalog with
 * {@link defineEvents}, which sets it from the event's path (`admin.login`).
 */
export interface EventDefinition<F extends FieldDefs = FieldDefs> {
  readonly kind: typeof EVENT_KIND;
  /** Full dotted key, derived from the catalog path (or `keyOverride`). */
  readonly key: string;
  /** Explicit wire key that replaces the path-derived key, e.g. to keep a key stable across a rename. */
  readonly keyOverride?: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly doc?: string;
  readonly fields: F;
}

/**
 * A unit of work with a lifecycle (`.start`, `.complete`, `.fail`, `.timeout`).
 *
 * Created with {@link correlation}. `events` holds the events that belong to it.
 */
export interface CorrelationDefinition<
  E extends object = object,
  CF extends FieldDefs = NoFields,
  FF extends FieldDefs = NoFields,
> {
  readonly kind: typeof CORRELATION_KIND;
  readonly key: string;
  readonly keyOverride?: string;
  readonly doc?: string;
  /** Idle timeout in milliseconds. `0` disables it. */
  readonly timeout: number;
  readonly events: E;
  /** Extra fields `complete()` accepts, logged on `<key>.complete` next to `duration`. */
  readonly completeFields: CF;
  /** Extra fields `fail()` accepts, logged on `<key>.fail` next to `duration` and `error`. */
  readonly failFields: FF;
}

/** Any event definition, whatever its fields. */
export type AnyEventDefinition = EventDefinition<FieldDefs>;
/** Any correlation definition, whatever its events. */
export type AnyCorrelationDefinition = CorrelationDefinition<object, FieldDefs, FieldDefs>;

/**
 * Names that can't be used for catalog entries, because the emitter tree, correlation handles
 * or auto-generated lifecycle events already use them. `then` is reserved so a chronicle is never
 * mistaken for a promise.
 */
export const RESERVED_CATALOG_NAMES = [
  'fork',
  'run',
  'log',
  'addContext',
  'begin',
  'start',
  'complete',
  'fail',
  'timeout',
  'correlationId',
  'then',
] as const;

/** A name from {@link RESERVED_CATALOG_NAMES}. */
export type ReservedCatalogName = (typeof RESERVED_CATALOG_NAMES)[number];

const RESERVED_NAME_SET = new Set<string>(RESERVED_CATALOG_NAMES);

type AnyFunction = (...args: never[]) => unknown;

/**
 * Compile-time check of a catalog. Each bad entry becomes `never`, so the error points at that
 * entry instead of turning the whole catalog into `never`.
 */
export type CheckCatalog<C> = {
  readonly [K in keyof C]: K extends ReservedCatalogName
    ? never
    : C[K] extends AnyEventDefinition | AnyCorrelationDefinition
      ? C[K]
      : C[K] extends AnyFunction
        ? never
        : C[K] extends object
          ? CheckCatalog<C[K]>
          : never;
};

/** Like {@link CheckCatalog}, for a correlation's events: correlations can't contain correlations. */
export type CheckCorrelationEvents<E> = {
  readonly [K in keyof E]: K extends ReservedCatalogName
    ? never
    : E[K] extends AnyEventDefinition
      ? E[K]
      : E[K] extends AnyCorrelationDefinition | AnyFunction
        ? never
        : E[K] extends object
          ? CheckCorrelationEvents<E[K]>
          : never;
};

interface EventOptions {
  readonly level: LogLevel;
  readonly message: string;
  readonly doc?: string;
  /** Explicit wire key, replacing the one derived from the catalog path. */
  readonly key?: string;
}

/**
 * Define an event. Place it in a catalog with {@link defineEvents}; its key comes from where it sits.
 *
 * @example
 * ```typescript
 * const events = defineEvents({
 *   admin: {
 *     login: event({
 *       level: 'audit',
 *       message: 'User login attempt',
 *       doc: 'Emitted for authentication attempts',
 *       fields: { userId: field.string(), success: field.boolean(), ip: field.string().optional() },
 *     }),
 *   },
 * });
 * ```
 */
export function event<const F extends FieldDefs>(
  options: EventOptions & { readonly fields: F },
): EventDefinition<F>;
export function event(
  options: EventOptions & { readonly fields?: never },
): EventDefinition<NoFields>;
export function event(
  options: EventOptions & { readonly fields?: FieldDefs | undefined },
): EventDefinition<FieldDefs> | EventDefinition<NoFields> {
  return {
    kind: EVENT_KIND,
    key: '',
    ...(options.key !== undefined ? { keyOverride: options.key } : {}),
    level: options.level,
    message: options.message,
    ...(options.doc !== undefined ? { doc: options.doc } : {}),
    fields: options.fields ?? {},
  };
}

/**
 * Define a correlation: a unit of work with a lifecycle and its own events.
 *
 * Lifecycle events `<key>.start`, `.complete`, `.fail` and `.timeout` are generated automatically.
 * The timeout defaults to 5 minutes, resets on any activity, and `0` disables it.
 */
export function correlation<
  const E extends object,
  const CF extends FieldDefs = NoFields,
  const FF extends FieldDefs = NoFields,
>(options: {
  readonly doc?: string;
  readonly timeout?: number;
  readonly key?: string;
  readonly events: E & CheckCorrelationEvents<E>;
  /** Extra fields for `complete()`, e.g. `{ statusCode: field.number() }`. Can't redefine `duration`. */
  readonly complete?: CF & Partial<Record<'duration', never>>;
  /** Extra fields for `fail()`. Can't redefine `duration` or `error`. */
  readonly fail?: FF & Partial<Record<'duration' | 'error', never>>;
}): CorrelationDefinition<E, CF, FF> {
  return {
    kind: CORRELATION_KIND,
    key: '',
    ...(options.key !== undefined ? { keyOverride: options.key } : {}),
    ...(options.doc !== undefined ? { doc: options.doc } : {}),
    timeout: options.timeout ?? DEFAULT_CORRELATION_TIMEOUT_MS,
    events: options.events,
    completeFields: options.complete ?? ({} as CF),
    failFields: options.fail ?? ({} as FF),
  };
}

/** Attach a doc string to a namespace. The doc appears in generated docs. */
export const group = <const C extends object>(
  options: { readonly doc: string },
  children: C,
): C => {
  Object.defineProperty(children, NAMESPACE_DOC, { value: options.doc, enumerable: false });
  return children;
};

/** Type guard for event definitions. Works across separate copies of the package. */
export const isEventDefinition = (value: unknown): value is AnyEventDefinition =>
  typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === EVENT_KIND;

/** Type guard for correlation definitions. Works across separate copies of the package. */
export const isCorrelationDefinition = (value: unknown): value is AnyCorrelationDefinition =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === CORRELATION_KIND;

/** True for objects returned by {@link defineEvents}. */
export const isCatalog = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && Object.hasOwn(value, CATALOG_MARK);

/** True for a catalog that has been mounted inside another catalog. */
export const isMountedCatalog = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && Object.hasOwn(value, MOUNTED_MARK);

/** The doc string attached to a namespace with {@link group}, if any. */
export const namespaceDoc = (value: object): string | undefined =>
  (value as Record<symbol, string | undefined>)[NAMESPACE_DOC];

/** Field definitions for the auto-generated correlation lifecycle events. */
const LIFECYCLE_FIELDS = {
  start: {},
  complete: {
    duration: field.number().optional().doc('Duration of the correlation in milliseconds'),
  },
  fail: {
    duration: field.number().optional().doc('Duration of the correlation in milliseconds'),
    error: field.error().optional().doc('Error that caused the failure'),
  },
  timeout: {},
} as const;

/** The four auto-generated lifecycle events of a correlation. */
export interface LifecycleEvents {
  readonly start: AnyEventDefinition;
  readonly complete: AnyEventDefinition;
  readonly fail: AnyEventDefinition;
  readonly timeout: AnyEventDefinition;
}

/** Extra fields a correlation declares for its `.complete` and `.fail` events. */
export interface LifecycleExtras {
  readonly completeFields?: FieldDefs;
  readonly failFields?: FieldDefs;
}

/**
 * Build the lifecycle events for a correlation key.
 *
 * @param correlationKey - Full key of the correlation (e.g. `http.request`)
 * @param extras - Extra fields declared with `correlation({ complete, fail })`
 * @returns Event definitions for `.start`, `.complete`, `.fail` and `.timeout`
 */
export const lifecycleEvents = (
  correlationKey: string,
  extras: LifecycleExtras = {},
): LifecycleEvents => ({
  start: {
    kind: EVENT_KIND,
    key: `${correlationKey}.start`,
    level: 'info',
    message: `${correlationKey} started`,
    doc: 'Auto-generated correlation start event',
    fields: LIFECYCLE_FIELDS.start,
  },
  complete: {
    kind: EVENT_KIND,
    key: `${correlationKey}.complete`,
    level: 'info',
    message: `${correlationKey} completed`,
    doc: 'Auto-generated correlation completion event',
    fields: { ...extras.completeFields, ...LIFECYCLE_FIELDS.complete },
  },
  fail: {
    kind: EVENT_KIND,
    key: `${correlationKey}.fail`,
    level: 'error',
    message: `${correlationKey} failed`,
    doc: 'Auto-generated correlation failure event',
    fields: { ...extras.failFields, ...LIFECYCLE_FIELDS.fail },
  },
  timeout: {
    kind: EVENT_KIND,
    key: `${correlationKey}.timeout`,
    level: 'warn',
    message: `${correlationKey} timed out`,
    doc: 'Auto-generated correlation timeout event',
    fields: LIFECYCLE_FIELDS.timeout,
  },
});

/** Maximum allowed length for event keys. */
const MAX_EVENT_KEY_LENGTH = 256;
const NAME_RE = /^[a-z][a-zA-Z0-9]*$/;
const KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

const catalogError = (message: string): ChroniclerError =>
  new ChroniclerError('INVALID_CATALOG', message);

const describePath = (path: string): string => (path === '' ? 'the catalog root' : `"${path}"`);

const checkName = (name: string, parentPath: string): void => {
  const where = parentPath === '' ? name : `${parentPath}.${name}`;
  if (RESERVED_NAME_SET.has(name)) {
    throw catalogError(
      `Catalog entry "${where}" uses the reserved name "${name}". Reserved names: ${RESERVED_CATALOG_NAMES.join(', ')}.`,
    );
  }
  if (!NAME_RE.test(name)) {
    throw catalogError(
      `Catalog entry "${where}" has an invalid name. Names must be camelCase identifiers starting with a lowercase letter.`,
    );
  }
};

const checkKey = (key: string): void => {
  if (key.length > MAX_EVENT_KEY_LENGTH) {
    throw catalogError(
      `Event key "${key.slice(0, 50)}..." exceeds the maximum length of ${MAX_EVENT_KEY_LENGTH} characters.`,
    );
  }
  if (!KEY_RE.test(key)) {
    throw catalogError(
      `Invalid event key "${key}". Keys must be dotted camelCase identifiers (e.g. "user.created").`,
    );
  }
};

/** One entry yielded by {@link walkCatalog}. */
export type CatalogEntry =
  | {
      readonly kind: 'event';
      readonly key: string;
      readonly path: string;
      readonly definition: AnyEventDefinition;
      /** Key of the correlation this event belongs to, if any. */
      readonly correlationKey?: string;
      /** True for auto-generated lifecycle events. */
      readonly lifecycle: boolean;
    }
  | {
      readonly kind: 'correlation';
      readonly key: string;
      readonly path: string;
      readonly definition: AnyCorrelationDefinition;
    }
  | {
      readonly kind: 'namespace';
      readonly key: string;
      readonly path: string;
      readonly doc?: string;
      /** Key of the correlation this namespace sits in, if any. */
      readonly correlationKey?: string;
    };

interface WalkState {
  readonly entries: CatalogEntry[];
  readonly keys: Map<string, string>;
}

const claimKey = (state: WalkState, key: string, path: string): void => {
  checkKey(key);
  const existing = state.keys.get(key);
  if (existing !== undefined) {
    throw catalogError(
      `Duplicate event key "${key}" at ${describePath(path)} (already used at ${describePath(existing)}).`,
    );
  }
  state.keys.set(key, path);
};

interface Placement {
  readonly path: string;
  readonly derivedKey: string;
  readonly correlationKey: string | undefined;
}

const walkEvent = (state: WalkState, def: AnyEventDefinition, at: Placement): void => {
  const { path, correlationKey } = at;
  if (!Object.hasOwn(LOG_LEVELS, def.level)) {
    throw catalogError(`Event ${describePath(path)} has an invalid level "${String(def.level)}".`);
  }
  const key = def.keyOverride ?? at.derivedKey;
  claimKey(state, key, path);
  state.entries.push({
    kind: 'event',
    key,
    path,
    definition: { ...def, key },
    ...(correlationKey !== undefined ? { correlationKey } : {}),
    lifecycle: false,
  });
};

const checkLifecycleExtras = (def: AnyCorrelationDefinition, path: string): void => {
  const clashes = [
    ...Object.keys(def.completeFields ?? {}).filter((name) => name === 'duration'),
    ...Object.keys(def.failFields ?? {}).filter((name) => name === 'duration' || name === 'error'),
  ];
  if (clashes.length > 0) {
    throw catalogError(
      `Correlation ${describePath(path)} redefines built-in lifecycle field(s): ${clashes.join(', ')}.`,
    );
  }
};

const walkCorrelation = (
  state: WalkState,
  def: AnyCorrelationDefinition,
  path: string,
  derivedKey: string,
): void => {
  if (!Number.isFinite(def.timeout) || def.timeout < 0) {
    throw catalogError(
      `Correlation ${describePath(path)} has an invalid timeout ${def.timeout}. It must be a non-negative number.`,
    );
  }
  const key = def.keyOverride ?? derivedKey;
  checkKey(key);
  checkLifecycleExtras(def, path);
  state.entries.push({ kind: 'correlation', key, path, definition: { ...def, key } });
  const { start, complete, fail, timeout } = lifecycleEvents(key, def);
  for (const life of [start, complete, fail, timeout]) {
    claimKey(state, life.key, `${path} (lifecycle)`);
    state.entries.push({
      kind: 'event',
      key: life.key,
      path: life.key,
      definition: life,
      correlationKey: key,
      lifecycle: true,
    });
  }
  walkChildren(state, def.events, { path, derivedKey: key, correlationKey: key });
};

const walkNode = (state: WalkState, node: unknown, at: Placement): void => {
  const { path, derivedKey: keyPrefix, correlationKey } = at;
  if (typeof node !== 'object' || node === null) {
    throw catalogError(
      `Catalog entry ${describePath(path)} is ${node === undefined ? 'undefined' : 'not an object'}. ` +
        'If it is imported from another module, check for a circular import between your events module and the module that calls createChronicle().',
    );
  }
  if (isEventDefinition(node)) {
    walkEvent(state, node, at);
    return;
  }
  if (isCorrelationDefinition(node)) {
    if (correlationKey !== undefined) {
      throw catalogError(
        `Correlation ${describePath(path)} is defined inside correlation "${correlationKey}". Correlations can't contain correlations; start one inside another at runtime instead.`,
      );
    }
    walkCorrelation(state, node, path, keyPrefix);
    return;
  }
  const doc = namespaceDoc(node);
  state.entries.push({
    kind: 'namespace',
    key: keyPrefix,
    path,
    ...(doc !== undefined ? { doc } : {}),
    ...(correlationKey !== undefined ? { correlationKey } : {}),
  });
  walkChildren(state, node, at);
};

const walkChildren = (state: WalkState, node: object, at: Placement): void => {
  const { path, derivedKey, correlationKey } = at;
  for (const [name, child] of Object.entries(node)) {
    checkName(name, path);
    walkNode(state, child as unknown, {
      path: path === '' ? name : `${path}.${name}`,
      derivedKey: derivedKey === '' ? name : `${derivedKey}.${name}`,
      correlationKey,
    });
  }
};

/**
 * Walk a catalog and list every namespace, correlation and event with its resolved key.
 * Lifecycle events of each correlation are included with `lifecycle: true`.
 *
 * @param catalog - A catalog object (from {@link defineEvents} or a plain nested object)
 * @returns Entries in definition order
 * @throws {ChroniclerError} `INVALID_CATALOG` for undefined entries (often a circular import),
 *   reserved or invalid names, invalid levels or timeouts, nested correlation definitions and duplicate keys
 */
export const walkCatalog = (catalog: object): CatalogEntry[] => {
  const state: WalkState = { entries: [], keys: new Map() };
  walkChildren(state, catalog, { path: '', derivedKey: '', correlationKey: undefined });
  return state.entries;
};

const childKey = (prefix: string, name: string): string =>
  prefix === '' ? name : `${prefix}.${name}`;

/** Rebuild a namespace with every definition's `key` set from its path. */
const stampNamespace = (node: object, keyPrefix: string): object => {
  if (keyPrefix !== '' && isCatalog(node) && !isMountedCatalog(node)) {
    Object.defineProperty(node, MOUNTED_MARK, { value: true, enumerable: false });
  }
  const out: Record<string, object> = {};
  for (const [name, child] of Object.entries(node)) {
    out[name] = stamp(child as object, childKey(keyPrefix, name));
  }
  const doc = namespaceDoc(node);
  if (doc !== undefined) {
    Object.defineProperty(out, NAMESPACE_DOC, { value: doc, enumerable: false });
  }
  return out;
};

/** Rebuild a catalog subtree with every definition's `key` set from its path. */
const stamp = (node: object, keyPrefix: string): object => {
  if (isEventDefinition(node)) {
    return { ...node, key: node.keyOverride ?? keyPrefix };
  }
  if (isCorrelationDefinition(node)) {
    const key = node.keyOverride ?? keyPrefix;
    return { ...node, key, events: stampNamespace(node.events, key) };
  }
  return stampNamespace(node, keyPrefix);
};

/**
 * Define an event catalog: a nested object whose leaves are {@link event} and
 * {@link correlation} definitions. Each definition's `key` is set from its path, so
 * `events.admin.login.key === 'admin.login'`.
 *
 * Catalogs compose: a catalog can be mounted inside another, and keys are re-derived from the
 * outer path.
 *
 * @example
 * ```typescript
 * export const events = defineEvents({
 *   admin: {
 *     login: event({ level: 'audit', message: 'User login attempt', fields: { userId: field.string() } }),
 *   },
 * });
 * ```
 *
 * @throws {ChroniclerError} `INVALID_CATALOG` when the catalog is malformed (see {@link walkCatalog})
 */
export function defineEvents<const C extends object>(catalog: C & CheckCatalog<C>): C {
  walkCatalog(catalog);
  const stamped = stamp(catalog, '');
  Object.defineProperty(stamped, CATALOG_MARK, { value: true, enumerable: false });
  return stamped as C;
}
