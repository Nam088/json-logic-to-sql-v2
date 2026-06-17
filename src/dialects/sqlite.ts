import type { Dialect, CompileContext } from "./interface.js"
import type { AstNode, Primitive } from "../types.js"
import { escapeLikePosix, compileCommonNode, compileField, compileStandardPagination } from "./utils.js"
import { normalizeDateForDB } from "../utils/date.js"

export const sqliteDialect: Dialect = {
  name: "sqlite",
  paramStyle: "anonymous",
  supportsArrayOps: true,
  formatParam: () => "?",
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  jsonPathDialect: "sqlite",
  transformParam: (value, fieldType) => {
    if (typeof value === "boolean") {
      return value ? 1 : 0
    }
    if (fieldType === "date") {
      return normalizeDateForDB(value, "iso")
    }
    return value
  },


  compileNode(node: AstNode, ctx: CompileContext): string {
    const col = "columnName" in node ? compileField(node as any, ctx.dialect, { skipCast: node.type === "null_check" }) : ""

    const commonRes = compileCommonNode(node, ctx, col)
    if (commonRes !== null) {
      return commonRes
    }

    switch (node.type) {
      case "like": {
        const isField = typeof node.value === "object" && node.value !== null && (node.value as any).type === "field"
        if (isField) {
          const targetCol = compileField(node.value as any, ctx.dialect)
          switch (node.operator) {
            case "contains":     return `${col} LIKE '%' || ${targetCol} || '%' ESCAPE '\\'`
            case "not_contains": return `${col} NOT LIKE '%' || ${targetCol} || '%' ESCAPE '\\'`
            case "startsWith":   return `${col} LIKE ${targetCol} || '%' ESCAPE '\\'`
            case "endsWith":     return `${col} LIKE '%' || ${targetCol} ESCAPE '\\'`
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
            return `${col} LIKE ${p} ESCAPE '\\'`
          }
          case "not_contains": {
            const p = ctx.addParam(`%${escapeLikePosix(strVal)}%`, node.field)
            return `${col} NOT LIKE ${p} ESCAPE '\\'`
          }
          case "startsWith": {
            const p = ctx.addParam(`${escapeLikePosix(strVal)}%`, node.field)
            return `${col} LIKE ${p} ESCAPE '\\'`
          }
          case "endsWith": {
            const p = ctx.addParam(`%${escapeLikePosix(strVal)}`, node.field)
            return `${col} LIKE ${p} ESCAPE '\\'`
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
        const isFieldRef = node.values.length === 1 &&
          typeof node.values[0] === "object" &&
          node.values[0] !== null &&
          "type" in node.values[0] &&
          (node.values[0] as any).type === "field";

        if (isFieldRef) {
          const targetCol = compileField(node.values[0] as any, ctx.dialect)
          if (node.operator === "has_any") {
            return `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value IN (SELECT value FROM json_each(${targetCol})))`
          } else if (node.operator === "has_all") {
            return `NOT EXISTS (SELECT value FROM json_each(${targetCol}) WHERE value NOT IN (SELECT value FROM json_each(${col})))`
          } else {
            return `NOT EXISTS (SELECT 1 FROM json_each(${col}) WHERE value NOT IN (SELECT value FROM json_each(${targetCol})))`
          }
        }

        const placeholders = node.values
          .map((v, i) => {
            if (typeof v === "object" && v !== null && "type" in v && (v as any).type === "field") {
              return compileField(v as any, ctx.dialect)
            } else {
              return ctx.addParam(v as Primitive, `${node.field}_${i}`, node.arrayOf)
            }
          })
          .join(", ")

        if (node.operator === "has_any") {
          return `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value IN (${placeholders}))`
        } else if (node.operator === "contained_by") {
          return `NOT EXISTS (SELECT 1 FROM json_each(${col}) WHERE value NOT IN (${placeholders}))`
        } else {
          return `NOT EXISTS (SELECT value FROM json_each(json_array(${placeholders})) WHERE value NOT IN (SELECT value FROM json_each(${col})))`
        }
      }

      case "json_op": {
        if (node.operator === "json_has_key") {
          const p = ctx.addParam(node.values[0]!, node.field)
          return `json_type(${col}, '$."' || replace(replace(${p}, '\\\\', '\\\\\\\\'), '"', '\\\\"') || '"') IS NOT NULL`
        } else {
          const paths = node.values
            .map((v, i) => {
              const p = ctx.addParam(v, `${node.field}_${i}`)
              return `json_type(${col}, '$."' || replace(replace(${p}, '\\\\', '\\\\\\\\'), '"', '\\\\"') || '"') IS NOT NULL`
            })
            .join(" OR ")
          return `(${paths})`
        }
      }
    }
    throw new Error(`Unsupported AST node type: ${(node as any).type}`)
  },

  compilePagination(limit, offset, addParam) {
    return compileStandardPagination(limit, offset, addParam)
  },
}

export const sqliteNamedDialect: Dialect = {
  ...sqliteDialect,
  name: "sqlite-named",
  paramStyle: "named",
  formatParam: (index, name) => {
    if (name) {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_")
      return `:${safeName}_${index}`
    }
    return `:p${index}`
  },
}
