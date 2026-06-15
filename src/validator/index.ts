import type { FieldSchema, ValidationError, JsonLogicNode, SortRule, PaginationRule } from "../types.js"
import type { OperatorRegistry } from "../registry/index.js"
import type { Dialect } from "../dialects/interface.js"
import { validateField } from "./field-validator.js"
import { checkDepth } from "./depth-validator.js"

const LOGICAL_OPS = new Set(["and", "or", "!"])

export type ValidatorOptions = {
  maxDepth: number
  sortEnabled?: boolean
  dialect?: Dialect
}

export function validate(
  node: unknown,
  schema: FieldSchema,
  registry: OperatorRegistry,
  options: ValidatorOptions,
  sort?: SortRule[],
  pagination?: PaginationRule
): ValidationError[] {
  const errors: ValidationError[] = []

  checkDepth(node, options.maxDepth, "", errors)
  if (errors.length > 0) return errors

  traverseAndValidate(node, schema, registry, "", errors, options)

  if (sort && sort.length > 0) {
    if (!options.sortEnabled) {
      errors.push({
        path: "sort",
        message: "Sort is not enabled. Pass sort: true in converter options.",
        code: "SORT_NOT_ENABLED",
      })
    } else {
      validateSort(sort, schema, errors)
    }
  }

  if (pagination) {
    validatePagination(pagination, errors)
  }

  return errors
}

function validatePagination(pagination: PaginationRule, errors: ValidationError[]): void {
  if (typeof pagination.limit !== "number" || pagination.limit < 0 || !Number.isInteger(pagination.limit)) {
    errors.push({
      path: "pagination.limit",
      message: "Limit must be a non-negative integer",
      code: "INVALID_STRUCTURE",
    })
  }
  if (
    pagination.offset !== undefined &&
    (typeof pagination.offset !== "number" || pagination.offset < 0 || !Number.isInteger(pagination.offset))
  ) {
    errors.push({
      path: "pagination.offset",
      message: "Offset must be a non-negative integer",
      code: "INVALID_STRUCTURE",
    })
  }
}

function validateSort(sort: SortRule[], schema: FieldSchema, errors: ValidationError[]): void {
  for (const rule of sort) {
    const fieldDef = schema[rule.field]
    if (!fieldDef) {
      errors.push({
        path: `sort.${rule.field}`,
        field: rule.field,
        message: `Field "${rule.field}" is not allowed`,
        code: "FIELD_NOT_ALLOWED",
      })
      continue
    }
    if (!fieldDef.sortable) {
      errors.push({
        path: `sort.${rule.field}`,
        field: rule.field,
        message: `Field "${rule.field}" is not sortable`,
        code: "SORT_FIELD_NOT_SORTABLE",
      })
    }
    if (rule.direction !== "asc" && rule.direction !== "desc") {
      errors.push({
        path: `sort.${rule.field}`,
        field: rule.field,
        message: `Sort direction must be "asc" or "desc"`,
        code: "INVALID_STRUCTURE",
      })
    }
  }
}

function traverseAndValidate(
  node: unknown,
  schema: FieldSchema,
  registry: OperatorRegistry,
  path: string,
  errors: ValidationError[],
  options: ValidatorOptions
): void {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    errors.push({ path, message: "Expected a JSON Logic object", code: "INVALID_STRUCTURE" })
    return
  }

  const keys = Object.keys(node as object)
  if (keys.length !== 1) {
    errors.push({ path, message: "JSON Logic node must have exactly one key", code: "INVALID_STRUCTURE" })
    return
  }

  const op = keys[0] as string
  const args = (node as JsonLogicNode)[op]

  if (!registry.has(op)) {
    errors.push({ path, operator: op, message: `Unknown operator: "${op}"`, code: "UNKNOWN_OPERATOR" })
    return
  }

  if (op === "!") {
    const child = Array.isArray(args) ? (args as unknown[])[0] : args
    if (child === undefined) {
      errors.push({ path, message: `"!" requires exactly one condition`, code: "INVALID_STRUCTURE" })
      return
    }
    traverseAndValidate(child, schema, registry, `${path}!`, errors, options)
    return
  }

  if (LOGICAL_OPS.has(op)) {
    if (!Array.isArray(args)) {
      errors.push({ path, message: `"${op}" expects an array of conditions`, code: "INVALID_STRUCTURE" })
      return
    }
    if ((args as unknown[]).length === 0) {
      errors.push({ path, message: `"${op}" requires at least one condition`, code: "INVALID_STRUCTURE" })
      return
    }
    ;(args as unknown[]).forEach((child, i) => {
      traverseAndValidate(child, schema, registry, `${path}${op}[${i}]`, errors, options)
    })
    return
  }

  validateField(op, args, schema, registry, path, errors, options)
}
