import type { FieldSchema, FieldDef, InternalConfig } from "../types.js"

/**
 * Recursively flattens a hierarchical/nested FieldSchema into a flat FieldSchema.
 * For example, a schema with:
 * {
 *   user: {
 *     columnName: "user_data",
 *     properties: {
 *       profile: {
 *         properties: {
 *           age: { type: "number", operators: [">"] }
 *         }
 *       }
 *     }
 *   }
 * }
 * will be flattened to:
 * {
 *   "user.profile.age": {
 *     type: "number",
 *     operators: [">"],
 *     columnName: "user_data",
 *     jsonPath: ["profile", "age"]
 *   }
 * }
 */
export function flattenSchema(schema: FieldSchema): FieldSchema {
  const flat: FieldSchema = {}

  function traverse(
    properties: Record<string, FieldDef>,
    parentLogicalPath: string,
    columnName: string,
    jsonPathPrefix: string[],
    parentInternal?: InternalConfig
  ) {
    if (!properties || typeof properties !== "object") return
    for (const [key, def] of Object.entries(properties)) {
      if (!def || typeof def !== "object") continue
      const logicalPath = `${parentLogicalPath}.${key}`
      const customCol = def.columnName || def.column || def.internal?.column
      const activeCol = customCol || columnName
      const activeJsonPath = customCol
        ? (def.jsonPath || [])
        : [...jsonPathPrefix, ...(def.jsonPath || [key])]

      const childInternal: InternalConfig = {
        ...parentInternal,
        ...def.internal,
      }

      if (def.constraints?.pattern !== undefined) {
        try {
          new RegExp(def.constraints.pattern)
        } catch (err) {
          throw new Error(`Invalid regex pattern in schema for field "${logicalPath}": ${err instanceof Error ? err.message : String(err)}`, { cause: err })
        }
      }

      if (def.properties) {
        if (def.operators) {
          const flatDef: FieldDef = {
            ...def,
            columnName: activeCol,
            jsonPath: activeJsonPath,
          }
          if (Object.keys(childInternal).length > 0) {
            flatDef.internal = childInternal
          }
          flat[logicalPath] = flatDef
        }
        traverse(def.properties, logicalPath, activeCol, activeJsonPath, childInternal)
      } else {
        const flatDef: FieldDef = {
          ...def,
          columnName: activeCol,
          jsonPath: activeJsonPath,
        }
        if (Object.keys(childInternal).length > 0) {
          flatDef.internal = childInternal
        }
        flat[logicalPath] = flatDef
      }
    }
  }

  for (const [key, def] of Object.entries(schema)) {
    if (!def || typeof def !== "object") continue
    if (def.constraints?.pattern !== undefined) {
      try {
        new RegExp(def.constraints.pattern)
      } catch (err) {
        throw new Error(`Invalid regex pattern in schema for field "${key}": ${err instanceof Error ? err.message : String(err)}`, { cause: err })
      }
    }
    if (def.properties) {
      const columnName = def.columnName || def.column || def.internal?.column || key
      const jsonPathPrefix = def.jsonPath || []
      const parentInternal: InternalConfig = {}
      if (def.internal?.table) parentInternal.table = def.internal.table
      if (def.internal?.alias) parentInternal.alias = def.internal.alias

      if (def.operators) {
        const flatDef: FieldDef = {
          ...def,
          columnName,
        }
        if (def.jsonPath !== undefined) {
          flatDef.jsonPath = def.jsonPath
        }
        flat[key] = flatDef
      }
      traverse(def.properties, key, columnName, jsonPathPrefix, parentInternal)
    } else {
      flat[key] = def
    }
  }

  return flat
}
