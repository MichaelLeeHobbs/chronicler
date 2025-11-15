export type FieldType = 'string' | 'number' | 'boolean' | 'error';

export interface FieldDefinition<TType extends FieldType = FieldType> {
  type: TType;
  required: boolean;
  doc: string;
}

export type FieldDefinitions = Record<string, FieldDefinition>;

type RequiredKeys<F extends FieldDefinitions> = {
  [K in keyof F]-?: F[K]['required'] extends true ? K : never;
}[keyof F];

type OptionalKeys<F extends FieldDefinitions> = {
  [K in keyof F]-?: F[K]['required'] extends true ? never : K;
}[keyof F];

export type InferFieldType<T extends FieldDefinition> = T['type'] extends 'string'
  ? string
  : T['type'] extends 'number'
    ? number
    : T['type'] extends 'boolean'
      ? boolean
      : T['type'] extends 'error'
        ? unknown
        : never;

type Simplify<T> = { [K in keyof T]: T[K] } extends infer O ? { [K in keyof O]: O[K] } : never;

type EmptyRecord = Record<never, never>;

type BuildRequired<F extends FieldDefinitions> =
  RequiredKeys<F> extends never
    ? EmptyRecord
    : {
        [K in RequiredKeys<F>]: InferFieldType<F[K]>;
      };

type BuildOptional<F extends FieldDefinitions> =
  OptionalKeys<F> extends never
    ? EmptyRecord
    : {
        [K in OptionalKeys<F>]?: InferFieldType<F[K]>;
      };

export type InferFields<F extends FieldDefinitions> = Simplify<BuildRequired<F> & BuildOptional<F>>;
