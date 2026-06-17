import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import { compile } from "../src/compiler/index.js"
import { postgresDialect } from "../src/dialects/postgres.js"
import type { FieldSchema } from "../src/types.js"

const schema: FieldSchema = {
  name: { type: "string", operators: ["==", "contains"] },
  age: { type: "number", operators: [">", "<", "=="] },
}

const converter = createConverter(schema)

describe("Security — injection & abuse prevention", () => {
  it("rejects unknown fields (cannot probe schema)", () => {
    const result = converter.toSQL({ "==": [{ var: "users.password" }, "x"] })
    expect(result.ok).toBe(false)
  })

  it("rejects SQL-injection-style string values (still parameterized, but blocked by field check)", () => {
    // Even if the value looks like SQL, it's safe because it's always parameterized
    // This test ensures disallowed operators cannot be smuggled in
    const result = converter.toSQL({ raw_sql: [{ var: "name" }, "1; DROP TABLE users"] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("UNKNOWN_OPERATOR")
  })

  it("rejects excessive nesting (DoS guard)", () => {
    let node: unknown = { "==": [{ var: "age" }, 1] }
    for (let i = 0; i < 15; i++) {
      node = { and: [node] }
    }
    const result = converter.toSQL(node)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("DEPTH_EXCEEDED")
  })

  it("rejects null input", () => {
    const result = converter.toSQL(null)
    expect(result.ok).toBe(false)
  })

  it("rejects array input", () => {
    const result = converter.toSQL([{ "==": [{ var: "age" }, 1] }])
    expect(result.ok).toBe(false)
  })

  it("rejects operator type mismatch (cannot smuggle number op on string field)", () => {
    const result = converter.toSQL({ ">": [{ var: "name" }, 100] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("OPERATOR_NOT_ALLOWED")
  })

  it("params are always collected, never interpolated into SQL string", () => {
    const result = converter.toSQL({ "==": [{ var: "name" }, "'; DROP TABLE users; --"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).not.toContain("DROP")
    expect(result.value.sql).not.toContain("'")
    expect(result.value.params[0]).toBe("'; DROP TABLE users; --")
  })

  it("toSQL() rejects malicious or invalid sort direction via validation", () => {
    const sortSchema: FieldSchema = {
      name: { type: "string", operators: ["=="], sortable: true },
    }
    const sortConverter = createConverter(sortSchema, { sort: true })
    const result = sortConverter.toSQL(
      { "==": [{ var: "name" }, "Alice"] },
      [{ field: "name", direction: "asc; DROP TABLE users" as any }]
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("INVALID_STRUCTURE")
    expect(result.errors[0]?.message).toContain('Sort direction must be "asc" or "desc"')
  })

  it("compiler prevents SQL injection in sort direction even if called directly", () => {
    const ast = { type: "comparison" as const, operator: "==" as const, field: "name", columnName: "name", value: "Alice" }
    const sort = [{ field: "name", direction: "desc; DROP TABLE users;" as any }]
    const sortSchema: FieldSchema = {
      name: { type: "string", operators: ["=="], sortable: true },
    }
    const result = compile(ast, postgresDialect, sort, sortSchema)
    expect(result.sql).not.toContain("DROP")
    expect(result.sql).toContain("ASC")
  })
})
