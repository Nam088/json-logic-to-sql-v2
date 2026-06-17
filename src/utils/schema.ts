import type { FieldSchema, FieldDef } from "../types.js"

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
    jsonPathPrefix: string[]
  ) {
    for (const [key, def] of Object.entries(properties)) {
      const logicalPath = `${parentLogicalPath}.${key}`
      const customCol = def.columnName || def.column || def.internal?.column
      const activeCol = customCol || columnName
      const activeJsonPath = customCol
        ? (def.jsonPath || [])
        : [...jsonPathPrefix, ...(def.jsonPath || [key])]

      if (def.properties) {
        if (def.operators) {
          flat[logicalPath] = {
            ...def,
            columnName: activeCol,
            jsonPath: activeJsonPath,
          }
        }
        traverse(def.properties, logicalPath, activeCol, activeJsonPath)
      } else {
        flat[logicalPath] = {
          ...def,
          columnName: activeCol,
          jsonPath: activeJsonPath,
        }
      }
    }
  }

  for (const [key, def] of Object.entries(schema)) {
    if (def.properties) {
      const columnName = def.columnName || def.column || def.internal?.column || key
      const jsonPathPrefix = def.jsonPath || []
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
      traverse(def.properties, key, columnName, jsonPathPrefix)
    } else {
      flat[key] = def
    }
  }

  return flat
}
