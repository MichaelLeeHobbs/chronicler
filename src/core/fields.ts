export type FieldType = 'string' | 'number' | 'boolean' | 'error';

export interface FieldDefinition<FType extends FieldType = FieldType> {
  type: FType;
  required: boolean;
  doc: string;
}

export type FieldDefinitions = Record<string, FieldDefinition>;

type RequiredKeys<Field extends FieldDefinitions> = {
  [Key in keyof Field]-?: Field[Key]['required'] extends true ? Key : never;
}[keyof Field];

type OptionalKeys<Field extends FieldDefinitions> = {
  [Key in keyof Field]-?: Field[Key]['required'] extends true ? never : Key;
}[keyof Field];

export type InferFieldType<Field extends FieldDefinition> = Field['type'] extends 'string'
  ? string
  : Field['type'] extends 'number'
    ? number
    : Field['type'] extends 'boolean'
      ? boolean
      : Field['type'] extends 'error'
        ? unknown
        : never;

type Simplify<T> = { [Key in keyof T]: T[Key] } extends infer Obj
  ? { [Key in keyof Obj]: Obj[Key] }
  : never;

type EmptyRecord = Record<never, never>;

type BuildRequired<Fields extends FieldDefinitions> =
  RequiredKeys<Fields> extends never
    ? EmptyRecord
    : { [Key in RequiredKeys<Fields>]: InferFieldType<Fields[Key]> };

type BuildOptional<Fields extends FieldDefinitions> =
  OptionalKeys<Fields> extends never
    ? EmptyRecord
    : { [Key in OptionalKeys<Fields>]?: InferFieldType<Fields[Key]> };

export type InferFields<F extends FieldDefinitions> = Simplify<BuildRequired<F> & BuildOptional<F>>;
