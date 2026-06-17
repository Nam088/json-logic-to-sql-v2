import type { Dialect, CompileContext } from "./interface.js"
import type { FieldType, AstNode, Primitive } from "../types.js"

/**
 * Builds a base SQL column reference with optional table prefix and proper identifier quoting.
 *
 * This is the shared foundation used by all dialects. The actual identifier quoting
 * is delegated to the dialect's `quoteIdentifier` method so that the correct syntax
 * is applied for each database (e.g. `"col"` for Postgres, `` `col` `` for MySQL).
 *
 * @example
 * // Postgres, no table prefix:
 * buildBaseColumn({ columnName: "email" }, postgresDialect) // → `"email"`
 *
 * // Postgres, with table prefix:
 * buildBaseColumn({ columnName: "name", tableName: "users" }, postgresDialect) // → `"users"."name"`
 */
export function buildBaseColumn(
  n: { columnName: string; tableName?: string; sqlExpression?: string },
  dialect: Dialect
): string {
  if (n.sqlExpression) {
    return n.sqlExpression
  }
  return n.tableName
    ? `${dialect.quoteIdentifier(n.tableName)}.${dialect.quoteIdentifier(n.columnName)}`
    : dialect.quoteIdentifier(n.columnName)
}

/**
 * Escapes LIKE pattern wildcards using backslash escape sequences.
 *
 * Compatible with **PostgreSQL**, **MySQL**, and **SQLite** where `\` is the
 * standard LIKE escape character.
 *
 * Escapes the following characters:
 * - `%` — matches any sequence of characters
 * - `_` — matches any single character
 * - `\` — the escape character itself
 *
 * @example
 * escapeLikePosix("50% off")   // → "50\\% off"
 * escapeLikePosix("file_name") // → "file\\_name"
 */
export function escapeLikePosix(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`)
}

/**
 * Escapes LIKE pattern wildcards using bracket escape syntax.
 *
 * Compatible with **MSSQL / T-SQL** where the standard LIKE escape uses `[x]`
 * bracket notation rather than a backslash character.
 *
 * Escapes the following characters:
 * - `[` — opening bracket (must be escaped first to avoid double-escaping)
 * - `%` — matches any sequence of characters
 * - `_` — matches any single character
 *
 * @example
 * escapeLikeMssql("50% off")   // → "50[%] off"
 * escapeLikeMssql("file_name") // → "file[_]name"
 * escapeLikeMssql("[test]")    // → "[[]test]"
 */
export function escapeLikeMssql(value: string): string {
  return value.replace(/\[/g, "[[]").replace(/%/g, "[%]").replace(/_/g, "[_]")
}

/**
 * Shared type for nodes that carry field metadata used by `compileField`-style helpers.
 * All leaf AST nodes extend this shape.
 */
export type FieldNodeBase = {
  columnName: string
  tableName?: string
  jsonPath?: string[]
  fieldType?: FieldType
  sqlExpression?: string
}

/**
 * Compiles a field reference to SQL, handling table prefixes, JSON path querying, and casting.
 */
export function compileField(
  n: { columnName: string; tableName?: string; jsonPath?: string[]; fieldType?: FieldType; sqlExpression?: string },
  dialect: Dialect
): string {
  const baseCol = buildBaseColumn(n, dialect)

  if (n.jsonPath && n.jsonPath.length > 0) {
    // Prefer explicit jsonPathDialect; fall back to name-prefix inference for backward compat.
    // Custom dialects should set jsonPathDialect to avoid relying on name-prefix conventions.
    const family: "postgres" | "mysql" | "sqlite" | "mssql" | null =
      dialect.jsonPathDialect ??
      (dialect.name.startsWith("postgres") ? "postgres"
        : dialect.name.startsWith("mysql") ? "mysql"
        : dialect.name.startsWith("sqlite") ? "sqlite"
        : dialect.name.startsWith("mssql") ? "mssql"
        : null)

    const colPathBase = (() => {
      if (family === "postgres") {
        let temp = baseCol
        const pathParts = n.jsonPath!.map((part) => `'${part.replace(/'/g, "''")}'`)
        const useArrowOnly = n.fieldType === undefined || n.fieldType === "array"
        const limit = useArrowOnly ? pathParts.length : pathParts.length - 1
        for (let i = 0; i < limit; i++) {
          temp += `->${pathParts[i]}`
        }
        if (!useArrowOnly) {
          temp += `->>${pathParts[pathParts.length - 1]}`
        }
        return temp
      }
      if (family === "mysql") {
        const pathStr = "$." + n.jsonPath!.map((part) => `"${part.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(".")
        return `${baseCol}->>'${pathStr.replace(/'/g, "''")}'`
      }
      if (family === "sqlite") {
        const pathStr = "$." + n.jsonPath!.map((part) => `"${part.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(".")
        return `${baseCol} ->> '${pathStr.replace(/'/g, "''")}'`
      }
      if (family === "mssql") {
        const pathStr = "$." + n.jsonPath!.map((part) => `"${part.replace(/"/g, '""')}"`).join(".")
        const useQuery = n.fieldType === "array" || n.fieldType === undefined
        const funcName = useQuery ? "JSON_QUERY" : "JSON_VALUE"
        return `${funcName}(${baseCol}, '${pathStr.replace(/'/g, "''")}')`
      }
      return baseCol
    })()

    let colPath = colPathBase

    if (n.fieldType) {
      let castType = ""
      switch (family) {
        case "postgres":
          switch (n.fieldType) {
            case "number":  castType = "numeric";    break
            case "boolean": castType = "boolean";    break
            case "date":    castType = "timestamp";  break
            case "uuid":    castType = "uuid";       break
          }
          break
        case "mysql":
          switch (n.fieldType) {
            case "number":  castType = "DECIMAL";  break
            case "boolean": castType = "SIGNED";   break
            case "date":    castType = "DATETIME"; break
            case "uuid":    castType = "CHAR";     break
          }
          break
        case "sqlite":
          switch (n.fieldType) {
            case "number":  castType = "NUMERIC";  break
            case "boolean": castType = "INTEGER";  break
          }
          break
        case "mssql":
          switch (n.fieldType) {
            case "number":  castType = "DECIMAL";          break
            case "boolean": castType = "BIT";              break
            case "date":    castType = "DATETIME2";        break
            case "uuid":    castType = "UNIQUEIDENTIFIER"; break
          }
          break
      }

      if (castType) {
        colPath = `CAST(${colPath} AS ${castType})`
      }
    }
    return colPath
  }
  return baseCol
}

