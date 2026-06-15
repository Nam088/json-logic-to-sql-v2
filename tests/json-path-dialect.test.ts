import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"
import type { Dialect } from "../src/dialects/interface.js"
import { compileCommonNode, compileField, escapeLikePosix } from "../src/dialects/utils.js"
import type { AstNode } from "../src/types.js"
import type { CompileContext } from "../src/dialects/interface.js"

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: build minimal custom dialects that share JSON path syntax with a
// known dialect but have an unrecognisable `name` (no startsWith match).
// ─────────────────────────────────────────────────────────────────────────────

function makeCustomDialect(overrides: Partial<Dialect>): Dialect {
  // Base: positional params, double-quote identifier (postgres-style quoting)
  const base: Dialect = {
    name: "custom-unknown-db", // ← deliberately does NOT match any startsWith
    paramStyle: "positional",
    formatParam: (index) => `$${index}`,
    quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
    compileNode(node: AstNode, ctx: CompileContext): string {
      const col = "columnName" in node ? compileField(node as any, ctx.dialect) : ""
      const common = compileCommonNode(node, ctx, col)
      if (common !== null) return common
      if (node.type === "like") {
        const op = node.operator
        if (op === "contains")     { const p = ctx.addParam(`%${escapeLikePosix(node.value)}%`, node.field); return `${col} LIKE ${p}` }
        if (op === "not_contains") { const p = ctx.addParam(`%${escapeLikePosix(node.value)}%`, node.field); return `${col} NOT LIKE ${p}` }
        if (op === "startsWith")   { const p = ctx.addParam(`${escapeLikePosix(node.value)}%`, node.field); return `${col} LIKE ${p}` }
        if (op === "endsWith")     { const p = ctx.addParam(`%${escapeLikePosix(node.value)}`, node.field); return `${col} LIKE ${p}` }
        if (op === "like")         { const p = ctx.addParam(node.value, node.field); return `${col} LIKE ${p}` }
        if (op === "ilike")        { const p = ctx.addParam(node.value, node.field); return `${col} ILIKE ${p}` }
      }
      throw new Error(`Unsupported node type: ${(node as any).type}`)
    },
  }
  return { ...base, ...overrides }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema with jsonPath fields
// ─────────────────────────────────────────────────────────────────────────────

const jsonSchema: FieldSchema = {
  "user.age": {
    type: "number",
    operators: [">", "=="],
    columnName: "user_data",
    jsonPath: ["profile", "age"],
  },
  "user.vip": {
    type: "boolean",
    operators: ["=="],
    columnName: "user_data",
    jsonPath: ["profile", "vip"],
  },
  "user.name": {
    type: "string",
    operators: ["=="],
    columnName: "user_data",
    jsonPath: ["profile", "name"],
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("jsonPathDialect — custom dialect JSON path routing", () => {

  describe("WITHOUT jsonPathDialect (name does not match any startsWith)", () => {
    // This dialect has no jsonPathDialect and name "custom-unknown-db".
    // compileField falls through all startsWith checks → returns bare column.
    // JSON path is SILENTLY DROPPED.
    const dialect = makeCustomDialect({})
    const converter = createConverter(jsonSchema, { dialect })

    it("silently drops jsonPath and returns bare column (demonstrates the bug)", () => {
      const result = converter.toSQL({ ">": [{ var: "user.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Without jsonPathDialect, the path is ignored → just "user_data"
      expect(result.value.sql).toBe('WHERE "user_data" > $1')
      // No CAST, no ->'profile'->>'age'
      expect(result.value.sql).not.toContain("profile")
    })
  })

  describe("WITH jsonPathDialect: 'postgres'", () => {
    // Setting jsonPathDialect: "postgres" on a custom dialect with unrecognisable name
    // should produce the same JSON path SQL as the built-in postgresDialect.
    const dialect = makeCustomDialect({ jsonPathDialect: "postgres" })
    const converter = createConverter(jsonSchema, { dialect })

    it("generates postgres -> / ->> JSON path syntax for number field", () => {
      const result = converter.toSQL({ ">": [{ var: "user.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE CAST("user_data"->'profile'->>'age' AS numeric) > $1`)
      expect(result.value.params).toEqual([25])
    })

    it("generates CAST(... AS boolean) for boolean json field", () => {
      const result = converter.toSQL({ "==": [{ var: "user.vip" }, true] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE CAST("user_data"->'profile'->>'vip' AS boolean) = $1`)
    })

    it("generates uncast path for string json field", () => {
      const result = converter.toSQL({ "==": [{ var: "user.name" }, "Alice"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // string type has no cast in postgres
      expect(result.value.sql).toBe(`WHERE "user_data"->'profile'->>'name' = $1`)
    })
  })

  describe("WITH jsonPathDialect: 'mysql'", () => {
    // Same custom-unknown-db name, but routing to MySQL JSON path syntax.
    const dialect = makeCustomDialect({
      jsonPathDialect: "mysql",
      quoteIdentifier: (name) => `\`${name.replace(/`/g, "``")}\``,
    })
    const converter = createConverter(jsonSchema, { dialect })

    it("generates MySQL ->>  JSON path syntax for number field", () => {
      const result = converter.toSQL({ ">": [{ var: "user.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE CAST(`user_data`->>\'$."profile"."age"\' AS DECIMAL) > $1')
    })

    it("generates CAST(... AS SIGNED) for boolean json field", () => {
      const result = converter.toSQL({ "==": [{ var: "user.vip" }, true] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE CAST(`user_data`->>\'$."profile"."vip"\' AS SIGNED) = $1')
    })
  })

  describe("WITH jsonPathDialect: 'sqlite'", () => {
    const dialect = makeCustomDialect({ jsonPathDialect: "sqlite" })
    const converter = createConverter(jsonSchema, { dialect })

    it("generates SQLite ->> JSON path syntax for number field", () => {
      const result = converter.toSQL({ ">": [{ var: "user.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE CAST("user_data" ->> '$."profile"."age"' AS NUMERIC) > $1`)
    })
  })

  describe("WITH jsonPathDialect: 'mssql'", () => {
    const dialect = makeCustomDialect({
      jsonPathDialect: "mssql",
      quoteIdentifier: (name) => `[${name.replace(/]/g, "]]")}]`,
    })
    const converter = createConverter(jsonSchema, { dialect })

    it("generates MSSQL JSON_VALUE() path for number field", () => {
      const result = converter.toSQL({ ">": [{ var: "user.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE CAST(JSON_VALUE([user_data], '$."profile"."age"') AS DECIMAL) > $1`)
    })
  })

  describe("jsonPathDialect takes priority over dialect.name", () => {
    // Even if name starts with "postgres", jsonPathDialect: "mysql" should win.
    const dialect = makeCustomDialect({
      name: "postgres-but-actually-mysql",
      jsonPathDialect: "mysql",
      quoteIdentifier: (name) => `\`${name.replace(/`/g, "``")}\``,
    })
    const converter = createConverter(jsonSchema, { dialect })

    it("uses mysql syntax despite name starting with 'postgres'", () => {
      const result = converter.toSQL({ ">": [{ var: "user.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Should use MySQL syntax (->>'$.path'), NOT postgres (->'key'->>'key')
      expect(result.value.sql).toBe('WHERE CAST(`user_data`->>\'$."profile"."age"\' AS DECIMAL) > $1')
      expect(result.value.sql).not.toContain("->'profile'")
    })
  })
})
