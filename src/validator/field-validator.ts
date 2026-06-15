import type { FieldSchema, ValidationError, Primitive, AllowedValue } from "../types.js"
import type { OperatorRegistry } from "../registry/index.js"

const FORMAT_PATTERNS: Record<string, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // Requires scheme + non-empty host with at least one dot (rejects bare `http://a`)
  url: /^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]+$/,
  // Validates each octet is 0-255; rejects "999.999.999.999"
  ip: /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/,
  alphanumeric: /^[a-zA-Z0-9]+$/,
}

/**
 * Module-level cache for compiled custom regex patterns from schema `constraints.pattern`.
 * Avoids recompiling the same RegExp on every validate() call, which prevents
 * repeated memory allocations and potential ReDoS amplification on hot paths.
 */
const patternCache = new Map<string, RegExp>()
const MAX_PATTERN_CACHE = 500

/**
 * Returns a compiled RegExp for the given pattern string, using the module-level cache.
 * Throws a SyntaxError if the pattern is invalid (caller must wrap in try/catch).
 */
function getOrCompilePattern(pattern: string): RegExp {
  let regex = patternCache.get(pattern)
  if (!regex) {
    if (patternCache.size >= MAX_PATTERN_CACHE) {
      patternCache.clear()
    }
    regex = new RegExp(pattern)
    patternCache.set(pattern, regex)
  }
  return regex
}

