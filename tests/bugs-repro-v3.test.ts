import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Reproduction of Bugs 41-44", () => {
  it("Bug 41: Empty sort array should be allowed even when sort is disabled", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: ["=="], sortable: true }
    }
    // Converter has sort: false (default)
    const converter = createConverter(schema, { sort: false })

    // Empty sort rule array should be permitted
    const resultEmpty = converter.toSQL({ "==": [{ var: "age" }, 25] }, [])
    expect(resultEmpty.ok).toBe(true)

    // Non-empty sort rule array should fail validation with SORT_NOT_ENABLED
    const resultNonEmpty = converter.toSQL({ "==": [{ var: "age" }, 25] }, [{ field: "age", direction: "asc" }])
    expect(resultNonEmpty.ok).toBe(false)
    if (!resultNonEmpty.ok) {
      expect(resultNonEmpty.errors[0].code).toBe("SORT_NOT_ENABLED")
    }
  })

  it("Bug 42: Comparing against null literal is allowed only on nullable fields", () => {
    const schema: FieldSchema = {
      nullable_field: { type: "string", operators: ["=="], nullable: true },
      non_nullable_field: { type: "string", operators: ["=="], nullable: false },
    }
    const converter = createConverter(schema)

    // Nullable field comparison against null -> OK
    const resultNullable = converter.toSQL({ "==": [{ var: "nullable_field" }, null] })
    expect(resultNullable.ok).toBe(true)

    // Non-nullable field comparison against null -> FAIL with VALUE_TYPE_MISMATCH
    const resultNonNullable = converter.toSQL({ "==": [{ var: "non_nullable_field" }, null] })
    expect(resultNonNullable.ok).toBe(false)
    if (!resultNonNullable.ok) {
      expect(resultNonNullable.errors[0].code).toBe("VALUE_TYPE_MISMATCH")
    }
  })

  it("Bug 43: String type is supported by between operator", () => {
    const schema: FieldSchema = {
      name: { type: "string", operators: ["between"] }
    }
    const converter = createConverter(schema)

    const result = converter.toSQL({ between: [{ var: "name" }, "A", "Z"] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sql).toBe('WHERE "name" BETWEEN $1 AND $2')
      expect(result.value.params).toEqual(["A", "Z"])
    }
  })

  it("Bug 44: MySQL compiles boolean JSON path fields using -> and without CAST", () => {
    const schema: FieldSchema = {
      "user.vip": { type: "boolean", columnName: "metadata", jsonPath: ["vip"], operators: ["=="] }
    }
    const converter = createConverter(schema, { dialect: "mysql" })

    const result = converter.toSQL({ "==": [{ var: "user.vip" }, true] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Should extract with `->` and skip `CAST`
      expect(result.value.sql).toBe("WHERE `metadata`->'$.\"vip\"' = ?")
      expect(result.value.params).toEqual([true])
    }
  })
})
