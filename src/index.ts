import { validate } from "./validator/index.js"
import { normalize } from "./normalizer/index.js"
import { compile } from "./compiler/index.js"
import { OperatorRegistry } from "./registry/index.js"
import { postgresDialect, postgresNamedDialect, postgresAnonymousDialect } from "./dialects/postgres.js"
import { mysqlDialect, mysqlNamedDialect } from "./dialects/mysql.js"
import { sqliteDialect, sqliteNamedDialect } from "./dialects/sqlite.js"
import { mssqlDialect, mssqlNamedDialect } from "./dialects/mssql.js"
import type { Dialect } from "./dialects/interface.js"
import type { FieldSchema, Query, Result, SortRule, ValidationError, PaginationRule } from "./types.js"

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
  operators?: Record<string, import("./registry/index.js").OperatorDef>
  /** SQL clause prefix prepended to the compiled filter expression.
   * @default "WHERE "
   */
  prefix?: string
}

export type ToSQLOptions = {
  sort?: SortRule[]
  pagination?: PaginationRule
}

export type ToSQLSingleObject = {
  rule?: unknown
  logic?: unknown
  sort?: SortRule[]
  pagination?: PaginationRule
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
  const result: FieldSchema = {}
  for (const [key, def] of Object.entries(schema)) {
    const { internal: _, columnName: __, validate: ___, ...pub } = def
    result[key] = pub
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

      // Check if the single object signature is used
      if (
        jsonLogicOrObj &&
        typeof jsonLogicOrObj === "object" &&
        !Array.isArray(jsonLogicOrObj) &&
        ("rule" in jsonLogicOrObj || "logic" in jsonLogicOrObj) &&
        sortOrOptions === undefined &&
        pagination === undefined
      ) {
        const obj = jsonLogicOrObj as ToSQLSingleObject
        rule = obj.rule !== undefined ? obj.rule : obj.logic
        sort = obj.sort
        pag = obj.pagination
      } else {
        // Traditional signatures
        if (Array.isArray(sortOrOptions)) {
          sort = sortOrOptions
        } else if (sortOrOptions && typeof sortOrOptions === "object") {
          sort = sortOrOptions.sort
          pag = sortOrOptions.pagination
        }
      }

      const errors: ValidationError[] = validate(rule, schema, registry, { maxDepth, sortEnabled }, sort, pag)

      if (errors.length > 0) {
        return { ok: false, errors }
      }

      try {
        const ast = normalize(rule, schema)
        const query = compile(ast, dialect, sort, schema, prefix, pag, registry)
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
