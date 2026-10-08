/**
 * Event key lockfile: a sorted, stable snapshot of every event key in the catalog (including
 * span lifecycle keys) with its level and fields, used to catch accidental breaking
 * changes to the wire contract (`chronicler keys --write` / `--check`).
 */

import fs from 'node:fs';
import path from 'node:path';

import { applyEol, type EolStyle } from './eol';
import type { ParsedEventTree, ParsedField } from './types';

/** Lockfile format version. */
export const LOCKFILE_VERSION = 1;

/** A field as recorded in the lockfile. */
export interface LockedField {
  /** Field type; arrays are recorded as `<item type>[]` (`string[]`, `enum[]`). */
  readonly type: string;
  readonly required: boolean;
  /** Allowed values of an enum field or of an array of enums. Removing one is breaking. */
  readonly values?: readonly string[];
  /** Present when the field is redacted. Adding or removing it is breaking. */
  readonly sensitive?: true;
}

/** An event as recorded in the lockfile. */
export interface LockedEvent {
  readonly level: string;
  readonly fields: Readonly<Record<string, LockedField>>;
}

/** Contents of `chronicler.lock.json`. */
export interface KeyLockfile {
  readonly version: typeof LOCKFILE_VERSION;
  readonly events: Readonly<Record<string, LockedEvent>>;
}

/** Changes to one key between the lockfile and the current catalog. */
export interface KeyChange {
  readonly key: string;
  readonly changes: string[];
}

