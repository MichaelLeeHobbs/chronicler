/**
 * Field type definitions with compile-time type safety
 */

/** Value type of each field type tag. */
interface FieldValueTypes {
  string: string;
  number: number;
  boolean: boolean;
  error: Error | string;
}

/** Default value type for a field type tag; `enum` and `array` builders set their own. */
type DefaultValue<T extends string> = T extends keyof FieldValueTypes
  ? FieldValueTypes[T]
  : unknown;

/**
 * Field builder with compile-time type inference. `T` is the field type tag, `R` whether the
 * field is required and `V` the TypeScript type of its value.
 */
export interface FieldBuilder<T extends string = string, R extends boolean = boolean, V = unknown> {
  readonly _type: T;
  readonly _required: R;
  readonly _doc: string | undefined;
  /** Redacted before the payload reaches the backend (see `redact` in the chronicle config). */
  readonly _sensitive: boolean;
  /** Allowed values of an `enum` field. */
  readonly _values?: readonly string[];
  /** Item builder of an `array` field. */
  readonly _items?: FieldBuilder;
  /** Type-only marker for the value type. Never set at runtime. */
  readonly _value?: V;
}

/**
 * Field builder with optional marker
 */
export interface OptionalFieldBuilder<T extends string, V = DefaultValue<T>>
  extends FieldBuilder<T, false, V> {
  readonly doc: (description: string) => OptionalFieldBuilder<T, V>;
  /** Mark the field as sensitive: its value is redacted before it reaches the backend. */
  readonly sensitive: () => OptionalFieldBuilder<T, V>;
}

/**
 * Field builder with required marker (default)
 */
export interface RequiredFieldBuilder<T extends string, V = DefaultValue<T>>
  extends FieldBuilder<T, true, V> {
  readonly optional: () => OptionalFieldBuilder<T, V>;
  readonly doc: (description: string) => RequiredFieldBuilder<T, V>;
  /** Mark the field as sensitive: its value is redacted before it reaches the backend. */
  readonly sensitive: () => RequiredFieldBuilder<T, V>;
}

/** Field types an array can hold. Arrays of arrays, errors or objects are not supported. */
export type ArrayItemType = 'string' | 'number' | 'boolean' | 'enum';

interface FieldSpec {
  readonly type: string;
  readonly doc: string | undefined;
  readonly sensitive: boolean;
  readonly values?: readonly string[];
  readonly items?: FieldBuilder;
}

const baseFields = (spec: FieldSpec) => ({
  _type: spec.type,
  _doc: spec.doc,
  _sensitive: spec.sensitive,
  ...(spec.values !== undefined ? { _values: spec.values } : {}),
  ...(spec.items !== undefined ? { _items: spec.items } : {}),
});

function makeOptional<T extends string, V>(spec: FieldSpec): OptionalFieldBuilder<T, V> {
  return {
    ...baseFields(spec),
    _required: false as const,
    doc: (description: string) => makeOptional<T, V>({ ...spec, doc: description }),
    sensitive: () => makeOptional<T, V>({ ...spec, sensitive: true }),
  } as OptionalFieldBuilder<T, V>;
}

function makeRequired<T extends string, V>(spec: FieldSpec): RequiredFieldBuilder<T, V> {
  return {
    ...baseFields(spec),
    _required: true as const,
    optional: () => makeOptional<T, V>(spec),
    doc: (description: string) => makeRequired<T, V>({ ...spec, doc: description }),
    sensitive: () => makeRequired<T, V>({ ...spec, sensitive: true }),
  } as RequiredFieldBuilder<T, V>;
}

const simple = <T extends keyof FieldValueTypes>(type: T): RequiredFieldBuilder<T> =>
  makeRequired({ type, doc: undefined, sensitive: false });

/**
 * Field type builders — use these to define fields in events.
 *
 * @example
 * ```typescript
 * const login = event({
 *   level: 'audit',
 *   message: 'Login attempt',
 *   fields: {
 *     userId: field.string().doc('User ID'),
 *     email: field.string().sensitive().doc('Email address'),
 *     outcome: field.enum(['success', 'failure', 'locked']),
 *     roles: field.array(field.string()).optional(),
 *     error: field.error().optional(),
 *   },
 * });
 * ```
 */
export const field = {
  string: (): RequiredFieldBuilder<'string'> => simple('string'),
  number: (): RequiredFieldBuilder<'number'> => simple('number'),
  boolean: (): RequiredFieldBuilder<'boolean'> => simple('boolean'),
  error: (): RequiredFieldBuilder<'error'> => simple('error'),
  /** One of a fixed list of strings. The value type is their union. */
  enum: <const V extends readonly [string, ...string[]]>(
    values: V,
  ): RequiredFieldBuilder<'enum', V[number]> =>
    makeRequired({ type: 'enum', doc: undefined, sensitive: false, values: [...values] }),
  /**
   * An array of strings, numbers, booleans or enum values. Arrays longer than
   * `limits.maxArrayLength` are truncated and listed in `_validation.truncatedFields`.
   */
  array: <I extends FieldBuilder<ArrayItemType>>(
    items: I,
  ): RequiredFieldBuilder<'array', readonly InferFieldType<I>[]> =>
    makeRequired({ type: 'array', doc: undefined, sensitive: false, items }),
} as const;

/**
 * Utility type to simplify intersections
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Infer the TypeScript type from a field builder
 */
export type InferFieldType<F> = F extends FieldBuilder<string, boolean, infer V> ? V : never;

/**
 * Build required fields object
 */
type BuildRequired<F extends Record<string, FieldBuilder>> = {
  [K in keyof F as F[K]['_required'] extends true ? K : never]: InferFieldType<F[K]>;
};

/**
 * Build optional fields object
 */
type BuildOptional<F extends Record<string, FieldBuilder>> = {
  [K in keyof F as F[K]['_required'] extends false ? K : never]?: InferFieldType<F[K]>;
};

/**
 * Infer complete field types from field builders
 * Required fields become required properties, optional fields become optional
 */
export type InferFields<F extends Record<string, FieldBuilder>> = Simplify<
  BuildRequired<F> & BuildOptional<F>
>;
