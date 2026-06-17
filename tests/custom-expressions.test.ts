import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Runtime Field Mappings, OR-Expansion & SQL Expressions", () => {
  const schema: FieldSchema = {
    verifyStatus: {
      type: "string",
      operators: ["==", "!=", "in", "between", "is_null"],
    },
    age: {
      type: "number",
      operators: ["==", ">=", "<=", "between"],
    },
    otherStatus: {
      type: "string",
      operators: ["=="],
    },
  }

  it("handles string columnName mapping (standard quoting)", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "initiation"] },
      fieldMappings: {
        verifyStatus: "status",
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "status" = $1`)
    expect(result.value.params).toEqual(["initiation"])
  })

  it("handles raw SQL expression mapping (no quoting)", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "initiation"] },
      fieldMappings: {
        verifyStatus: "COALESCE(verifyStatus, 'NONE')",
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE COALESCE(verifyStatus, 'NONE') = $1`)
    expect(result.value.params).toEqual(["initiation"])
  })

  it("handles object mapping with column and single string orColumn", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "init"] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: "secondary_status",
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" = $1 OR "secondary_status" = $2)`)
    expect(result.value.params).toEqual(["init", "init"])
  })

  it("handles object mapping with raw column and raw orColumn (mixed)", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "init"] },
      fieldMappings: {
        verifyStatus: {
          column: "COALESCE(status, 'none')",
          orColumn: "COALESCE(secondary, 'none')",
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE (COALESCE(status, 'none') = $1 OR COALESCE(secondary, 'none') = $2)`)
    expect(result.value.params).toEqual(["init", "init"])
  })

  it("handles array orColumn expanding to multiple OR gates", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "init"] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2", "COALESCE(col3, 'x')"],
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" = $1 OR "col2" = $2 OR COALESCE(col3, 'x') = $3)`)
    expect(result.value.params).toEqual(["init", "init", "init"])
  })

  it("verifies between operator OR-expansion logic", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { between: [{ var: "age" }, 18, 30] },
      fieldMappings: {
        age: {
          column: "main_age",
          orColumn: ["sec_age"],
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(
      `WHERE ("main_age" BETWEEN $1 AND $2 OR "sec_age" BETWEEN $3 AND $4)`
    )
    expect(result.value.params).toEqual([18, 30, 18, 30])
  })

  it("verifies IN operator OR-expansion logic", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { in: [{ var: "verifyStatus" }, ["active", "pending"]] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2"],
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" IN ($1, $2) OR "col2" IN ($3, $4))`)
    expect(result.value.params).toEqual(["active", "pending", "active", "pending"])
  })

  it("verifies is_null operator OR-expansion logic", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { is_null: [{ var: "verifyStatus" }] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2"],
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" IS NULL OR "col2" IS NULL)`)
    expect(result.value.params).toEqual([])
  })

  it("handles complex nested and/or/not logic mixed with OR-expanded fields", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: {
        and: [
          { "!": { "==": [{ var: "verifyStatus" }, "rejected"] } },
          {
            or: [
              { ">=": [{ var: "age" }, 21] },
              { in: [{ var: "verifyStatus" }, ["active", "pending"]] }
            ]
          }
        ]
      },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["alt_status"]
        },
        age: {
          column: "user_age",
          orColumn: ["profile_age"]
        }
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(
      `WHERE (NOT (("status" = $1 OR "alt_status" = $2)) AND (("user_age" >= $3 OR "profile_age" >= $4) OR ("status" IN ($5, $6) OR "alt_status" IN ($7, $8))))`
    )
    expect(result.value.params).toEqual([
      "rejected", "rejected",
      21, 21,
      "active", "pending", "active", "pending"
    ])
  })

  it("handles FieldRefNode (RHS variable reference) with custom SQL expressions", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, { var: "otherStatus" }] },
      fieldMappings: {
        verifyStatus: "COALESCE(status, 'none')",
        otherStatus: "CAST(age_field AS text)",
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE COALESCE(status, 'none') = CAST(age_field AS text)`)
  })

  it("handles array operator (has_any) with OR-expansion", () => {
    const converter = createConverter({
      tags: {
        type: "array",
        operators: ["has_any"],
      }
    }, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { has_any: [{ var: "tags" }, ["VIP", "Premium"]] },
      fieldMappings: {
        tags: {
          column: "user_tags",
          orColumn: ["org_tags"]
        }
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(
      `WHERE ("user_tags" && ARRAY[$1, $2] OR "org_tags" && ARRAY[$3, $4])`
    )
    expect(result.value.params).toEqual(["VIP", "Premium", "VIP", "Premium"])
  })
})
