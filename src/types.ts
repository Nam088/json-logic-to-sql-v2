export type FieldType = "string" | "number" | "boolean" | "date" | "uuid" | "array"

export type Primitive = string | number | boolean | null

export interface AllowedValueObject {
  value: Primitive
  label: string
  labelKey?: string
  [key: string]: any // Allows arbitrary properties like icon, color, etc.
}
export type AllowedValue = Primitive | AllowedValueObject

export interface FieldConstraints {
  // Enum — supports both plain primitives and { value, label } objects
  allowedValues?: AllowedValue[]

  // Number / Date bounds
  min?: number | string
  max?: number | string

  // String
  minLength?: number
  maxLength?: number
  format?: "email" | "uuid" | "url" | "ip" | "alphanumeric"
  pattern?: string

  // Array element type & size
  arrayOf?: Exclude<FieldType, "array">
  minItems?: number
  maxItems?: number
}

export type SortDirection = "asc" | "desc"

export interface SortRule {
  field: string
  direction: SortDirection
}

export interface InternalConfig {
  table?: string
  column?: string
  alias?: string
}

export interface FieldConfig {
  label?: string
  labelKey?: string
  [key: string]: any // Allows arbitrary custom config metadata
}

/**
 * Definition of a single filterable/sortable field in the schema.
 *
 * Each key in `FieldSchema` maps to a `FieldDef` that controls:
 * - Which operators are allowed on this field
 * - The expected value type and validation constraints
 * - How the field maps to a SQL column (via `columnName` or `internal`)
 * - Whether the field can be used in `ORDER BY` clauses (`sortable: true`)
 */
export interface FieldDef {
  type?: FieldType
  operators?: string[]
  columnName?: string
  column?: string
  orColumn?: string | string[]
  sqlExpression?: string
  orExpression?: string | string[]
  jsonPath?: string[]
  description?: string
  nullable?: boolean
  sortable?: boolean
  constraints?: FieldConstraints
  internal?: InternalConfig
  config?: FieldConfig
  validate?: (value: unknown) => boolean | string
  properties?: Record<string, FieldDef>
  [key: string]: any // Allows arbitrary custom properties on FieldDef itself
}

export type FieldSchema = Record<string, FieldDef>

export type ValidationErrorCode =
  | "FIELD_NOT_ALLOWED"
  | "OPERATOR_NOT_ALLOWED"
  | "OPERATOR_TYPE_MISMATCH"
  | "VALUE_TYPE_MISMATCH"
  | "VALUE_NOT_IN_ALLOWED_VALUES"
  | "VALUE_OUT_OF_RANGE"
  | "VALUE_FORMAT_INVALID"
  | "VALUE_LENGTH_INVALID"
  | "DEPTH_EXCEEDED"
  | "UNKNOWN_OPERATOR"
  | "INVALID_STRUCTURE"
  | "SORT_NOT_ENABLED"
  | "SORT_FIELD_NOT_SORTABLE"

export type ValidationError = {
  path: string
  field?: string
  operator?: string
  message: string
  code: ValidationErrorCode
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] }

export type OrderField = {
  column: string
  direction: "ASC" | "DESC"
}

/**
 * The compiled output from a successful `toSQL()` call.
 *
 * Contains two sets of parameters to safely support pagination:
 * - **`params`** — all parameters including `LIMIT`/`OFFSET` for the list query.
 * - **`filterParams`** — only the filter parameters, for use in `COUNT(*)` queries
 *   where `LIMIT`/`OFFSET` must not be bound (avoids driver parameter count mismatch).
 *
 * @example
 * // List query (11 params: 9 filter + limit + offset)
 * db.query(`SELECT * FROM users ${sql}`, params)
 *
 * // Count query (9 params: filter only)
 * db.query(`SELECT COUNT(*) FROM users ${filterSql}`, filterParams)
 */
export type Query = {
  sql: string
  filterSql: string
  sortSql?: string | undefined
  orderFields?: OrderField[] | undefined
  limitSql?: string | undefined
  offsetSql?: string | undefined
  params: Primitive[]
  namedParams?: Record<string, Primitive> | undefined
  filterParams: Primitive[]
  filterNamedParams?: Record<string, Primitive> | undefined
}

/**
 * Defines SQL `LIMIT` and `OFFSET` values for pagination.
 *
 * Both values must be non-negative integers. Validation errors are returned as
 * `{ code: "INVALID_STRUCTURE", path: "pagination.limit" }` if invalid.
 */
export type PaginationRule = {
  limit: number
  offset?: number
}

// AST node types
export type AstNode =
  | AndNode
  | OrNode
  | NotNode
  | ComparisonNode
  | InNode
  | BetweenNode
  | LikeNode
  | NullCheckNode
  | ArrayOpNode
  | JsonOpNode
  | CustomOpNode

export type AndNode = { type: "and"; children: AstNode[] }
export type OrNode = { type: "or"; children: AstNode[] }
export type NotNode = { type: "not"; child: AstNode }

export type LeafNodeBase = {
  tableName?: string | undefined
  jsonPath?: string[] | undefined
  fieldType?: FieldType | undefined
  sqlExpression?: string | undefined
  orExpression?: string | string[] | undefined
  arrayOf?: FieldType | undefined
}

export type FieldRefNode = {
  type: "field"
  field: string
  columnName: string
  tableName?: string | undefined
  sqlExpression?: string | undefined
  fieldType?: FieldType | undefined
  jsonPath?: string[] | undefined
  arrayOf?: FieldType | undefined
}

export function isFieldRefNode(node: unknown): node is FieldRefNode {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    (node as Record<string, unknown>).type === "field" &&
    "field" in node &&
    typeof (node as Record<string, unknown>).field === "string" &&
    "columnName" in node &&
    typeof (node as Record<string, unknown>).columnName === "string"
  )
}

export type ComparisonNode = LeafNodeBase & {
  type: "comparison"
  operator: "==" | "===" | "!=" | "!==" | ">" | ">=" | "<" | "<="
  field: string
  columnName: string
  value: Primitive | FieldRefNode
}

export type InNode = LeafNodeBase & {
  type: "in"
  negated: boolean
  field: string
  columnName: string
  values: (Primitive | FieldRefNode)[]
}

export type BetweenNode = LeafNodeBase & {
  type: "between"
  field: string
  columnName: string
  min: Primitive | FieldRefNode
  max: Primitive | FieldRefNode
}

export type LikeNode = LeafNodeBase & {
  type: "like"
  operator: "contains" | "not_contains" | "startsWith" | "endsWith" | "like" | "ilike"
  field: string
  columnName: string
  value: string | FieldRefNode
}

export type NullCheckNode = LeafNodeBase & {
  type: "null_check"
  negated: boolean
  field: string
  columnName: string
}

export type ArrayOpNode = LeafNodeBase & {
  type: "array_op"
  operator: "has_any" | "has_all" | "contained_by"
  field: string
  columnName: string
  values: (Primitive | FieldRefNode)[]
}

export type JsonOpNode = LeafNodeBase & {
  type: "json_op"
  operator: "json_has_key" | "json_has_any_keys"
  field: string
  columnName: string
  values: Primitive[]
}

export type CustomOpNode = LeafNodeBase & {
  type: "custom_op"
  operator: string
  field: string
  columnName: string
  values: unknown[]
}

// JSON Logic raw input types
export type JsonLogicVar = { var: string }
export type JsonLogicNode = Record<string, unknown>
