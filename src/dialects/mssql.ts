import type { Dialect, CompileContext } from "./interface.js"
import type { AstNode } from "../types.js"
import { escapeLikeMssql, compileCommonNode, compileField } from "./utils.js"
import { normalizeDateForDB } from "../utils/date.js"

export const mssqlDialect: Dialect = {
  name: "mssql",
  paramStyle: "anonymous",
  formatParam: () => "?",
  quoteIdentifier: (name) => `[${name.replace(/]/g, "]]")}]`,
  jsonPathDialect: "mssql",
  transformParam: (value, fieldType) => {
    if (fieldType === "date") {
      return normalizeDateForDB(value, "mssql")
    }
    return value
  },

  compileNode(node: AstNode, ctx: CompileContext): string {
    const col = "columnName" in node ? compileField(node as any, ctx.dialect) : ""

    const commonRes = compileCommonNode(node, ctx, col)
    if (commonRes !== null) {
      return commonRes
    }

    switch (node.type) {
      case "like": {
        switch (node.operator) {
          case "contains": {
            const p = ctx.addParam(`%${escapeLikeMssql(node.value)}%`, node.field)
            return `${col} LIKE ${p}`
          }
          case "not_contains": {
            const p = ctx.addParam(`%${escapeLikeMssql(node.value)}%`, node.field)
            return `${col} NOT LIKE ${p}`
          }
          case "startsWith": {
            const p = ctx.addParam(`${escapeLikeMssql(node.value)}%`, node.field)
            return `${col} LIKE ${p}`
          }
          case "endsWith": {
            const p = ctx.addParam(`%${escapeLikeMssql(node.value)}`, node.field)
            return `${col} LIKE ${p}`
          }
          case "like": {
            const p = ctx.addParam(node.value, node.field)
            return `${col} LIKE ${p}`
          }
          case "ilike": {
            const p = ctx.addParam(node.value, node.field)
            return `LOWER(${col}) LIKE LOWER(${p})`
          }
          default:
            throw new Error(`Unsupported operator for like node: ${(node as any).operator}`)
        }
      }

      case "array_op":
        throw new Error(`Operator "${node.operator}" is not supported by MSSQL dialect`)

      case "json_op": {
        // MSSQL does not allow parameterized expressions inside JSON_VALUE/JSON_QUERY path args.
        // Use OPENJSON which allows WHERE [key] = @param for top-level key existence checks.
        if (node.operator === "json_has_key") {
          const p = ctx.addParam(node.values[0]!, node.field)
          return `EXISTS (SELECT 1 FROM OPENJSON(${col}) WHERE [key] = ${p})`
        } else {
          const conditions = node.values
            .map((v, i) => {
              const p = ctx.addParam(v, `${node.field}_${i}`)
              return `EXISTS (SELECT 1 FROM OPENJSON(${col}) WHERE [key] = ${p})`
            })
            .join(" OR ")
          return `(${conditions})`
        }
      }
    }
    throw new Error(`Unsupported AST node type: ${(node as any).type}`)
  },

  compilePagination(limit, offset, addParam, hasOrderBy) {
    let sql = ""
    let limitSql: string | undefined = undefined
    let offsetSql: string | undefined = undefined

    if (limit !== undefined) {
      const off = offset !== undefined ? addParam(offset, "offset") : "0"
      const lim = addParam(limit, "limit")
      sql = `OFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`
      limitSql = `OFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`
      offsetSql = offset !== undefined ? `OFFSET ${off} ROWS` : undefined
    } else if (offset !== undefined) {
      const off = addParam(offset, "offset")
      sql = `OFFSET ${off} ROWS`
      offsetSql = `OFFSET ${off} ROWS`
    }

    // MSSQL requires ORDER BY before OFFSET. If the caller hasn't supplied one,
    // we inject a no-op ORDER BY into ALL output fields so they stay consistent.
    if (sql && !hasOrderBy) {
      const orderByPrefix = `ORDER BY (SELECT NULL) `
      sql = `${orderByPrefix}${sql}`
      if (limitSql !== undefined) limitSql = `${orderByPrefix}${limitSql}`
      if (offsetSql !== undefined) offsetSql = `${orderByPrefix}${offsetSql}`
    }

    return { sql, limitSql, offsetSql }
  },
}

export const mssqlNamedDialect: Dialect = {
  ...mssqlDialect,
  name: "mssql-named",
  paramStyle: "named",
  formatParam: (index, name) => `@${name ? `${name}_${index}` : `p${index}`}`,
}
