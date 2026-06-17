import type { Dialect, CompileContext } from "./interface.js"
import type { AstNode, Primitive } from "../types.js"
import { escapeLikePosix, compileCommonNode, compileField, compileStandardPagination } from "./utils.js"
import { normalizeDateForDB } from "../utils/date.js"

export const postgresDialect: Dialect = {
  name: "postgres",
  paramStyle: "positional",
  formatParam: (index) => `$${index}`,
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  jsonPathDialect: "postgres",
  transformParam: (value, fieldType) => {
    if (fieldType === "date") {
      return normalizeDateForDB(value, "iso")
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
            return `${col} ILIKE ${p}`
          }
          default:
            throw new Error(`Unsupported operator for like node: ${(node as any).operator}`)
        }
      }

      case "array_op": {
        const isJson = !!(node.jsonPath && node.jsonPath.length > 0)
        const placeholders = node.values
          .map((v, i) => {
            if (typeof v === "object" && v !== null && "type" in v && (v as any).type === "field") {
              return compileField(v as any, ctx.dialect)
            } else {
              const p = ctx.addParam(v as Primitive, `${node.field}_${i}`)
              if (isJson) {
                const sqlCast = typeof v === "number" ? "::numeric"
                  : typeof v === "boolean" ? "::boolean"
                  : "::text"
                return `${p}${sqlCast}`
              }
              return p
            }
          })
          .join(", ")
        if (isJson) {
          if (node.operator === "has_any") {
            return `${col} ?| ARRAY[${placeholders}]`
          } else if (node.operator === "has_all") {
            return `${col} @> jsonb_build_array(${placeholders})`
          } else {
            return `${col} <@ jsonb_build_array(${placeholders})`
          }
        } else {
          if (node.operator === "has_any") {
            return `${col} && ARRAY[${placeholders}]`
          } else if (node.operator === "has_all") {
            return `${col} @> ARRAY[${placeholders}]`
          } else {
            return `${col} <@ ARRAY[${placeholders}]`
          }
        }
      }

      case "json_op": {
        if (node.operator === "json_has_key") {
          const p = ctx.addParam(node.values[0]!, node.field)
          return `(${col} ? ${p})`
        } else {
          const placeholders = node.values.map((v, i) => ctx.addParam(v, `${node.field}_${i}`)).join(", ")
          return `(${col} ?| ARRAY[${placeholders}])`
        }
      }
    }
    throw new Error(`Unsupported AST node type: ${(node as any).type}`)
  },

  compilePagination(limit, offset, addParam) {
    return compileStandardPagination(limit, offset, addParam)
  },
}

export const postgresAnonymousDialect: Dialect = {
  ...postgresDialect,
  name: "postgres-anonymous",
  paramStyle: "anonymous",
  formatParam: () => "?",
}

export const postgresNamedDialect: Dialect = {
  ...postgresDialect,
  name: "postgres-named",
  paramStyle: "named",
  formatParam: (index, name) => `:${name ? `${name}_${index}` : `p${index}`}`,
}
