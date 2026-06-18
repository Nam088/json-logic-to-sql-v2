import type { Dialect, CompileContext } from "./interface.js"
import type { AstNode, Primitive, LeafNodeBase, FieldRefNode } from "../types.js"
import { isFieldRefNode } from "../types.js"
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
            case "contains":     return `${col} LIKE '%' || ${targetCol} || '%'`
            case "not_contains": return `${col} NOT LIKE '%' || ${targetCol} || '%'`
            case "startsWith":   return `${col} LIKE ${targetCol} || '%'`
            case "endsWith":     return `${col} LIKE '%' || ${targetCol}`
            case "like":         return `${col} LIKE ${targetCol}`
            case "ilike":        return `${col} ILIKE ${targetCol}`
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
            return `${col} ILIKE ${p}`
          }
          default:
            throw new Error(`Unsupported operator for like node: ${(node as any).operator}`)
        }
      }

      case "array_op": {
        const isJson = !!(node.jsonPath && node.jsonPath.length > 0)
        const isFieldRef = node.values.length === 1 && isFieldRefNode(node.values[0])

        if (isJson) {
          if (isFieldRef) {
            const targetNode = node.values[0] as FieldRefNode
            const targetCol = compileField(targetNode, ctx.dialect)
            const targetIsArray = targetNode.fieldType === "array"

            if (node.operator === "has_any") {
              if (targetIsArray) {
                const targetIsJson = !!(targetNode.jsonPath && targetNode.jsonPath.length > 0)
                if (targetIsJson) {
                  return `jsonb_exists_any(${col}, ARRAY(SELECT jsonb_array_elements_text(${targetCol})))`
                } else {
                  return `jsonb_exists_any(${col}, ${targetCol})`
                }
              } else {
                return `jsonb_exists(${col}, ${targetCol})`
              }
            } else if (node.operator === "has_all") {
              const targetIsJson = !!(targetNode.jsonPath && targetNode.jsonPath.length > 0)
              if (targetIsJson) {
                return `${col} @> ${targetCol}`
              } else {
                return `${col} @> to_jsonb(${targetCol})`
              }
            } else {
              const targetIsJson = !!(targetNode.jsonPath && targetNode.jsonPath.length > 0)
              if (targetIsJson) {
                return `${col} <@ ${targetCol}`
              } else {
                return `${col} <@ to_jsonb(${targetCol})`
              }
            }
          }
          if (node.operator === "has_any") {
            const isStringLike = (v: any): boolean => {
              if (typeof v === "string") return true
              if (isFieldRefNode(v)) {
                return v.fieldType !== "number" && v.fieldType !== "boolean"
              }
              return false
            }
            const allStrings = node.values.every(isStringLike)
            if (allStrings) {
              const placeholders = node.values
                .map((v, i) => {
                  if (isFieldRefNode(v)) {
                    return compileField(v, ctx.dialect)
                  } else {
                    const p = ctx.addParam(v as Primitive, `${node.field}_${i}`, node.arrayOf)
                    return `${p}::text`
                  }
                })
                .join(", ")
              return `jsonb_exists_any(${col}, ARRAY[${placeholders}])`
            } else {
              const conditions = node.values
                .map((v, i) => {
                  if (isFieldRefNode(v)) {
                    const targetCol = compileField(v, ctx.dialect)
                    return `${col} @> jsonb_build_array(${targetCol})`
                  } else {
                    const p = ctx.addParam(v as Primitive, `${node.field}_${i}`, node.arrayOf)
                    const sqlCast = typeof v === "number" ? "::numeric"
                      : typeof v === "boolean" ? "::boolean"
                      : "::text"
                    return `${col} @> jsonb_build_array(${p}${sqlCast})`
                  }
                })
                .join(" OR ")
              return `(${conditions})`
            }
          } else {
            const placeholders = node.values
              .map((v, i) => {
                if (isFieldRefNode(v)) {
                  return compileField(v, ctx.dialect)
                } else {
                  const p = ctx.addParam(v as Primitive, `${node.field}_${i}`, node.arrayOf)
                  const sqlCast = typeof v === "number" ? "::numeric"
                    : typeof v === "boolean" ? "::boolean"
                    : "::text"
                  return `${p}${sqlCast}`
                }
              })
              .join(", ")
            if (node.operator === "has_all") {
              return `${col} @> jsonb_build_array(${placeholders})`
            } else {
              return `${col} <@ jsonb_build_array(${placeholders})`
            }
          }
        } else {
          if (isFieldRef) {
            const targetNode = node.values[0] as FieldRefNode
            const targetCol = compileField(targetNode, ctx.dialect)
            const targetIsJson = !!(targetNode.jsonPath && targetNode.jsonPath.length > 0)

            if (node.operator === "has_any") {
              if (targetIsJson) {
                return `${col} && ARRAY(SELECT jsonb_array_elements_text(${targetCol}))`
              } else {
                return `${col} && ${targetCol}`
              }
            } else if (node.operator === "has_all") {
              if (targetIsJson) {
                return `${col} @> ARRAY(SELECT jsonb_array_elements_text(${targetCol}))`
              } else {
                return `${col} @> ${targetCol}`
              }
            } else {
              if (targetIsJson) {
                return `${col} <@ ARRAY(SELECT jsonb_array_elements_text(${targetCol}))`
              } else {
                return `${col} <@ ${targetCol}`
              }
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
          return `jsonb_exists(${col}, ${p})`
        } else {
          const placeholders = node.values.map((v, i) => ctx.addParam(v, `${node.field}_${i}`) + "::text").join(", ")
          return `jsonb_exists_any(${col}, ARRAY[${placeholders}])`
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
  formatParam: (index, name) => {
    if (name) {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_")
      return `:${safeName}_${index}`
    }
    return `:p${index}`
  },
}
