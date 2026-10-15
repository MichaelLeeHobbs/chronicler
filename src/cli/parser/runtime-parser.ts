/**
 * Runtime parser for extracting event catalogs from TypeScript files.
 * Uses esbuild to compile .ts files before importing them.
 *
 * The CLI bundles its own copy of the core library while the user's events module imports the
 * published package, so catalogs are recognised only through the cross-copy-safe helpers
 * (`isCatalog`, `isMountedCatalog` and `walkCatalog`, which rely on `Symbol.for` marks and the
 * string `kind` discriminant) — never through `instanceof` or module identity.
 */

import path from 'node:path';

import { type CatalogEntry, isCatalog, isMountedCatalog, walkCatalog } from '../../core/events';
import { importTsModule } from '../ts-import';
import type {
  ParsedEvent,
  ParsedEventGroup,
  ParsedEventTree,
  ParsedField,
  ValidationError,
} from '../types';

/** Options for {@link parseEventsFile} and {@link parseEventsModule}. */
export interface ParseOptions {
  /** Name of the export holding the catalog. When omitted, every root catalog export is used. */
  readonly exportName?: string | undefined;
}

interface NamedCatalog {
  readonly name: string;
  readonly catalog: object;
}

type CatalogSelection = { readonly catalogs: NamedCatalog[] } | { readonly error: ValidationError };

interface BuildState {
  readonly events: ParsedEvent[];
  readonly groups: ParsedEventGroup[];
  readonly rootEvents: ParsedEvent[];
  readonly errors: ValidationError[];
  /** Event key → export it was first seen in, to detect clashes between catalogs. */
  readonly keyOwners: Map<string, string>;
}

const parseError = (message: string): ValidationError => ({ type: 'parse-error', message });

/** True for a `ChroniclerError('INVALID_CATALOG')` from any copy of the package. */
const isCatalogError = (error: unknown): error is Error =>
  error instanceof Error && (error as { code?: unknown }).code === 'INVALID_CATALOG';

/** Heuristic for a Chronicler 1.x event group (`{ key, type: 'system' | 'span' }`). */
const looksLikeV1Group = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.key === 'string' && (v.type === 'system' || v.type === 'span');
};

function selectNamedExport(mod: Record<string, unknown>, exportName: string): CatalogSelection {
  if (!Object.hasOwn(mod, exportName)) {
    return { error: parseError(`Export "${exportName}" (eventsExport) not found in events file.`) };
  }
  const value = mod[exportName];
  if (!isCatalog(value)) {
    return {
      error: parseError(
        `Export "${exportName}" (eventsExport) is not an event catalog. Export the object returned by defineEvents().`,
      ),
    };
  }
  return { catalogs: [{ name: exportName, catalog: value }] };
}

function noCatalogError(mod: Record<string, unknown>): ValidationError {
  const names = Object.keys(mod);
  const mounted = names.filter((name) => isCatalog(mod[name]));
  const v1 = names.filter((name) => looksLikeV1Group(mod[name]));
  let message =
    'No event catalog exported from the events file. Export the object returned by defineEvents(), e.g. `export const events = defineEvents({ ... })`.';
  if (mounted.length > 0) {
    message += ` Only catalogs mounted inside another catalog were found (${mounted.join(', ')}); export the root catalog or set "eventsExport" in chronicler.config.ts.`;
  }
  if (v1.length > 0) {
    message += ` Exports ${v1.join(', ')} look like Chronicler 1.x event groups; Chronicler 2.0 uses defineEvents().`;
  }
  return parseError(message);
}

/** Pick the catalogs to document: the named export, or every root (non-mounted) catalog export. */
function selectCatalogs(mod: Record<string, unknown>, exportName?: string): CatalogSelection {
  if (exportName !== undefined) return selectNamedExport(mod, exportName);

  // Named exports first so `export default events` alongside `export const events` keeps its name.
  const names = Object.keys(mod).sort((a, b) => Number(a === 'default') - Number(b === 'default'));
  const seen = new Set<object>();
  const catalogs: NamedCatalog[] = [];
  for (const name of names) {
    const value = mod[name];
    if (!isCatalog(value) || isMountedCatalog(value) || seen.has(value)) continue;
    seen.add(value);
    catalogs.push({ name, catalog: value });
  }
  return catalogs.length > 0 ? { catalogs } : { error: noCatalogError(mod) };
}

interface BuilderLike {
  readonly _type?: unknown;
  readonly _required?: unknown;
  readonly _doc?: unknown;
  readonly _sensitive?: unknown;
  readonly _values?: unknown;
  readonly _items?: BuilderLike;
}

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') ? [...value] : undefined;

/** Reduce one field builder to plain data. */
function toParsedField(builder: BuilderLike & { _type: string }): ParsedField {
  const items = builder._items;
  const values = stringArray(builder._values) ?? stringArray(items?._values);
  return {
    type: builder._type,
    required: builder._required === true,
    doc: typeof builder._doc === 'string' ? builder._doc : '',
    sensitive: builder._sensitive === true,
    ...(values !== undefined ? { values } : {}),
    ...(typeof items?._type === 'string' ? { items: items._type } : {}),
  };
}

/** Reduce field builders (from any copy of the package) to plain data. */
function toParsedFields(fields: unknown): Record<string, ParsedField> {
  const result: Record<string, ParsedField> = {};
  if (typeof fields !== 'object' || fields === null) return result;
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'object' || value === null) continue;
    const builder = value as BuilderLike;
    if (typeof builder._type !== 'string') continue;
    result[name] = toParsedField(builder as BuilderLike & { _type: string });
  }
  return result;
}

