/**
 * Field type definitions with compile-time type safety
 */

/**
 * Field builder with compile-time type inference
 */
export interface FieldBuilder<T extends string, R extends boolean> {
  readonly _type: T;
  readonly _required: R;
  readonly _doc: string | undefined;
}

/**
 * Field builder with optional marker
 */
export interface OptionalFieldBuilder<T extends string> extends FieldBuilder<T, false> {
  readonly optional: () => OptionalFieldBuilder<T>;
  readonly doc: (description: string) => OptionalFieldBuilder<T>;
}

/**
 * Field builder with required marker (default)
 */
export interface RequiredFieldBuilder<T extends string> extends FieldBuilder<T, true> {
  readonly optional: () => OptionalFieldBuilder<T>;
  readonly doc: (description: string) => RequiredFieldBuilder<T>;
}

/**
 * Field type builders - use these to define fields in events.
 *
 * Tip: if `t` collides with your i18n library, import the {@link field} alias instead.
 *
 * @example
 * ```typescript
 * const event = defineEvent({
 *   key: 'user.created',
 *   level: 'info',
 *   message: 'User created',
 *   fields: {
 *     userId: t.string().doc('User ID'),
 *     age: t.number().optional().doc('User age'),
 *     isActive: t.boolean(),
 *     error: t.error().optional(),
 *   },
 * });
 * ```
 */
export const t = {
  string: (): RequiredFieldBuilder<'string'> => createFieldBuilder('string'),
  number: (): RequiredFieldBuilder<'number'> => createFieldBuilder('number'),
  boolean: (): RequiredFieldBuilder<'boolean'> => createFieldBuilder('boolean'),
  error: (): RequiredFieldBuilder<'error'> => createFieldBuilder('error'),
} as const;

/**
 * Alias for {@link t} — use whichever name fits your codebase.
 *
 * `field` avoids collisions with common i18n conventions that also use `t`.
 */
export const field = t;

/**
 * Internal: Create a field builder with optional/doc chaining support
 */
function makeOptional<T extends string>(type: T, doc: string | undefined): OptionalFieldBuilder<T> {
  return {
    _type: type,
    _required: false as const,
    _doc: doc,
    optional: () => makeOptional(type, doc),
    doc: (description: string) => makeOptional(type, description),
  };
}

function makeRequired<T extends string>(type: T, doc: string | undefined): RequiredFieldBuilder<T> {
  return {
    _type: type,
    _required: true as const,
    _doc: doc,
    optional: () => makeOptional(type, doc),
    doc: (description: string) => makeRequired(type, description),
  };
}

function createFieldBuilder<T extends string>(type: T): RequiredFieldBuilder<T> {
  return makeRequired(type, undefined);
}

/**
 * Utility type to simplify intersections
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Infer the TypeScript type from a field builder
 */
export type InferFieldType<F> =
  F extends FieldBuilder<infer T, boolean>
    ? T extends 'string'
      ? string
      : T extends 'number'
        ? number
        : T extends 'boolean'
          ? boolean
          : T extends 'error'
            ? Error | string
            : never
    : never;

/**
 * Build required fields object
 */
type BuildRequired<F extends Record<string, FieldBuilder<string, boolean>>> = {
  [K in keyof F as F[K]['_required'] extends true ? K : never]: InferFieldType<F[K]>;
};

/**
 * Build optional fields object
 */
type BuildOptional<F extends Record<string, FieldBuilder<string, boolean>>> = {
  [K in keyof F as F[K]['_required'] extends false ? K : never]?: InferFieldType<F[K]>;
};

/**
 * Infer complete field types from field builders
 * Required fields become required properties, optional fields become optional
 */
export type InferFields<F extends Record<string, FieldBuilder<string, boolean>>> = Simplify<
  BuildRequired<F> & BuildOptional<F>
>;
