import type { Dialect, CompileContext } from "./interface.js"
import type { AstNode } from "../types.js"
import { escapeLikePosix, compileCommonNode, compileField } from "./utils.js"

export const sqliteDialect: Dialect = {
  name: "sqlite",
  paramStyle: "anonymous",
  formatParam: () => "?",
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  transformParam: (value) => {
    if (typeof value === "boolean") {
      return value ? 1 : 0
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
            const p = ctx.addParam(`%${escapeLikePosix(node.value)}%`, node.field)
            return `${col} LIKE ${p}`
          }
          case "not_contains": {
            const p = ctx.addParam(`%${escapeLikePosix(node.value)}%`, node.field)
            return `${col} NOT LIKE ${p}`
          }
          case "startsWith": {
            const p = ctx.addParam(`${escapeLikePosix(node.value)}%`, node.field)
            return `${col} LIKE ${p}`
          }
          case "endsWith": {
            const p = ctx.addParam(`%${escapeLikePosix(node.value)}`, node.field)
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
        throw new Error(`Operator "${node.operator}" is not supported by SQLite dialect`)

      case "json_op": {
        if (node.operator === "json_has_key") {
          const p = ctx.addParam(node.values[0]!, node.field)
          return `json_type(${col}, '$."' || replace(${p}, '"', '\\"') || '"') IS NOT NULL`
        } else {
          const paths = node.values
            .map((v, i) => {
              const p = ctx.addParam(v, `${node.field}_${i}`)
              return `json_type(${col}, '$."' || replace(${p}, '"', '\\"') || '"') IS NOT NULL`
            })
            .join(" OR ")
          return `(${paths})`
        }
      }
    }
    throw new Error(`Unsupported AST node type: ${(node as any).type}`)
  },

  compilePagination(limit, offset, addParam) {
    const pLimit = limit !== undefined ? addParam(limit, "limit") : undefined
    const pOffset = offset !== undefined ? addParam(offset, "offset") : undefined
    return {
      sql: [pLimit ? `LIMIT ${pLimit}` : "", pOffset ? `OFFSET ${pOffset}` : ""].filter(Boolean).join(" "),
      limitSql: pLimit ? `LIMIT ${pLimit}` : undefined,
      offsetSql: pOffset ? `OFFSET ${pOffset}` : undefined,
    }
  },
}

export const sqliteNamedDialect: Dialect = {
  ...sqliteDialect,
  name: "sqlite-named",
  paramStyle: "named",
  formatParam: (index, name) => `:${name ? `${name}_${index}` : `p${index}`}`,
}
