import { validate } from "./validator/index.js"
import { normalize } from "./normalizer/index.js"
import { compile } from "./compiler/index.js"
import { flattenSchema } from "./utils/schema.js"
import { OperatorRegistry, type OperatorDef } from "./registry/index.js"
import { postgresDialect, postgresNamedDialect, postgresAnonymousDialect } from "./dialects/postgres.js"
import { mysqlDialect, mysqlNamedDialect } from "./dialects/mysql.js"
import { sqliteDialect, sqliteNamedDialect } from "./dialects/sqlite.js"
import { mssqlDialect, mssqlNamedDialect } from "./dialects/mssql.js"
import type { Dialect } from "./dialects/interface.js"
import type { FieldSchema, Query, Result, SortRule, ValidationError, PaginationRule, FieldDef } from "./types.js"

export type {
  FieldSchema,
  FieldDef,
  FieldConstraints,
  FieldConfig,
  FieldType,
  InternalConfig,
  Primitive,
  AllowedValue,
  AllowedValueObject,
  SortDirection,
  SortRule,
  Query,
  Result,
  ValidationError,
  ValidationErrorCode,
  OrderField,
  PaginationRule,
} from "./types.js"
export type { Dialect, ParamStyle } from "./dialects/interface.js"
export type { OperatorDef } from "./registry/index.js"
export { defineOperator } from "./registry/index.js"
export { postgresDialect, postgresNamedDialect, postgresAnonymousDialect } from "./dialects/postgres.js"
export { mysqlDialect, mysqlNamedDialect } from "./dialects/mysql.js"
export { sqliteDialect, sqliteNamedDialect } from "./dialects/sqlite.js"
export { mssqlDialect, mssqlNamedDialect } from "./dialects/mssql.js"

const DIALECTS: Record<string, Dialect> = {
  postgres: postgresDialect,
  "postgres-named": postgresNamedDialect,
  "postgres-anonymous": postgresAnonymousDialect,
  mysql: mysqlDialect,
  "mysql-named": mysqlNamedDialect,
  sqlite: sqliteDialect,
  "sqlite-named": sqliteNamedDialect,
  mssql: mssqlDialect,
  "mssql-named": mssqlNamedDialect,
}

/**
 * Options for configuring a `Converter` instance.
 */
export type ConverterOptions = {
  /** The SQL dialect to target. Can be a dialect name string or a custom `Dialect` object.
   * @default "postgres"
   */
  dialect?: string | Dialect
  /** Maximum allowed JSON Logic nesting depth. Requests exceeding this depth return a `DEPTH_EXCEEDED` error.
   * @default 30
   */
  maxDepth?: number
  /** Set to `true` to allow `sort` rules to be passed to `toSQL()`. Defaults to `false` for safety.
   * @default false
   */
  sort?: boolean
  /** Map of custom operator definitions to register alongside built-in operators. */
  operators?: Record<string, OperatorDef>
  /** SQL clause prefix prepended to the compiled filter expression.
   * @default "WHERE "
   */
  prefix?: string
}

export type ToSQLOptions = {
  sort?: SortRule[]
  pagination?: PaginationRule
  fieldMappings?: Record<string, string | Partial<FieldDef>>
}

export type ToSQLSingleObject = {
  rule?: unknown
  logic?: unknown
  sort?: SortRule[]
  pagination?: PaginationRule
  fieldMappings?: Record<string, string | Partial<FieldDef>>
}

export type Converter = {
  toSQL(options: ToSQLSingleObject): Result<Query>
  toSQL(jsonLogic: unknown, sortOrOptions?: SortRule[] | ToSQLOptions, pagination?: PaginationRule): Result<Query>
}

/**
 * Strips backend-sensitive fields from a schema before sending it to untrusted clients
 * (e.g., a browser frontend that needs to validate JSON Logic rules locally).
 *
 * Removed fields: `internal` (table/column mappings), `columnName`, and `validate`
 * (server-side JS validation functions that could expose implementation details).
 *
 * @param schema - The full server-side `FieldSchema`.
 * @returns A safe, stripped copy of the schema suitable for public exposure.
 *
 * @example
 * const publicSchema = toPublicSchema(schema)
 * // Send publicSchema to the frontend — no DB column names or server logic exposed
 */
export function toPublicSchema(schema: FieldSchema): FieldSchema {
  function cleanDef(def: any): any {
    const {
      internal: _,
      columnName: __,
      column: ___,
      orColumn: ____,
      sqlExpression: _____,
      orExpression: ______,
      validate: _______,
      properties,
      ...pub
    } = def
    if (properties) {
      const cleanProps: Record<string, any> = {}
      for (const [k, v] of Object.entries(properties)) {
        cleanProps[k] = cleanDef(v)
      }
      pub.properties = cleanProps
    }
    return pub
  }

  const result: FieldSchema = {}
  for (const [key, def] of Object.entries(schema)) {
    result[key] = cleanDef(def)
  }
  return result
}

/**
 * Creates a reusable converter that validates and compiles JSON Logic rules into
 * parameterized SQL query fragments.
 *
 * The converter enforces a **zero-trust** security model: every field, operator,
 * and value is validated against the provided `schema` before any SQL is generated.
 * Values are always parameterized — never interpolated into the SQL string.
 *
 * @param schema - The field schema that defines allowed fields, operators, types, and constraints.
 * @param options - Optional configuration for dialect, depth limit, sorting, and custom operators.
 * @returns A `Converter` object with a `toSQL()` method.
 *
 * @example
 * const converter = createConverter(schema, { dialect: "postgres", sort: true })
 * const result = converter.toSQL({ ">": [{ var: "age" }, 18] })
 * if (result.ok) {
 *   const { sql, params } = result.value
 *   // sql   → 'WHERE "age" > $1'
 *   // params → [18]
 * }
 */
