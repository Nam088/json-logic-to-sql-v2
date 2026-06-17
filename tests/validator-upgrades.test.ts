import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Validator Upgrades — Search length & Operator arity", () => {
  const schema: FieldSchema = {
    bio: {
      type: "string",
      operators: ["contains", "==", "range_custom", "strict_custom"],
    },
    limited_bio: {
      type: "string",
      operators: ["contains"],
      constraints: { maxLength: 10 },
    },
    status: {
      type: "string",
      operators: ["is_null", "=="],
    }
  }

  describe("String search pattern length limits", () => {
    const converter = createConverter(schema, { dialect: "postgres" })

    it("allows search pattern within default 512 char limit", () => {
      const result = converter.toSQL({ contains: [{ var: "bio" }, "short search"] })
      expect(result.ok).toBe(true)
    })

    it("rejects search pattern exceeding default 512 char limit", () => {
      const longSearch = "x".repeat(513)
      const result = converter.toSQL({ contains: [{ var: "bio" }, longSearch] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_LENGTH_INVALID")
      expect(result.errors[0]?.message).toContain("exceeds maximum allowed length")
    })

    it("rejects search pattern exceeding field-specific maxLength limit", () => {
      const result = converter.toSQL({ contains: [{ var: "limited_bio" }, "too long search"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_LENGTH_INVALID")
      expect(result.errors[0]?.message).toContain("exceeds maximum allowed length of 10")
    })

    it("does not apply search limits to standard non-search operators (which check standard maxLength)", () => {
      const longValue = "x".repeat(100)
      // "==" is a comparison, not a search operator (like contains)
      const result = converter.toSQL({ "==": [{ var: "bio" }, longValue] })
      expect(result.ok).toBe(true) // allowed since bio has no maxLength constraint
    })
  })

  describe("Operator arity verification", () => {
    const converter = createConverter(schema, {
      dialect: "postgres",
      operators: {
        strict_custom: {
          allowedTypes: ["string"],
          arity: "binary",
          minArity: 2,
          maxArity: 2,
          compile: (ctx, node) => `STRICT_MATCH(${node.columnName})`
        },
        range_custom: {
          allowedTypes: ["string"],
          arity: "variadic",
          minArity: 2,
          maxArity: 4,
          compile: (ctx, node) => `RANGE_MATCH(${node.columnName})`
        }
      }
    })

    it("enforces default unary arity (exactly 1 arg)", () => {
      const result = converter.toSQL({ is_null: [{ var: "status" }, "extra_arg"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("INVALID_STRUCTURE")
      expect(result.errors[0]?.message).toContain("expects exactly 1 argument")
    })

    it("enforces default binary arity (exactly 2 args)", () => {
      const result = converter.toSQL({ "==": [{ var: "status" }] }) // missing value
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("INVALID_STRUCTURE")
      expect(result.errors[0]?.message).toContain("expects exactly 2 arguments")
    })

    it("enforces custom operator minArity", () => {
      // range_custom requires minArity 2 (field + at least 1 arg)
      const result = converter.toSQL({ range_custom: [{ var: "bio" }] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("INVALID_STRUCTURE")
      expect(result.errors[0]?.message).toContain("requires at least 2 arguments")
    })

    it("enforces custom operator maxArity", () => {
      // range_custom allows maxArity 4 (field + at most 3 args)
      const result = converter.toSQL({ range_custom: [{ var: "bio" }, "a", "b", "c", "d"] }) // 5 args total
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("INVALID_STRUCTURE")
      expect(result.errors[0]?.message).toContain("allows at most 4 arguments")
    })

    it("passes custom operator with valid arity", () => {
      const result = converter.toSQL({ range_custom: [{ var: "bio" }, "a", "b"] }) // 3 args total
      expect(result.ok).toBe(true)
    })
  })
})