/**
 * Compiles common AST nodes shared across all dialects (and, or, not, comparison, in, between, null_check, custom_op).
 * Returns string if compiled, or null if the node type is dialect-specific.
 */
export function compileCommonNode(
  node: AstNode,
  ctx: CompileContext,
  col: string
): string | null {
  switch (node.type) {
    case "and":
      return `(${node.children.map((c) => ctx.compileNode(c)).join(" AND ")})`
    case "or":
      return `(${node.children.map((c) => ctx.compileNode(c)).join(" OR ")})`
    case "not":
      return `NOT (${ctx.compileNode(node.child)})`

    case "comparison": {
      const op = (node.operator === "==" || node.operator === "===")
        ? "="
        : (node.operator === "!=" || node.operator === "!==")
          ? "!="
          : node.operator
      const val = node.value
      if (typeof val === "object" && val !== null && "type" in val && val.type === "field") {
        const targetCol = compileField(val as any, ctx.dialect)
        return `${col} ${op} ${targetCol}`
      } else {
        const p = ctx.addParam(val as Primitive, node.field, node.fieldType)
        return `${col} ${op} ${p}`
      }
    }

    case "in": {
      const placeholders = node.values
        .map((v, i) => {
          if (typeof v === "object" && v !== null && "type" in v && (v as any).type === "field") {
            return compileField(v as any, ctx.dialect)
          } else {
            return ctx.addParam(v as Primitive, `${node.field}_${i}`, node.fieldType)
          }
        })
        .join(", ")
      return node.negated ? `${col} NOT IN (${placeholders})` : `${col} IN (${placeholders})`
    }

    case "between": {
      const compileBound = (val: typeof node.min, suffix: string) => {
        if (typeof val === "object" && val !== null && "type" in val && (val as any).type === "field") {
          return compileField(val as any, ctx.dialect)
        } else {
          return ctx.addParam(val as Primitive, `${node.field}_${suffix}`, node.fieldType)
        }
      }
      const p1 = compileBound(node.min, "min")
      const p2 = compileBound(node.max, "max")
      return `${col} BETWEEN ${p1} AND ${p2}`
    }

    case "null_check":
      return node.negated ? `${col} IS NOT NULL` : `${col} IS NULL`

    case "custom_op": {
      const opDef = ctx.registry?.get(node.operator)
      if (opDef && opDef.compile) {
        return opDef.compile(ctx, node, col)
      }
      throw new Error(`Custom operator "${node.operator}" does not have a compile function`)
    }

    default:
      return null
  }
}

/**
 * Standard pagination compiler for dialects that support standard LIMIT and OFFSET syntax
 * (e.g. Postgres, MySQL, SQLite).
 */
export function compileStandardPagination(
  limit: number | undefined,
  offset: number | undefined,
  addParam: (value: Primitive, nameHint?: string) => string
): {
  sql: string
  limitSql?: string | undefined
  offsetSql?: string | undefined
} {
  const pLimit = limit !== undefined ? addParam(limit, "limit") : undefined
  const pOffset = offset !== undefined ? addParam(offset, "offset") : undefined
  return {
    sql: [pLimit ? `LIMIT ${pLimit}` : "", pOffset ? `OFFSET ${pOffset}` : ""].filter(Boolean).join(" "),
    limitSql: pLimit ? `LIMIT ${pLimit}` : undefined,
    offsetSql: pOffset ? `OFFSET ${pOffset}` : undefined,
  }
}