export function validateField(
  op: string,
  args: unknown,
  schema: FieldSchema,
  registry: OperatorRegistry,
  path: string,
  errors: ValidationError[]
): void {
  if (!Array.isArray(args) || args.length < 1) {
    errors.push({ path, operator: op, message: `"${op}" expects an array of arguments`, code: "INVALID_STRUCTURE" })
    return
  }

  const varNode = args[0]
  if (!isVarNode(varNode)) {
    errors.push({
      path,
      operator: op,
      message: `First argument of "${op}" must be a { var: "field" } node`,
      code: "INVALID_STRUCTURE",
    })
    return
  }

  const fieldName = varNode.var
  const fieldDef = schema[fieldName]

  if (!fieldDef) {
    errors.push({
      path,
      field: fieldName,
      operator: op,
      message: `Field "${fieldName}" is not allowed`,
      code: "FIELD_NOT_ALLOWED",
    })
    return
  }

  if (!(fieldDef.operators ?? []).includes(op)) {
    const reason = !fieldDef.type
      ? `Field "${fieldName}" is sortable-only and cannot be used in filter expressions`
      : `Operator "${op}" is not allowed on field "${fieldName}"`
    errors.push({ path, field: fieldName, operator: op, message: reason, code: "OPERATOR_NOT_ALLOWED" })
    return
  }

  const opDef = registry.get(op)
  if (opDef && fieldDef.type && !opDef.allowedTypes.includes("any") && !opDef.allowedTypes.includes(fieldDef.type)) {
    errors.push({
      path,
      field: fieldName,
      operator: op,
      message: `Operator "${op}" does not support type "${fieldDef.type}"`,
      code: "OPERATOR_TYPE_MISMATCH",
    })
    return
  }

  if (!fieldDef.type) return

  // Null check operators — verify field is nullable
  if ((op === "is_null" || op === "is_not_null") && fieldDef.nullable === false) {
    errors.push({
      path,
      field: fieldName,
      operator: op,
      message: `Field "${fieldName}" is not nullable`,
      code: "OPERATOR_NOT_ALLOWED",
    })
    return
  }

  // Execute custom operator validation if defined
  if (opDef?.validate) {
    const customArgs = args.slice(1)
    try {
      const res = opDef.validate(customArgs)
      if (res === false) {
        errors.push({
          path,
          field: fieldName,
          operator: op,
          message: `Arguments for custom operator "${op}" failed validation`,
          code: "VALUE_FORMAT_INVALID",
        })
      } else if (typeof res === "string") {
        errors.push({
          path,
          field: fieldName,
          operator: op,
          message: res,
          code: "VALUE_FORMAT_INVALID",
        })
      }
    } catch (err) {
      errors.push({
        path,
        field: fieldName,
        operator: op,
        message: err instanceof Error ? err.message : `Custom validator for "${op}" threw an error`,
        code: "VALUE_FORMAT_INVALID",
      })
    }
  }

  // Validate values for binary/variadic operators
  if (op === "between" && args.length < 3) {
    errors.push({
      path,
      operator: op,
      message: '"between" requires exactly 2 values (min and max)',
      code: "INVALID_STRUCTURE",
    })
    return
  }
  const values = op === "between" ? [args[1], args[2]] : args.slice(1)
  const isVariadic = opDef?.arity === "variadic"
  const checkValues = isVariadic && Array.isArray(args[1]) ? (args[1] as unknown[]) : values

  if (isVariadic && (checkValues as unknown[]).length === 0) {
    errors.push({
      path,
      field: fieldName,
      operator: op,
      message: `"${op}" requires at least one value`,
      code: "INVALID_STRUCTURE",
    })
    return
  }

  if (fieldDef.type === "array") {
    const c = fieldDef.constraints ?? {}
    if (c.minItems !== undefined && checkValues.length < c.minItems) {
      errors.push({
        path,
        field: fieldName,
        message: `Array length ${checkValues.length} is below minimum items ${c.minItems}`,
        code: "VALUE_LENGTH_INVALID",
      })
    }
    if (c.maxItems !== undefined && checkValues.length > c.maxItems) {
      errors.push({
        path,
        field: fieldName,
        message: `Array length ${checkValues.length} exceeds maximum items ${c.maxItems}`,
        code: "VALUE_LENGTH_INVALID",
      })
    }
  }

  for (const val of checkValues) {
    if (isVarNode(val)) {
      const targetFieldName = val.var
      const targetFieldDef = schema[targetFieldName]
      if (!targetFieldDef) {
        errors.push({
          path,
          field: targetFieldName,
          operator: op,
          message: `Field "${targetFieldName}" is not allowed`,
          code: "FIELD_NOT_ALLOWED",
        })
        continue
      }
      if (fieldDef.type && targetFieldDef.type && fieldDef.type !== targetFieldDef.type) {
        errors.push({
          path,
          field: fieldName,
          operator: op,
          message: `Cannot compare field "${fieldName}" (type: ${fieldDef.type}) with field "${targetFieldName}" (type: ${targetFieldDef.type})`,
          code: "OPERATOR_TYPE_MISMATCH",
        })
      }
    } else {
      const valType =
        fieldDef.type === "array" && fieldDef.constraints?.arrayOf ? fieldDef.constraints.arrayOf : fieldDef.type
      validateValue(val, valType, fieldDef.constraints ?? {}, fieldName, op, path, errors)

      if (fieldDef.validate) {
        try {
          const res = fieldDef.validate(val)
          if (res === false) {
            errors.push({
              path,
              field: fieldName,
              operator: op,
              message: `Value "${val}" failed custom validation`,
              code: "VALUE_FORMAT_INVALID",
            })
          } else if (typeof res === "string") {
            errors.push({ path, field: fieldName, operator: op, message: res, code: "VALUE_FORMAT_INVALID" })
          }
        } catch (err) {
          errors.push({
            path,
            field: fieldName,
            operator: op,
            message: err instanceof Error ? err.message : "Custom validation threw an error",
            code: "VALUE_FORMAT_INVALID",
          })
        }
      }
    }
  }
}

