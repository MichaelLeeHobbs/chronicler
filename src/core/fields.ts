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
 * Field type builders - use these to define fields in events
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
 *   }
 * } as const);
 * ```
 */
export const t = {
  string: (): RequiredFieldBuilder<'string'> => createFieldBuilder('string'),
  number: (): RequiredFieldBuilder<'number'> => createFieldBuilder('number'),
  boolean: (): RequiredFieldBuilder<'boolean'> => createFieldBuilder('boolean'),
  error: (): RequiredFieldBuilder<'error'> => createFieldBuilder('error'),
} as const;

/**
 * Internal: Create a field builder with optional/doc chaining support
 */
function createFieldBuilder<T extends string>(type: T): RequiredFieldBuilder<T> {
  const builder: RequiredFieldBuilder<T> = {
    _type: type,
    _required: true as const,
    _doc: undefined,
    optional: () => {
      const optional: OptionalFieldBuilder<T> = {
        _type: type,
        _required: false as const,
        _doc: builder._doc,
        optional: () => optional,
        doc: (description: string) => {
          (optional as { _doc: string | undefined })._doc = description;
          return optional;
        },
      };
      return optional;
    },
    doc: (description: string) => {
      (builder as { _doc: string | undefined })._doc = description;
      return builder;
    },
  };
  return builder;
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
            ? unknown
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

/**
 * Extract runtime metadata from field builder for validation and docs
 */
export interface FieldMetadata {
  type: 'string' | 'number' | 'boolean' | 'error';
  required: boolean;
  doc: string;
}

/**
 * Extract runtime metadata from a field builder for validation and documentation.
 *
 * @param field - A field builder created via the `t` helpers
 * @returns An object with the field's `type`, `required` flag, and `doc` string
 */
export function extractFieldMetadata(field: FieldBuilder<string, boolean>): FieldMetadata {
  return {
    type: field._type as 'string' | 'number' | 'boolean' | 'error',
    required: field._required,
    doc: field._doc ?? '',
  };
}

/**
 * Legacy types for backward compatibility during migration
 * @deprecated Use FieldBuilder instead
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'error';

/**
 * @deprecated Use FieldBuilder instead
 */
export interface FieldDefinition<FType extends FieldType = FieldType> {
  type: FType;
  required: boolean;
  doc: string;
}

/**
 * @deprecated Use Record<string, FieldBuilder<any, any>> instead
 */
export type FieldDefinitions = Record<string, FieldDefinition>;
