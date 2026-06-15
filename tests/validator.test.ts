import { describe, it, expect } from "vitest"
import { OperatorRegistry } from "../src/registry/index.js"
import { validate } from "../src/validator/index.js"
import type { FieldSchema } from "../src/types.js"

const registry = new OperatorRegistry()

const schema: FieldSchema = {
  age: { type: "number", operators: [">", "<", "==", "between"], constraints: { min: 0, max: 150 } },
  name: { type: "string", operators: ["==", "contains", "startsWith"], constraints: { maxLength: 100 } },
  status: { type: "string", operators: ["==", "in"], constraints: { allowedValues: ["active", "inactive"] } },
  email: { type: "string", operators: ["=="], constraints: { format: "email" } },
  deleted_at: { type: "date", operators: ["is_null", "is_not_null"], nullable: true },
  tags: { type: "array", operators: ["has_any", "has_all"] },
}

const opts = { maxDepth: 10 }

describe("Validator — zero trust field whitelist", () => {
  it("passes a valid simple expression", () => {
    const errors = validate({ ">": [{ var: "age" }, 25] }, schema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("rejects a field not in schema", () => {
    const errors = validate({ "==": [{ var: "password" }, "secret"] }, schema, registry, opts)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("FIELD_NOT_ALLOWED")
    expect(errors[0]?.field).toBe("password")
  })

  it("rejects an operator not allowed on the field", () => {
    const errors = validate({ contains: [{ var: "age" }, "25"] }, schema, registry, opts)
    expect(errors[0]?.code).toBe("OPERATOR_NOT_ALLOWED")
  })

  it("rejects a value with wrong type", () => {
    const errors = validate({ ">": [{ var: "age" }, "not-a-number"] }, schema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_TYPE_MISMATCH")
  })

  it("rejects a value not in allowedValues", () => {
    const errors = validate({ "==": [{ var: "status" }, "banned"] }, schema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
  })

  it("rejects a value exceeding max", () => {
    const errors = validate({ ">": [{ var: "age" }, 200] }, schema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_OUT_OF_RANGE")
  })

  it("rejects a string exceeding maxLength", () => {
    const errors = validate({ "==": [{ var: "name" }, "x".repeat(101)] }, schema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_LENGTH_INVALID")
  })

  it("rejects invalid email format", () => {
    const errors = validate({ "==": [{ var: "email" }, "not-an-email"] }, schema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
  })

  it("collects all errors, does not fail fast", () => {
    const errors = validate(
      {
        and: [{ "==": [{ var: "password" }, "x"] }, { "==": [{ var: "secret" }, "y"] }],
      },
      schema,
      registry,
      opts
    )
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it("rejects depth exceeding maxDepth", () => {
    const deep = {
      and: [
        {
          and: [
            {
              and: [
                {
                  and: [
                    {
                      and: [
                        { and: [{ and: [{ and: [{ and: [{ and: [{ and: [{ "==": [{ var: "age" }, 1] }] }] }] }] }] }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const errors = validate(deep, schema, registry, { maxDepth: 3 })
    expect(errors[0]?.code).toBe("DEPTH_EXCEEDED")
  })

  it("allows is_null on nullable field", () => {
    const errors = validate({ is_null: [{ var: "deleted_at" }] }, schema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("rejects is_null on non-nullable field", () => {
    const errors = validate({ is_null: [{ var: "age" }] }, schema, registry, opts)
    expect(errors[0]?.code).toBe("OPERATOR_NOT_ALLOWED")
  })
})

describe('Bug #1 — ! operator accepts array form { "!": [cond] }', () => {
  it("passes when ! receives array-wrapped condition", () => {
    const errors = validate({ "!": [{ "==": [{ var: "age" }, 5] }] }, schema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("passes when ! receives bare condition (non-array form)", () => {
    const errors = validate({ "!": { "==": [{ var: "age" }, 5] } }, schema, registry, opts)
    expect(errors).toHaveLength(0)
  })
})

describe("Bug #2 — empty and/or rejected by validator", () => {
  it("rejects { and: [] } with INVALID_STRUCTURE", () => {
    const errors = validate({ and: [] }, schema, registry, opts)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.code).toBe("INVALID_STRUCTURE")
  })

  it("rejects { or: [] } with INVALID_STRUCTURE", () => {
    const errors = validate({ or: [] }, schema, registry, opts)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.code).toBe("INVALID_STRUCTURE")
  })
})

describe("Bug #3 — has_any/has_all with numeric values passes for array-typed field", () => {
  it("passes has_any with numeric array values", () => {
    const errors = validate({ has_any: [{ var: "tags" }, [1, 2, 3]] }, schema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("passes has_all with string array values", () => {
    const errors = validate({ has_all: [{ var: "tags" }, ["a", "b"]] }, schema, registry, opts)
    expect(errors).toHaveLength(0)
  })
})

describe("Bug #4 — empty values array for has_any/has_all rejected", () => {
  it("rejects has_any with empty values array", () => {
    const errors = validate({ has_any: [{ var: "tags" }, []] }, schema, registry, opts)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.code).toBe("INVALID_STRUCTURE")
  })

  it("rejects has_all with empty values array", () => {
    const errors = validate({ has_all: [{ var: "tags" }, []] }, schema, registry, opts)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.code).toBe("INVALID_STRUCTURE")
  })
})

describe("allowedValues — object { value, label } support", () => {
  const objSchema: FieldSchema = {
    status: {
      type: "string",
      operators: ["==", "in"],
      constraints: {
        allowedValues: [
          { value: "active", label: "Đang hoạt động" },
          { value: "inactive", label: "Tạm dừng" },
          { value: "banned", label: "Bị khoá" },
        ],
      },
    },
  }

  it("accepts a value that matches an object's value field", () => {
    const errors = validate({ "==": [{ var: "status" }, "active"] }, objSchema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("rejects a value not present in any object's value field", () => {
    const errors = validate({ "==": [{ var: "status" }, "deleted"] }, objSchema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
  })

  it("accepts a label string rejected (label is not a valid filter value)", () => {
    const errors = validate({ "==": [{ var: "status" }, "Đang hoạt động"] }, objSchema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
  })

  it("accepts in operator with object allowedValues", () => {
    const errors = validate({ in: [{ var: "status" }, ["active", "banned"]] }, objSchema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("rejects in operator when one value is not in allowedValues", () => {
    const errors = validate({ in: [{ var: "status" }, ["active", "unknown"]] }, objSchema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
  })
})

describe("Bug #5 — custom variadic operators validated correctly", () => {
  it("passes a user-registered variadic operator with array notation", () => {
    const customRegistry = new OperatorRegistry({
      in_set: { allowedTypes: ["string"], arity: "variadic" },
    })
    const customSchema: FieldSchema = {
      role: { type: "string", operators: ["in_set"] },
    }
    const errors = validate({ in_set: [{ var: "role" }, ["admin", "user"]] }, customSchema, customRegistry, opts)
    expect(errors).toHaveLength(0)
  })
})

describe("JSON Path Querying validation", () => {
  const jsonSchema: FieldSchema = {
    "user.profile.age": {
      type: "number",
      operators: [">", "<", "=="],
      columnName: "user",
      jsonPath: ["profile", "age"],
      constraints: { min: 0, max: 150 },
    },
    "user.profile.email": {
      type: "string",
      operators: ["=="],
      columnName: "user",
      jsonPath: ["profile", "email"],
      constraints: { format: "email" },
    },
  }

  it("passes valid value on JSON path field", () => {
    const errors = validate({ ">": [{ var: "user.profile.age" }, 25] }, jsonSchema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("rejects wrong value type on JSON path field", () => {
    const errors = validate({ ">": [{ var: "user.profile.age" }, "not-a-number"] }, jsonSchema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_TYPE_MISMATCH")
  })

  it("rejects value out of range on JSON path field", () => {
    const errors = validate({ ">": [{ var: "user.profile.age" }, 200] }, jsonSchema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_OUT_OF_RANGE")
  })

  it("rejects invalid format on JSON path field", () => {
    const errors = validate({ "==": [{ var: "user.profile.email" }, "not-an-email"] }, jsonSchema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
  })
})

describe("contained_by, json_has_key, json_has_any_keys validation", () => {
  const customSchema: FieldSchema = {
    tags: { type: "array", operators: ["contained_by"] },
    metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
  }

  it("passes contained_by with valid array values", () => {
    const errors = validate({ contained_by: [{ var: "tags" }, ["tag1", "tag2"]] }, customSchema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("passes json_has_key with string value", () => {
    const errors = validate({ json_has_key: [{ var: "metadata" }, "profile"] }, customSchema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("passes json_has_any_keys with array values", () => {
    const errors = validate(
      { json_has_any_keys: [{ var: "metadata" }, ["profile", "settings"]] },
      customSchema,
      registry,
      opts
    )
    expect(errors).toHaveLength(0)
  })

  it("rejects json_has_key with non-string value", () => {
    const errors = validate({ json_has_key: [{ var: "metadata" }, 123] }, customSchema, registry, opts)
    expect(errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
  })
})

describe("Array constraints validation (minItems, maxItems, arrayOf)", () => {
  const arraySchema: FieldSchema = {
    roles: {
      type: "array",
      operators: ["has_any", "has_all"],
      constraints: {
        arrayOf: "string",
        minItems: 2,
        maxItems: 3,
        allowedValues: ["admin", "editor", "viewer"],
      },
    },
  }

  it("passes valid array constraints", () => {
    const errors = validate({ has_any: [{ var: "roles" }, ["admin", "editor"]] }, arraySchema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("rejects array with fewer items than minItems", () => {
    const errors = validate({ has_any: [{ var: "roles" }, ["admin"]] }, arraySchema, registry, opts)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("VALUE_LENGTH_INVALID")
  })

  it("rejects array with more items than maxItems", () => {
    const errors = validate(
      { has_any: [{ var: "roles" }, ["admin", "editor", "viewer", "admin"]] },
      arraySchema,
      registry,
      opts
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("VALUE_LENGTH_INVALID")
  })

  it("rejects elements of incorrect type", () => {
    const errors = validate({ has_any: [{ var: "roles" }, [123, "admin"]] }, arraySchema, registry, opts)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("VALUE_TYPE_MISMATCH")
  })

  it("rejects elements not present in allowedValues", () => {
    const errors = validate({ has_any: [{ var: "roles" }, ["guest", "admin"]] }, arraySchema, registry, opts)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
  })
})

describe("Circular reference safety", () => {
  it("rejects circular logic objects gracefully", () => {
    const circular: any = { and: [] }
    circular.and.push(circular)
    const errors = validate(circular, schema, registry, opts)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("INVALID_STRUCTURE")
    expect(errors[0]?.message).toBe("Circular reference detected")
  })
})

describe("Code Review Validator Fixes", () => {
  it("rejects between operator with missing bounds (less than 3 args)", () => {
    const errs1 = validate({ between: [{ var: "age" }] }, schema, registry, opts)
    expect(errs1).toHaveLength(1)
    expect(errs1[0]?.code).toBe("INVALID_STRUCTURE")
    expect(errs1[0]?.message).toContain("between")

    const errs2 = validate({ between: [{ var: "age" }, 10] }, schema, registry, opts)
    expect(errs2).toHaveLength(1)
    expect(errs2[0]?.code).toBe("INVALID_STRUCTURE")
    expect(errs2[0]?.message).toContain("between")
  })

  it("allows is_null operator when nullable is undefined but operator is in the field whitelist", () => {
    const implicitSchema: FieldSchema = {
      name: { type: "string", operators: ["is_null", "is_not_null"] },
    }
    const errors = validate({ is_null: [{ var: "name" }] }, implicitSchema, registry, opts)
    expect(errors).toHaveLength(0)
  })

  it("rejects JSON keys containing double quotes", () => {
    const jsonSchema: FieldSchema = {
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }
    const errs1 = validate({ json_has_key: [{ var: "metadata" }, 'fo"o'] }, jsonSchema, registry, opts)
    expect(errs1).toHaveLength(1)
    expect(errs1[0]?.code).toBe("VALUE_FORMAT_INVALID")
    expect(errs1[0]?.message).toContain("double quote")

    const errs2 = validate({ json_has_any_keys: [{ var: "metadata" }, ['ba"r']] }, jsonSchema, registry, opts)
    expect(errs2).toHaveLength(1)
    expect(errs2[0]?.code).toBe("VALUE_FORMAT_INVALID")
    expect(errs2[0]?.message).toContain("double quote")
  })

  it("handles string min/max on number field gracefully", () => {
    const invalidSchema: FieldSchema = {
      age: { type: "number", operators: [">"], constraints: { min: "invalid", max: "invalid" } },
    }
    const errors = validate({ ">": [{ var: "age" }, 25] }, invalidSchema, registry, opts)
    expect(errors).toHaveLength(0)
  })
})