function toParsedEvent(entry: Extract<CatalogEntry, { kind: 'event' }>): ParsedEvent {
  const def = entry.definition;
  return {
    key: entry.key,
    path: entry.path,
    level: def.level,
    message: def.message,
    doc: def.doc ?? '',
    fields: toParsedFields(def.fields),
    ...(entry.spanKey !== undefined ? { spanKey: entry.spanKey } : {}),
    lifecycle: entry.lifecycle,
  };
}

const parentPath = (entryPath: string): string => {
  const dot = entryPath.lastIndexOf('.');
  return dot === -1 ? '' : entryPath.slice(0, dot);
};

const lastSegment = (entryPath: string): string => entryPath.slice(entryPath.lastIndexOf('.') + 1);

function makeGroup(entry: Exclude<CatalogEntry, { kind: 'event' }>): ParsedEventGroup {
  const base = { key: entry.key, path: entry.path, events: {}, lifecycleEvents: [], groups: {} };
  if (entry.kind === 'namespace') {
    return { ...base, kind: 'namespace', doc: entry.doc ?? '' };
  }
  return {
    ...base,
    kind: 'span',
    doc: entry.definition.doc ?? '',
    timeout: entry.definition.timeout,
  };
}

/** Builds the group hierarchy of one catalog from its `walkCatalog` entries. */
class CatalogTreeBuilder {
  private readonly byPath = new Map<string, ParsedEventGroup>();
  private readonly bySpanKey = new Map<string, ParsedEventGroup>();

  constructor(
    private readonly state: BuildState,
    private readonly exportName: string,
  ) {}

  add(entry: CatalogEntry): void {
    if (entry.kind === 'event') {
      this.addEvent(entry);
      return;
    }
    const group = makeGroup(entry);
    this.byPath.set(entry.path, group);
    if (entry.kind === 'span') this.bySpanKey.set(entry.key, group);
    const parent = this.byPath.get(parentPath(entry.path));
    if (parent) parent.groups[lastSegment(entry.path)] = group;
    else this.state.groups.push(group);
  }

  private addEvent(entry: Extract<CatalogEntry, { kind: 'event' }>): void {
    const event = toParsedEvent(entry);
    if (!this.claimKey(event.key)) return;
    this.state.events.push(event);
    if (entry.lifecycle) {
      const owner = this.bySpanKey.get(entry.spanKey ?? '');
      owner?.lifecycleEvents.push(event);
      return;
    }
    const parent = this.byPath.get(parentPath(entry.path));
    if (parent) parent.events[lastSegment(entry.path)] = event;
    else this.state.rootEvents.push(event);
  }

  /** Record the key; report a clash with another exported catalog. */
  private claimKey(key: string): boolean {
    const owner = this.state.keyOwners.get(key);
    if (owner === undefined) {
      this.state.keyOwners.set(key, this.exportName);
      return true;
    }
    this.state.errors.push({
      type: 'duplicate-key',
      message: `Event key "${key}" in export "${this.exportName}" is already defined in export "${owner}".`,
    });
    return false;
  }
}

/** Walk one catalog into the shared state, turning INVALID_CATALOG errors into validation errors. */
function addCatalog(state: BuildState, { name, catalog }: NamedCatalog): void {
  let entries: CatalogEntry[];
  try {
    entries = walkCatalog(catalog);
  } catch (error) {
    if (!isCatalogError(error)) throw error;
    state.errors.push({ type: 'invalid-catalog', message: `${name}: ${error.message}` });
    return;
  }
  const builder = new CatalogTreeBuilder(state, name);
  for (const entry of entries) builder.add(entry);
}

const emptyTree = (errors: ValidationError[]): ParsedEventTree => ({
  events: [],
  groups: [],
  rootEvents: [],
  catalogExports: [],
  errors,
});

/**
 * Build the event tree from an already-imported events module.
 *
 * @param mod - The module's exports
 * @param options - Optional export name to read the catalog from
 * @returns Parsed event tree; problems are reported in `errors`, never thrown
 */
export function parseEventsModule(
  mod: Record<string, unknown>,
  options: ParseOptions = {},
): ParsedEventTree {
  const selection = selectCatalogs(mod, options.exportName);
  if ('error' in selection) return emptyTree([selection.error]);

  const state: BuildState = {
    events: [],
    groups: [],
    rootEvents: [],
    errors: [],
    keyOwners: new Map(),
  };
  for (const named of selection.catalogs) addCatalog(state, named);

  return {
    events: state.events,
    groups: state.groups,
    rootEvents: state.rootEvents,
    catalogExports: selection.catalogs.map((c) => c.name),
    errors: state.errors,
  };
}

/**
 * Parse an events file by compiling it via esbuild and inspecting its exported catalogs.
 *
 * **Security note:** This function dynamically imports a user-authored TypeScript
 * file, which executes arbitrary code. This is acceptable for a CLI tool that
 * the user invokes locally, but callers must never pass untrusted paths.
 *
 * @param filePath - Path to the TypeScript events file to parse
 * @param options - Optional export name to read the catalog from
 * @returns Parsed event tree containing events, groups, and any parse/catalog errors
 */
export async function parseEventsFile(
  filePath: string,
  options: ParseOptions = {},
): Promise<ParsedEventTree> {
  let mod: Record<string, unknown>;
  try {
    mod = await importTsModule(path.resolve(filePath));
  } catch (error) {
    // defineEvents() throws INVALID_CATALOG while the module is evaluated.
    if (!isCatalogError(error)) throw error;
    return emptyTree([{ type: 'invalid-catalog', message: error.message }]);
  }
  return parseEventsModule(mod, options);
}
