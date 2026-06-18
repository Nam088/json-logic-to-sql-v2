import type { AstNode, FieldSchema, JsonLogicNode, Primitive, FieldType, FieldRefNode, LeafNodeBase, JsonLogicVar } from "../types.js"

function resolveRef(
  fieldName: string,
  schema: FieldSchema
): {
  columnName: string
  tableName?: string
  jsonPath?: string[]
  fieldType?: FieldType
  sqlExpression?: string
  orExpression?: string | string[]
  arrayOf?: FieldType
} {
  const def = schema[fieldName]
  const internalIsRaw = def?.internal?.column && /[\s(:]/.test(def.internal.column)
  const simpleColumn = def?.column && !/[\s(:]/.test(def.column) ? def.column : undefined
  const columnName = (def?.internal?.column && !internalIsRaw ? def.internal.column : undefined) ?? def?.columnName ?? simpleColumn ?? fieldName
  const tablePrefix = def?.internal?.alias ?? def?.internal?.table

  const result: {
    columnName: string
    tableName?: string
    jsonPath?: string[]
    fieldType?: FieldType
    sqlExpression?: string
    orExpression?: string | string[]
    arrayOf?: FieldType
  } = {
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
  if (def?.constraints?.arrayOf !== undefined) {
    result.arrayOf = def.constraints.arrayOf
  }
  if (def?.sqlExpression !== undefined) {
    result.sqlExpression = def.sqlExpression
  } else if (def?.internal?.column !== undefined && internalIsRaw) {
    result.sqlExpression = def.internal.column
  } else if (def?.column !== undefined && /[\s(:]/.test(def.column)) {
    result.sqlExpression = def.column
  }

  if (def?.orExpression !== undefined) {
    result.orExpression = def.orExpression
  } else if (def?.orColumn !== undefined) {
    result.orExpression = def.orColumn
  }
  return result
}

function wrapOrExpression<T extends AstNode>(
  ref: { columnName: string; sqlExpression?: string; orExpression?: string | string[]; tableName?: string },
  createNode: (columnName: string, sqlExpression?: string) => T,
  logicalOp: "and" | "or" = "or"
): AstNode {
  if (ref.orExpression) {
    const exprs = Array.isArray(ref.orExpression) ? ref.orExpression : [ref.orExpression]
    const children = [
      createNode(ref.columnName, ref.sqlExpression)
    ]
    for (const expr of exprs) {
      const isRaw = /[\s(:]/.test(expr)
      const childNode = isRaw ? createNode(expr, expr) : createNode(expr, undefined)
      const leaf = childNode as LeafNodeBase & { columnName?: string }
      if (leaf && "jsonPath" in leaf) {
        delete leaf.jsonPath
      }
      if (!isRaw && expr.includes(".") && leaf) {
        const parts = expr.split(".")
        if (parts.length === 2) {
          leaf.tableName = parts[0]!
          leaf.columnName = parts[1]!
        }
      }
      children.push(childNode)
    }
    return {
      type: logicalOp,
      children,
    }
  }
  return createNode(ref.columnName, ref.sqlExpression)
}

function extractRawValues(args: unknown[]): unknown[] {
  const values = args[1]
  return Array.isArray(values) ? (values as unknown[]) : (args.slice(1) as unknown[])
}

function isVarNode(node: unknown): node is { var: string } {
  return (
    typeof node === "object" &&
    node !== null &&
    "var" in node &&
    typeof (node as { var: unknown }).var === "string"
  )
}

function normalizeValues(values: unknown[], schema: FieldSchema): (Primitive | FieldRefNode)[] {
  return values.map((val) => {
    if (isVarNode(val)) {
      const targetFieldName = val.var
      const ref = resolveRef(targetFieldName, schema)
      return {
        type: "field",
        field: targetFieldName,
        ...ref,
      } as FieldRefNode
    }
    return val as Primitive
  })
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
      const [varNode, rightVal] = args as [JsonLogicVar, unknown]
      const fieldName = varNode.var

      let value: Primitive | FieldRefNode
      if (isVarNode(rightVal)) {
        const targetFieldName = rightVal.var
        const ref = resolveRef(targetFieldName, schema)
        value = {
          type: "field",
          field: targetFieldName,
          ...ref,
        }
      } else {
        value = rightVal as Primitive
      }

      const ref = resolveRef(fieldName, schema)
      const isNegated = op === "!=" || op === "!=="
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "comparison",
        operator: op as "==" | "===" | "!=" | "!==" | ">" | ">=" | "<" | "<=",
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        value,
      }), isNegated ? "and" : "or")
    }

    case "in":
    case "not_in": {
      const [varNode] = args as [{ var: string }]
      const fieldName = varNode.var
      const ref = resolveRef(fieldName, schema)
      const isNegated = op === "not_in"
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "in",
        negated: isNegated,
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        values: normalizeValues(extractRawValues(args as unknown[]), schema),
      }), isNegated ? "and" : "or")
    }

    case "between": {
      const [varNode, minVal, maxVal] = args as [{ var: string }, unknown, unknown]
      const fieldName = varNode.var

      const normalizeVal = (v: unknown): Primitive | FieldRefNode => {
        if (isVarNode(v)) {
          const targetFieldName = v.var
          const ref = resolveRef(targetFieldName, schema)
          return {
            type: "field",
            field: targetFieldName,
            ...ref,
          } as FieldRefNode
        }
        return v as Primitive
      }

      const ref = resolveRef(fieldName, schema)
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "between",
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        min: normalizeVal(minVal),
        max: normalizeVal(maxVal),
      }))
    }

    case "contains":
    case "not_contains":
    case "startsWith":
    case "endsWith":
    case "like":
    case "ilike": {
      const [varNode, rightVal] = args as [JsonLogicVar, unknown]
      const fieldName = varNode.var

      let value: Primitive | FieldRefNode
      if (isVarNode(rightVal)) {
        const targetFieldName = rightVal.var
        const ref = resolveRef(targetFieldName, schema)
        value = {
          type: "field",
          field: targetFieldName,
          ...ref,
        }
      } else {
        value = rightVal as Primitive
      }

      const ref = resolveRef(fieldName, schema)
      const isNegated = op === "not_contains"
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "like",
        operator: op as "contains" | "not_contains" | "startsWith" | "endsWith" | "like" | "ilike",
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        value: value as string | FieldRefNode,
      }), isNegated ? "and" : "or")
    }

    case "is_null":
    case "is_not_null": {
      const varNode = Array.isArray(args) ? (args as unknown[])[0] : args
      const fieldName = (varNode as { var: string }).var
      const ref = resolveRef(fieldName, schema)
      const isNegated = op === "is_not_null"
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "null_check",
        negated: isNegated,
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
      }), isNegated ? "or" : "and")
    }

    case "has_any":
    case "has_all":
    case "contained_by": {
      const [varNode] = args as [{ var: string }]
      const fieldName = varNode.var
      const ref = resolveRef(fieldName, schema)
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "array_op",
        operator: op as "has_any" | "has_all" | "contained_by",
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        values: normalizeValues(extractRawValues(args as unknown[]), schema),
      }))
    }

    case "json_has_key": {
      const [varNode, value] = args as [{ var: string }, Primitive]
      const fieldName = varNode.var
      const ref = resolveRef(fieldName, schema)
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "json_op",
        operator: "json_has_key",
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        values: [value],
      }))
    }

    case "json_has_any_keys": {
      const [varNode] = args as [{ var: string }]
      const fieldName = varNode.var
      const ref = resolveRef(fieldName, schema)
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "json_op",
        operator: "json_has_any_keys",
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        values: extractRawValues(args as unknown[]) as Primitive[],
      }))
    }

    default: {
      if (!Array.isArray(args) || args.length < 1) {
        throw new Error(`Operator "${op}" requires at least one argument`)
      }
      const varNode = args[0]
      if (
        typeof varNode !== "object" ||
        varNode === null ||
        !("var" in varNode) ||
        typeof (varNode as { var: unknown }).var !== "string"
      ) {
        throw new Error(`First argument of "${op}" must be a { var: "field" } node`)
      }
      const fieldName = (varNode as { var: string }).var
      const values = args.slice(1)
      const ref = resolveRef(fieldName, schema)
      return wrapOrExpression(ref, (columnName, sqlExpression) => ({
        type: "custom_op",
        operator: op,
        field: fieldName,
        ...ref,
        columnName,
        sqlExpression,
        orExpression: undefined,
        values,
      }))
    }
  }
}