/** Result of comparing the current catalog against the lockfile. */
export interface KeyDiff {
  /** Keys in the catalog but not in the lockfile (non-breaking). */
  readonly added: string[];
  /** Keys in the lockfile but no longer in the catalog (breaking; a rename shows as removed + added). */
  readonly removed: string[];
  /** Keys whose level changed, or whose fields were removed or changed type or required-ness (breaking). */
  readonly changed: KeyChange[];
  /** Keys whose only changes are new fields or new enum values (non-breaking). */
  readonly extended: KeyChange[];
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortedEntries = <T>(record: Readonly<Record<string, T>>): [string, T][] =>
  Object.entries(record).sort(([a], [b]) => byCodeUnit(a, b));

const lockField = (field: ParsedField): LockedField => ({
  type: field.type === 'array' ? `${field.items ?? 'unknown'}[]` : field.type,
  required: field.required,
  ...(field.values !== undefined ? { values: [...field.values].sort(byCodeUnit) } : {}),
  ...(field.sensitive ? { sensitive: true as const } : {}),
});

/**
 * Build the lockfile contents for a parsed catalog. Keys and field names are sorted.
 *
 * @param tree - Parsed event tree
 * @returns Lockfile listing every event key, including lifecycle keys
 */
export function buildLockfile(tree: ParsedEventTree): KeyLockfile {
  const events: Record<string, LockedEvent> = {};
  const sorted = [...tree.events].sort((a, b) => byCodeUnit(a.key, b.key));
  for (const event of sorted) {
    const fields: Record<string, LockedField> = {};
    for (const [name, field] of sortedEntries(event.fields)) {
      fields[name] = lockField(field);
    }
    events[event.key] = { level: event.level, fields };
  }
  return { version: LOCKFILE_VERSION, events };
}

/**
 * Serialize a lockfile with stable formatting (2-space JSON, trailing newline).
 *
 * @param lockfile - Lockfile contents
 * @param eol - Line ending style (same as `docs.eol`)
 */
export function serializeLockfile(lockfile: KeyLockfile, eol?: EolStyle): string {
  return applyEol(`${JSON.stringify(lockfile, null, 2)}\n`, eol);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLockedField = (value: unknown): value is LockedField =>
  isRecord(value) &&
  typeof value.type === 'string' &&
  typeof value.required === 'boolean' &&
  (value.values === undefined ||
    (Array.isArray(value.values) && value.values.every((v) => typeof v === 'string'))) &&
  (value.sensitive === undefined || value.sensitive === true);

const isLockedEvent = (value: unknown): value is LockedEvent =>
  isRecord(value) &&
  typeof value.level === 'string' &&
  isRecord(value.fields) &&
  Object.values(value.fields).every(isLockedField);

/**
 * Parse and validate lockfile text.
 *
 * @param text - File contents
 * @param source - File name, for error messages
 * @throws {Error} If the text is not a valid lockfile
 */
export function parseLockfile(text: string, source: string): KeyLockfile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON`, { cause: error });
  }
  if (!isRecord(data) || data.version !== LOCKFILE_VERSION || !isRecord(data.events)) {
    throw new Error(`${source} is not a Chronicler key lockfile (version ${LOCKFILE_VERSION})`);
  }
  for (const [key, value] of Object.entries(data.events)) {
    if (!isLockedEvent(value)) {
      throw new Error(`${source}: entry "${key}" must have a "level" and "fields"`);
    }
  }
  return data as unknown as KeyLockfile;
}

/** Read a lockfile, or return undefined when it does not exist. */
export function readLockfile(filePath: string): KeyLockfile | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return parseLockfile(fs.readFileSync(filePath, 'utf-8'), path.basename(filePath));
}

/** Write a lockfile, creating its directory if needed. */
export function writeLockfile(filePath: string, lockfile: KeyLockfile, eol?: EolStyle): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeLockfile(lockfile, eol), 'utf-8');
}

const describeField = (field: LockedField): string =>
  `${field.type}${field.required ? '' : ', optional'}${field.sensitive ? ', sensitive' : ''}`;

const quoted = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(', ');

/** Compare one field present in both; returns [breaking, additive] descriptions. */
function diffField(name: string, before: LockedField, after: LockedField): [string[], string[]] {
  if (
    after.type !== before.type ||
    after.required !== before.required ||
    after.sensitive !== before.sensitive
  ) {
    return [[`field "${name}": ${describeField(before)} → ${describeField(after)}`], []];
  }
  const beforeValues = before.values ?? [];
  const afterValues = after.values ?? [];
  const removed = beforeValues.filter((v) => !afterValues.includes(v));
  const added = afterValues.filter((v) => !beforeValues.includes(v));
  return [
    removed.length > 0 ? [`field "${name}": values removed (${quoted(removed)})`] : [],
    added.length > 0 ? [`field "${name}": values added (${quoted(added)})`] : [],
  ];
}

/** Describe the field changes of one key; returns [breaking, additive] descriptions. */
function diffFields(locked: LockedEvent, current: LockedEvent): [string[], string[]] {
  const breaking: string[] = [];
  const additive: string[] = [];
  for (const [name, before] of sortedEntries(locked.fields)) {
    const after = current.fields[name];
    if (!after) {
      breaking.push(`field "${name}" removed`);
    } else {
      const [fieldBreaking, fieldAdditive] = diffField(name, before, after);
      breaking.push(...fieldBreaking);
      additive.push(...fieldAdditive);
    }
  }
  for (const [name, after] of sortedEntries(current.fields)) {
    if (!Object.hasOwn(locked.fields, name))
      additive.push(`field "${name}" added (${describeField(after)})`);
  }
  return [breaking, additive];
}

/**
 * Compare the current catalog against the lockfile.
 *
 * @param locked - Lockfile contents
 * @param current - Lockfile built from the current catalog
 * @returns Added, removed, changed (breaking) and extended (new fields only) keys, each sorted
 */
export function diffLockfiles(locked: KeyLockfile, current: KeyLockfile): KeyDiff {
  const diff: KeyDiff = { added: [], removed: [], changed: [], extended: [] };
  for (const [key, before] of sortedEntries(locked.events)) {
    const after = current.events[key];
    if (!after) {
      diff.removed.push(key);
      continue;
    }
    const [breaking, additive] = diffFields(before, after);
    if (after.level !== before.level) breaking.unshift(`level ${before.level} → ${after.level}`);
    if (breaking.length > 0) diff.changed.push({ key, changes: [...breaking, ...additive] });
    else if (additive.length > 0) diff.extended.push({ key, changes: additive });
  }
  for (const [key] of sortedEntries(current.events)) {
    if (!Object.hasOwn(locked.events, key)) diff.added.push(key);
  }
  return diff;
}

/** True when the diff contains removed or changed keys. */
export const isBreaking = (diff: KeyDiff): boolean =>
  diff.removed.length > 0 || diff.changed.length > 0;

/**
 * Format a diff for display.
 *
 * @param diff - Result of {@link diffLockfiles}
 * @returns Human-readable lines, breaking changes first
 */
export function formatDiff(diff: KeyDiff): string {
  const lines: string[] = [];
  if (isBreaking(diff)) {
    lines.push('Breaking changes:');
    for (const key of diff.removed) lines.push(`  removed: ${key}`);
    for (const { key, changes } of diff.changed)
      lines.push(`  changed: ${key} (${changes.join('; ')})`);
  }
  if (diff.added.length > 0 || diff.extended.length > 0) {
    lines.push('Non-breaking changes:');
    for (const key of diff.added) lines.push(`  added: ${key}`);
    for (const { key, changes } of diff.extended)
      lines.push(`  extended: ${key} (${changes.join('; ')})`);
  }
  return lines.length > 0 ? lines.join('\n') : 'No changes.';
}

/**
 * Format the key list for display: one line per key with its level and fields.
 *
 * @param lockfile - Lockfile contents
 */
export function formatKeyList(lockfile: KeyLockfile): string {
  return sortedEntries(lockfile.events)
    .map(([key, event]) => {
      const fields = sortedEntries(event.fields).map(
        ([name, field]) => `${name}${field.required ? '' : '?'}: ${field.type}`,
      );
      return `${key} [${event.level}]${fields.length > 0 ? ` { ${fields.join(', ')} }` : ''}`;
    })
    .join('\n');
}