function validateValue(
  value: unknown,
  type: string,
  c: {
    allowedValues?: AllowedValue[]
    min?: number | string
    max?: number | string
    minLength?: number
    maxLength?: number
    format?: string
    pattern?: string
  },
  fieldName: string,
  op: string,
  path: string,
  errors: ValidationError[]
): void {
  if (type === "array") return

  const expectedJsType = type === "number" ? "number" : type === "boolean" ? "boolean" : "string"
  const isDateObject = type === "date" && value instanceof Date

  if (typeof value !== expectedJsType && !isDateObject) {
    errors.push({
      path,
      field: fieldName,
      operator: op,
      message: `Value for "${fieldName}" must be of type ${type}`,
      code: "VALUE_TYPE_MISMATCH",
    })
    return
  }

  if (
    c.allowedValues &&
    !c.allowedValues.some(
      (av) =>
        (av !== null && typeof av === "object" && "value" in av
          ? (av as { value: Primitive }).value
          : (av as Primitive)) === (value as Primitive)
    )
  ) {
    errors.push({
      path,
      field: fieldName,
      operator: op,
      message: `Value "${value}" is not allowed for field "${fieldName}"`,
      code: "VALUE_NOT_IN_ALLOWED_VALUES",
    })
    return
  }

  if (type === "number" && typeof value === "number") {
    if (c.min !== undefined && typeof c.min === "number" && value < c.min) {
      errors.push({
        path,
        field: fieldName,
        message: `Value ${value} is below minimum ${c.min}`,
        code: "VALUE_OUT_OF_RANGE",
      })
    }
    if (c.max !== undefined && typeof c.max === "number" && value > c.max) {
      errors.push({
        path,
        field: fieldName,
        message: `Value ${value} exceeds maximum ${c.max}`,
        code: "VALUE_OUT_OF_RANGE",
      })
    }
  }

  if (type === "date") {
    const dateVal = value instanceof Date ? value : new Date(value as string | number)
    if (isNaN(dateVal.getTime())) {
      errors.push({
        path,
        field: fieldName,
        operator: op,
        message: `Value "${value}" is not a valid date`,
        code: "VALUE_TYPE_MISMATCH",
      })
      return
    }
    if (c.min !== undefined) {
      const minDate = new Date(c.min)
      if (!isNaN(minDate.getTime()) && dateVal < minDate) {
        errors.push({
          path,
          field: fieldName,
          message: `Value ${value} is before minimum date ${c.min}`,
          code: "VALUE_OUT_OF_RANGE",
        })
      }
    }
    if (c.max !== undefined) {
      const maxDate = new Date(c.max)
      if (!isNaN(maxDate.getTime()) && dateVal > maxDate) {
        errors.push({
          path,
          field: fieldName,
          message: `Value ${value} exceeds maximum date ${c.max}`,
          code: "VALUE_OUT_OF_RANGE",
        })
      }
    }
  }

  if (type === "uuid" && typeof value === "string") {
    const pattern = FORMAT_PATTERNS.uuid
    if (pattern && !pattern.test(value)) {
      errors.push({
        path,
        field: fieldName,
        message: `Value "${value}" does not match UUID format`,
        code: "VALUE_FORMAT_INVALID",
      })
    }
  }

  if (type === "string" && typeof value === "string") {
    const isStringSearch = ["contains", "not_contains", "startsWith", "endsWith", "like", "ilike"].includes(op)
    if (!isStringSearch && c.minLength !== undefined && value.length < c.minLength) {
      errors.push({
        path,
        field: fieldName,
        message: `Value is shorter than minLength ${c.minLength}`,
        code: "VALUE_LENGTH_INVALID",
      })
    }
    if (c.maxLength !== undefined && value.length > c.maxLength) {
      errors.push({
        path,
        field: fieldName,
        message: `Value exceeds maxLength ${c.maxLength}`,
        code: "VALUE_LENGTH_INVALID",
      })
    }
    if (!isStringSearch && c.format) {
      const pattern = FORMAT_PATTERNS[c.format]
      if (pattern && !pattern.test(value)) {
        errors.push({
          path,
          field: fieldName,
          message: `Value "${value}" does not match format "${c.format}"`,
          code: "VALUE_FORMAT_INVALID",
        })
      }
    }
    if (!isStringSearch && c.pattern) {
      try {
        const regex = getOrCompilePattern(c.pattern)
        if (!regex.test(value)) {
          errors.push({
            path,
            field: fieldName,
            message: `Value "${value}" does not match pattern "${c.pattern}"`,
            code: "VALUE_FORMAT_INVALID",
          })
        }
      } catch (_err) {
        errors.push({
          path,
          field: fieldName,
          message: `Invalid regex pattern in schema: "${c.pattern}"`,
          code: "INVALID_STRUCTURE",
        })
      }
    }
  }
}

function isVarNode(node: unknown): node is { var: string } {
  return (
    typeof node === "object" && node !== null && "var" in node && typeof (node as { var: unknown }).var === "string"
  )
}
