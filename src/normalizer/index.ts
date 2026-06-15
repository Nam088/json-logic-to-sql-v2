import type { AstNode, FieldSchema, JsonLogicNode, Primitive, FieldType } from "../types.js"

function resolveRef(
  fieldName: string,
  schema: FieldSchema
): { columnName: string; tableName?: string; jsonPath?: string[]; fieldType?: FieldType } {
  const def = schema[fieldName]
  const columnName = def?.internal?.column ?? def?.columnName ?? fieldName
  const tablePrefix = def?.internal?.alias ?? def?.internal?.table

  const result: { columnName: string; tableName?: string; jsonPath?: string[]; fieldType?: FieldType } = {
    columnName,
  }
  if (tablePrefix !== undefined) {
    result.tableName = tablePrefix
  }
  if (def?.jsonPath !== undefined) {
    result.jsonPath = def.jsonPath
  }
  if (def?.type !== undefined) {
    result.fieldType = def.type
  }
  return result
}

function extractValues(args: unknown[]): Primitive[] {
  const values = args[1]
  return Array.isArray(values) ? (values as Primitive[]) : (args.slice(1) as Primitive[])
}

export function normalize(node: unknown, schema: FieldSchema): AstNode {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new Error("Invalid JSON Logic node")
  }

  const op = Object.keys(node as object)[0] as string
  const args = (node as JsonLogicNode)[op]

  switch (op) {
    case "and":
      return { type: "and", children: (args as unknown[]).map((c) => normalize(c, schema)) }
    case "or":
      return { type: "or", children: (args as unknown[]).map((c) => normalize(c, schema)) }
    case "!":
      return { type: "not", child: normalize(Array.isArray(args) ? (args as unknown[])[0] : args, schema) }

    case "==":
    case "===":
    case "!=":
    case "!==":
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const [varNode, rightVal] = (args as any) as [{ var: string }, unknown]
      const fieldName = varNode.var

      let value: Primitive | import("../types.js").FieldRefNode
      if (
        typeof rightVal === "object" &&
        rightVal !== null &&
        "var" in rightVal &&
        typeof (rightVal as any).var === "string"
      ) {
        const targetFieldName = (rightVal as { var: string }).var
        const ref = resolveRef(targetFieldName, schema)
        value = {
          type: "field",
          field: targetFieldName,
          columnName: ref.columnName,
          tableName: ref.tableName,
        }
      } else {
        value = rightVal as Primitive
      }

      return {
        type: "comparison",
        operator: op as "==" | "===" | "!=" | "!==" | ">" | ">=" | "<" | "<=",
        field: fieldName,
        ...resolveRef(fieldName, schema),
        value,
      }
    }

    case "in":
    case "not_in": {
      const [varNode] = args as [{ var: string }]
      const fieldName = varNode.var
      return {
        type: "in",
        negated: op === "not_in",
        field: fieldName,
        ...resolveRef(fieldName, schema),
        values: extractValues(args as unknown[]),
      }
    }

    case "between": {
      const [varNode, min, max] = args as [{ var: string }, Primitive, Primitive]
      const fieldName = varNode.var
      return { type: "between", field: fieldName, ...resolveRef(fieldName, schema), min, max }
    }

    case "contains":
    case "not_contains":
    case "startsWith":
    case "endsWith":
    case "like":
    case "ilike": {
      const [varNode, value] = args as [{ var: string }, string]
      const fieldName = varNode.var
      return {
        type: "like",
        operator: op as "contains" | "not_contains" | "startsWith" | "endsWith" | "like" | "ilike",
        field: fieldName,
        ...resolveRef(fieldName, schema),
        value,
      }
    }

    case "is_null":
    case "is_not_null": {
      const varNode = Array.isArray(args) ? (args as unknown[])[0] : args
      const fieldName = (varNode as { var: string }).var
      return { type: "null_check", negated: op === "is_not_null", field: fieldName, ...resolveRef(fieldName, schema) }
    }

    case "has_any":
    case "has_all":
    case "contained_by": {
      const [varNode] = args as [{ var: string }]
      const fieldName = varNode.var
      return {
        type: "array_op",
        operator: op as "has_any" | "has_all" | "contained_by",
        field: fieldName,
        ...resolveRef(fieldName, schema),
        values: extractValues(args as unknown[]),
      }
    }

    case "json_has_key": {
      const [varNode, value] = args as [{ var: string }, Primitive]
      const fieldName = varNode.var
      return {
        type: "json_op",
        operator: "json_has_key",
        field: fieldName,
        ...resolveRef(fieldName, schema),
        values: [value],
      }
    }

    case "json_has_any_keys": {
      const [varNode] = args as [{ var: string }]
      const fieldName = varNode.var
      return {
        type: "json_op",
        operator: "json_has_any_keys",
        field: fieldName,
        ...resolveRef(fieldName, schema),
        values: extractValues(args as unknown[]),
      }
    }

    default: {
      const [varNode] = args as [{ var: string }]
      const fieldName = varNode.var
      const values = Array.isArray(args) ? args.slice(1) : []
      return {
        type: "custom_op",
        operator: op,
        field: fieldName,
        ...resolveRef(fieldName, schema),
        values,
      }
    }
  }
}
