import type { FieldType, CustomOpNode } from "../types.js"
import type { CompileContext } from "../dialects/interface.js"

export type OperatorArity = "unary" | "binary" | "variadic"

/**
 * Definition of a built-in or custom operator used during validation and compilation.
 */
export type OperatorDef = {
  /** Field types this operator is compatible with. Use `"any"` to allow all types. */
  allowedTypes: (FieldType | "any")[]
  /** Arity of the operator: `"unary"` (no value), `"binary"` (one value), `"variadic"` (one or more values). */
  arity: OperatorArity
  /** Minimum number of arguments expected by the operator (inclusive). */
  minArity?: number
  /** Maximum number of arguments expected by the operator (inclusive). */
  maxArity?: number
  /** Custom SQL compilation function. Called during the compile phase to produce a SQL fragment.
   * Must use `ctx.addParam()` to safely parameterize values — never interpolate raw values. */
  compile?: (ctx: CompileContext, node: CustomOpNode, col: string) => string
  /** Custom validation function. Called during the validation phase.
   * Return `true` to pass, `false` for a generic failure, or a string for a custom error message. */
  validate?: (args: unknown[]) => boolean | string
}

const builtIn: Record<string, OperatorDef> = {
  "==": { allowedTypes: ["string", "number", "boolean", "date", "uuid"], arity: "binary" },
  "===": { allowedTypes: ["string", "number", "boolean", "date", "uuid"], arity: "binary" },
  "!=": { allowedTypes: ["string", "number", "boolean", "date", "uuid"], arity: "binary" },
  "!==": { allowedTypes: ["string", "number", "boolean", "date", "uuid"], arity: "binary" },
  ">": { allowedTypes: ["number", "date"], arity: "binary" },
  ">=": { allowedTypes: ["number", "date"], arity: "binary" },
  "<": { allowedTypes: ["number", "date"], arity: "binary" },
  "<=": { allowedTypes: ["number", "date"], arity: "binary" },
  between: { allowedTypes: ["number", "date"], arity: "binary" },
  in: { allowedTypes: ["string", "number", "boolean", "date", "uuid"], arity: "variadic" },
  not_in: { allowedTypes: ["string", "number", "boolean", "date", "uuid"], arity: "variadic" },
  contains: { allowedTypes: ["string"], arity: "binary" },
  not_contains: { allowedTypes: ["string"], arity: "binary" },
  startsWith: { allowedTypes: ["string"], arity: "binary" },
  endsWith: { allowedTypes: ["string"], arity: "binary" },
  like: { allowedTypes: ["string"], arity: "binary" },
  ilike: { allowedTypes: ["string"], arity: "binary" },
  is_null: { allowedTypes: ["any"], arity: "unary" },
  is_not_null: { allowedTypes: ["any"], arity: "unary" },
  has_any: { allowedTypes: ["array"], arity: "variadic" },
  has_all: { allowedTypes: ["array"], arity: "variadic" },
  contained_by: { allowedTypes: ["array"], arity: "variadic" },
  json_has_key: {
    allowedTypes: ["any", "array"],
    arity: "binary",
    validate: (args) => {
      const val = args[0]
      if (typeof val !== "string") {
        return "Key name must be a string"
      }
      if (val.includes('"')) {
        return "Key name cannot contain double quotes"
      }
      return true
    },
  },
  json_has_any_keys: {
    allowedTypes: ["any", "array"],
    arity: "variadic",
    validate: (args) => {
      const keys = Array.isArray(args[0]) ? args[0] : args
      if (keys.length === 0) {
        return "json_has_any_keys requires at least one key"
      }
      for (const k of keys) {
        if (typeof k !== "string") {
          return "All keys must be strings"
        }
        if (k.includes('"')) {
          return "Keys cannot contain double quotes"
        }
      }
      return true
    },
  },
  and: { allowedTypes: ["any"], arity: "variadic" },
  or: { allowedTypes: ["any"], arity: "variadic" },
  "!": { allowedTypes: ["any"], arity: "unary" },
}

/**
 * Registry that holds all operator definitions (built-in and custom).
 * Used during both the validation and compilation phases.
 */
export class OperatorRegistry {
  private operators: Map<string, OperatorDef>

  constructor(custom: Record<string, OperatorDef> = {}) {
    for (const name of Object.keys(custom)) {
      if (Object.prototype.hasOwnProperty.call(builtIn, name)) {
        throw new Error(
          `Cannot register custom operator "${name}": it conflicts with a built-in operator. ` +
          `Rename your operator, or use registry.forceRegister() to intentionally override it.`
        )
      }
    }
    this.operators = new Map(Object.entries({ ...builtIn, ...custom }))
  }

  /** Returns the definition for the given operator name, or `undefined` if not registered. */
  get(name: string): OperatorDef | undefined {
    return this.operators.get(name)
  }

  /** Returns `true` if the given operator name is registered. */
  has(name: string): boolean {
    return this.operators.has(name)
  }

  /**
   * Registers a new custom operator.
   * Throws if `name` matches a built-in operator — use `forceRegister()` to override intentionally.
   */
  register(name: string, def: OperatorDef): void {
    if (Object.prototype.hasOwnProperty.call(builtIn, name)) {
      throw new Error(
        `Cannot register custom operator "${name}": it conflicts with a built-in operator. ` +
        `Use registry.forceRegister() to intentionally override it.`
      )
    }
    this.operators.set(name, def)
  }

  /**
   * Registers an operator, overriding any existing definition including built-ins.
   * Use with caution — overriding built-in operators like `==` can break SQL safety guarantees.
   */
  forceRegister(name: string, def: OperatorDef): void {
    this.operators.set(name, def)
  }

  entries(): IterableIterator<[string, OperatorDef]> {
    return this.operators.entries()
  }
}

/**
 * Helper to define a custom operator with full type inference.
 *
 * This is a no-op identity function that exists purely as a typed convenience wrapper,
 * ensuring the returned object satisfies the `OperatorDef` interface.
 *
 * @example
 * const fulltext = defineOperator({
 *   allowedTypes: ["string"],
 *   arity: "binary",
 *   compile: (ctx, node) => {
 *     const col = ctx.dialect.quoteIdentifier(node.columnName)
 *     const p = ctx.addParam(node.values[0] as string, node.field)
 *     return `to_tsvector('english', ${col}) @@ plainto_tsquery('english', ${p})`
 *   },
 * })
 */
export function defineOperator(def: OperatorDef): OperatorDef {
  return def
}
