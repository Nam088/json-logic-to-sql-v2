import type { Dialect, CompileContext } from "./interface.js"
import type { AstNode, Primitive, LeafNodeBase, FieldRefNode } from "../types.js"
import { isFieldRefNode } from "../types.js"
import { escapeLikePosix, compileCommonNode, compileField, compileStandardPagination } from "./utils.js"
import { normalizeDateForDB } from "../utils/date.js"

/**
 * Dialect for MySQL.
 * NOTE: Array operations like "has_any" compile to `JSON_OVERLAPS` which requires MySQL 8.0.17+.
 */
export const mysqlDialect: Dialect = {
  name: "mysql",
  paramStyle: "anonymous",
  formatParam: () => "?",
  quoteIdentifier: (name) => `\`${name.replace(/`/g, "``")}\``,
  jsonPathDialect: "mysql",
  transformParam: (value, fieldType) => {
    if (fieldType === "date") {
      return normalizeDateForDB(value, "mysql")
    }
    return value
  },

  compileNode(node: AstNode, ctx: CompileContext): string {
    const col = "columnName" in node ? compileField(node as LeafNodeBase & { columnName: string }, ctx.dialect, { skipCast: node.type === "null_check" }) : ""

    const commonRes = compileCommonNode(node, ctx, col)
    if (commonRes !== null) {
      return commonRes
    }

    switch (node.type) {
      case "like": {
        const isField = isFieldRefNode(node.value)
        if (isField) {
          const targetCol = compileField(node.value as FieldRefNode, ctx.dialect)
          switch (node.operator) {
            case "contains":     return `${col} LIKE CONCAT('%', ${targetCol}, '%')`
            case "not_contains": return `${col} NOT LIKE CONCAT('%', ${targetCol}, '%')`
            case "startsWith":   return `${col} LIKE CONCAT(${targetCol}, '%')`
            case "endsWith":     return `${col} LIKE CONCAT('%', ${targetCol})`
            case "like":         return `${col} LIKE ${targetCol}`
            case "ilike":        return `LOWER(${col}) LIKE LOWER(${targetCol})`
            default:
              throw new Error(`Unsupported operator for like node: ${(node as any).operator}`)
          }
        }

        const strVal = node.value as string
        switch (node.operator) {
          case "contains": {
            const p = ctx.addParam(`%${escapeLikePosix(strVal)}%`, node.field)
            return `${col} LIKE ${p}`
          }
          case "not_contains": {
            const p = ctx.addParam(`%${escapeLikePosix(strVal)}%`, node.field)
            return `${col} NOT LIKE ${p}`
          }
          case "startsWith": {
            const p = ctx.addParam(`${escapeLikePosix(strVal)}%`, node.field)
            return `${col} LIKE ${p}`
          }
          case "endsWith": {
            const p = ctx.addParam(`%${escapeLikePosix(strVal)}`, node.field)
            return `${col} LIKE ${p}`
          }
          case "like": {
            const p = ctx.addParam(strVal, node.field)
            return `${col} LIKE ${p}`
          }
          case "ilike": {
            const p = ctx.addParam(strVal, node.field)
            return `LOWER(${col}) LIKE LOWER(${p})`
          }
          default:
            throw new Error(`Unsupported operator for like node: ${(node as any).operator}`)
        }
      }

      case "array_op": {
        const isFieldRef = node.values.length === 1 && isFieldRefNode(node.values[0])

        if (isFieldRef) {
          const targetCol = compileField(node.values[0] as FieldRefNode, ctx.dialect)
          if (node.operator === "has_any") {
            return `JSON_OVERLAPS(${col}, ${targetCol})`
          } else if (node.operator === "has_all") {
            return `JSON_CONTAINS(${col}, ${targetCol})`
          } else {
            return `JSON_CONTAINS(${targetCol}, ${col})`
          }
        }

        const placeholders = node.values
          .map((v, i) => {
            if (isFieldRefNode(v)) {
              return compileField(v, ctx.dialect)
            } else {
              return ctx.addParam(v as Primitive, `${node.field}_${i}`, node.arrayOf)
            }
          })
          .join(", ")
        if (node.operator === "has_any") {
          return `JSON_OVERLAPS(${col}, JSON_ARRAY(${placeholders}))`
        } else if (node.operator === "has_all") {
          return `JSON_CONTAINS(${col}, JSON_ARRAY(${placeholders}))`
        } else {
          return `JSON_CONTAINS(JSON_ARRAY(${placeholders}), ${col})`
        }
      }

      case "json_op": {
        if (node.operator === "json_has_key") {
          const p = ctx.addParam(node.values[0]!, node.field)
          return `JSON_CONTAINS_PATH(${col}, 'one', CONCAT('$."', REPLACE(REPLACE(${p}, '\\\\', '\\\\\\\\'), '"', '\\\\"'), '"'))`
        } else {
          const paths = node.values
            .map((v, i) => {
              const p = ctx.addParam(v, `${node.field}_${i}`)
              return `CONCAT('$."', REPLACE(REPLACE(${p}, '\\\\', '\\\\\\\\'), '"', '\\\\"'), '"')`
            })
            .join(", ")
          return `JSON_CONTAINS_PATH(${col}, 'one', ${paths})`
        }
      }
    }
    throw new Error(`Unsupported AST node type: ${(node as any).type}`)
  },

  compilePagination(limit, offset, addParam) {
    return compileStandardPagination(limit, offset, addParam)
  },
}

export const mysqlNamedDialect: Dialect = {
  ...mysqlDialect,
  name: "mysql-named",
  paramStyle: "named",
  formatParam: (index, name) => {
    if (name) {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_")
      return `:${safeName}_${index}`
    }
    return `:p${index}`
  },
}