export function createConverter(schema: FieldSchema, options: ConverterOptions = {}): Converter {
  const flatSchema = flattenSchema(schema)

  const {
    dialect: dialectOption = "postgres",
    maxDepth = 30,
    sort: sortEnabled = false,
    operators = {},
    prefix = "WHERE ",
  } = options

  const dialect: Dialect =
    typeof dialectOption === "string"
      ? (DIALECTS[dialectOption] ??
        (() => {
          throw new Error(`Unknown dialect: "${dialectOption}"`)
        })())
      : dialectOption

  const registry = new OperatorRegistry(operators)

  return {
    toSQL(
      jsonLogicOrObj: unknown,
      sortOrOptions?: SortRule[] | ToSQLOptions,
      pagination?: PaginationRule
    ): Result<Query> {
      let rule: unknown = jsonLogicOrObj
      let sort: SortRule[] | undefined = undefined
      let pag: PaginationRule | undefined = pagination
      let fieldMappings: Record<string, string | Partial<FieldDef>> | undefined = undefined

      // Single-object signature: { rule?, logic?, sort?, pagination?, fieldMappings? }
      // Detection: all keys must be known single-object keys (prevents misidentifying a JSON Logic
      // node whose operator happens to be named "rule" or "logic" with extra unknown keys).
      // Known limitation: { rule: [{ var: "field" }, value] } is ambiguous when "rule" is a custom
      // operator — avoid naming custom operators "rule" or "logic" to prevent this.
      // Keep in sync with ToSQLSingleObject interface keys when adding new top-level keys.
      const SINGLE_OBJ_KEYS = new Set(["rule", "logic", "sort", "pagination", "fieldMappings"])
      if (
        jsonLogicOrObj &&
        typeof jsonLogicOrObj === "object" &&
        !Array.isArray(jsonLogicOrObj) &&
        ("rule" in jsonLogicOrObj || "logic" in jsonLogicOrObj) &&
        Object.keys(jsonLogicOrObj).every((k) => SINGLE_OBJ_KEYS.has(k)) &&
        sortOrOptions === undefined &&
        pagination === undefined
      ) {
        const obj = jsonLogicOrObj as ToSQLSingleObject
        rule = obj.rule !== undefined ? obj.rule : obj.logic
        sort = obj.sort
        pag = obj.pagination
        fieldMappings = obj.fieldMappings
      } else {
        // Traditional signatures
        if (Array.isArray(sortOrOptions)) {
          sort = sortOrOptions
        } else if (sortOrOptions && typeof sortOrOptions === "object") {
          sort = sortOrOptions.sort
          pag = sortOrOptions.pagination
          fieldMappings = sortOrOptions.fieldMappings
        } else if (sortOrOptions !== undefined && sortOrOptions !== null) {
          return {
            ok: false,
            errors: [
              {
                path: "sort",
                message: "Sort parameter must be an array of sort rules",
                code: "INVALID_STRUCTURE",
              },
            ],
          }
        }
      }

      let activeSchema = flatSchema
      if (fieldMappings && Object.keys(fieldMappings).length > 0) {
        for (const [field, mapping] of Object.entries(fieldMappings)) {
          if (!(field in flatSchema)) {
            return {
              ok: false,
              errors: [{ path: `fieldMappings.${field}`, message: `Field "${field}" does not exist in the schema`, code: "FIELD_NOT_ALLOWED" }],
            }
          }
          if (typeof mapping === "string" && !mapping.trim()) {
            return {
              ok: false,
              errors: [{ path: `fieldMappings.${field}`, message: `Field mapping for "${field}" must not be blank or whitespace-only`, code: "INVALID_STRUCTURE" }],
            }
          }
          if (mapping && typeof mapping === "object") {
            if ("column" in mapping && typeof mapping.column === "string" && !mapping.column.trim()) {
              return {
                ok: false,
                errors: [{ path: `fieldMappings.${field}.column`, message: `Field mapping column for "${field}" must not be blank or whitespace-only`, code: "INVALID_STRUCTURE" }],
              }
            }
          }
        }
        activeSchema = { ...flatSchema }
        for (const [field, mapping] of Object.entries(fieldMappings)) {
          const originalDef = activeSchema[field] || {}
          let enrichedDef: FieldDef = { ...originalDef }
          if (typeof mapping === "string") {
            const isRaw = /[\s(:]/.test(mapping)
            if (isRaw) {
              enrichedDef.sqlExpression = mapping
            } else {
              enrichedDef.columnName = mapping
            }
          } else if (mapping && typeof mapping === "object") {
            enrichedDef = { ...enrichedDef, ...mapping }
            if (mapping.column) {
              const isRaw = /[\s(:]/.test(mapping.column)
              if (isRaw) {
                enrichedDef.sqlExpression = mapping.column
              } else {
                enrichedDef.columnName = mapping.column
              }
            }
            if (mapping.orColumn) {
              enrichedDef.orExpression = mapping.orColumn
            }
          }
          activeSchema[field] = enrichedDef
        }
      }

      const errors: ValidationError[] = validate(rule, activeSchema, registry, { maxDepth, sortEnabled, dialect }, sort, pag)

      if (errors.length > 0) {
        return { ok: false, errors }
      }

      try {
        const ast = normalize(rule, activeSchema)
        const query = compile(ast, dialect, sort, activeSchema, prefix, pag, registry)
        return { ok: true, value: query }
      } catch (err) {
        return {
          ok: false,
          errors: [
            {
              path: "",
              message: err instanceof Error ? err.message : "Compilation failed",
              code: "INVALID_STRUCTURE",
            },
          ],
        }
      }
    },
  }
}
