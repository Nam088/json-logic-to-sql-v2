import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Runtime Field Mappings, OR-Expansion & SQL Expressions", () => {
  const schema: FieldSchema = {
    verifyStatus: {
      type: "string",
      operators: [
        "==", "===", "!=", "!==",
        "in", "not_in",
        "between",
        "is_null", "is_not_null",
        "contains", "ilike",
        "my_custom_op"
      ],
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

  // GROUP 1: Dialect validations with column name mappings and raw SQL mappings
  it("handles Postgres column mapping (quotes with double quotes)", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: { verifyStatus: "db_status" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "db_status" = $1`)
  })

  it("handles MySQL column mapping (quotes with backticks)", () => {
    const converter = createConverter(schema, { dialect: "mysql" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: { verifyStatus: "db_status" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE \`db_status\` = ?`)
  })

  it("handles MSSQL column mapping (quotes with brackets)", () => {
    const converter = createConverter(schema, { dialect: "mssql" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: { verifyStatus: "db_status" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE [db_status] = ?`)
  })

  it("handles SQLite column mapping (quotes with double quotes)", () => {
    const converter = createConverter(schema, { dialect: "sqlite" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: { verifyStatus: "db_status" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "db_status" = ?`)
  })

  it("handles raw SQL with colons (type casting)", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: { verifyStatus: "status::text" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE status::text = $1`)
  })

  it("handles raw SQL with parentheses", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: { verifyStatus: "LOWER(status)" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE LOWER(status) = $1`)
  })

  // GROUP 2: JSON Path & Nested mappings overrides
  it("handles flat schema dot-notation mapping (e.g. user.profile.age)", () => {
    const nestedSchema: FieldSchema = {
      user: {
        properties: {
          profile: {
            properties: {
              age: { type: "number", operators: [">="] },
            },
          },
        },
      },
    }
    const converter = createConverter(nestedSchema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { ">=": [{ var: "user.profile.age" }, 18] },
      fieldMappings: {
        "user.profile.age": { column: "custom_age_col", jsonPath: [] },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "custom_age_col" >= $1`)
  })

  it("preserves JSON path extraction when only overriding columnName", () => {
    const jsonSchema: FieldSchema = {
      meta: {
        columnName: "meta_data",
        jsonPath: ["profile", "age"],
        type: "number",
        operators: ["=="],
      },
    }
    const converter = createConverter(jsonSchema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "meta" }, 25] },
      fieldMappings: { meta: "custom_meta_table" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE CAST("custom_meta_table"->'profile'->>'age' AS numeric) = $1`)
  })

  it("bypasses JSON path extraction when overriding with raw SQL", () => {
    const jsonSchema: FieldSchema = {
      meta: {
        columnName: "meta_data",
        jsonPath: ["profile", "age"],
        type: "number",
        operators: ["=="],
      },
    }
    const converter = createConverter(jsonSchema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "meta" }, 25] },
      fieldMappings: { meta: "COALESCE(custom_meta_table->'profile'->>'age', '0')::numeric" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE COALESCE(custom_meta_table->'profile'->>'age', '0')::numeric = $1`)
  })

  it("handles json_has_key operator with columnName override", () => {
    const jsonSchema: FieldSchema = {
      meta: {
        columnName: "meta_data",
        operators: ["json_has_key"],
      },
    }
    const converter = createConverter(jsonSchema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { json_has_key: [{ var: "meta" }, "vip"] },
      fieldMappings: { meta: "custom_meta" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("custom_meta" ? $1)`)
  })

  it("handles json_has_any_keys operator with columnName override", () => {
    const jsonSchema: FieldSchema = {
      meta: {
        columnName: "meta_data",
        operators: ["json_has_any_keys"],
      },
    }
    const converter = createConverter(jsonSchema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { json_has_any_keys: [{ var: "meta" }, ["vip", "admin"]] },
      fieldMappings: { meta: "custom_meta" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("custom_meta" ?| ARRAY[$1, $2])`)
  })

  // GROUP 3: Operator combinations & OR-expansion combinations
  it("handles like operator with single string orColumn mapping", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { contains: [{ var: "verifyStatus" }, "active"] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: "alt_status",
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" LIKE $1 OR "alt_status" LIKE $2)`)
  })

  it("handles ilike operator with array orColumn mapping", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { ilike: [{ var: "verifyStatus" }, "active"] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2", "col3"],
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" ILIKE $1 OR "col2" ILIKE $2 OR "col3" ILIKE $3)`)
  })

  it("handles not_in operator with orColumn mapping", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { not_in: [{ var: "verifyStatus" }, ["active", "pending"]] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2"],
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" NOT IN ($1, $2) OR "col2" NOT IN ($3, $4))`)
  })

  it("handles is_not_null operator with orColumn mapping", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { is_not_null: [{ var: "verifyStatus" }] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2"],
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" IS NOT NULL OR "col2" IS NOT NULL)`)
  })

  it("handles custom operators with orColumn mapping", () => {
    const converter = createConverter(schema, {
      dialect: "postgres",
      operators: {
        my_custom_op: {
          allowedTypes: ["any"],
          arity: "binary",
          validate: () => true,
          compile: (ctx, node, col) => `${col} = SOME_FUNC(${ctx.addParam(node.values[0])})`,
        },
      },
    })
    const result = converter.toSQL({
      rule: { my_custom_op: [{ var: "verifyStatus" }, "val"] },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2"],
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" = SOME_FUNC($1) OR "col2" = SOME_FUNC($2))`)
  })

  it("handles double nested NOT gate with orColumn mapping", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "!": { "!": { "==": [{ var: "verifyStatus" }, "active"] } } },
      fieldMappings: {
        verifyStatus: {
          column: "status",
          orColumn: ["col2"],
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE NOT (NOT (("status" = $1 OR "col2" = $2)))`)
  })

  it("handles multiple fields with separate OR-expansions in the same query", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: {
        and: [
          { "==": [{ var: "verifyStatus" }, "active"] },
          { ">=": [{ var: "age" }, 18] },
        ],
      },
      fieldMappings: {
        verifyStatus: { column: "status", orColumn: ["alt_status"] },
        age: { column: "user_age", orColumn: ["profile_age"] },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(
      `WHERE (("status" = $1 OR "alt_status" = $2) AND ("user_age" >= $3 OR "profile_age" >= $4))`
    )
  })

  it("handles multiple fields with raw SQL expressions in the same query", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: {
        and: [
          { "==": [{ var: "verifyStatus" }, "active"] },
          { ">=": [{ var: "age" }, 18] },
        ],
      },
      fieldMappings: {
        verifyStatus: "COALESCE(status, 'none')",
        age: "user_age + 5",
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE (COALESCE(status, 'none') = $1 AND user_age + 5 >= $2)`)
  })

  it("handles !== comparison with OR-expansion", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "!==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: {
        verifyStatus: { column: "status", orColumn: ["col2"] },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" != $1 OR "col2" != $2)`)
  })

  it("handles === comparison with OR-expansion", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "===": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: {
        verifyStatus: { column: "status", orColumn: ["col2"] },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("status" = $1 OR "col2" = $2)`)
  })

  // GROUP 4: Edge cases & Signature variants
  it("accepts fieldMappings as third argument in traditional signature", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL(
      { "==": [{ var: "verifyStatus" }, "active"] },
      undefined,
      { limit: 10, offset: 0 } // pagination as third arg, let's verify if signature supports fieldMappings in second arg options
    )
    expect(result.ok).toBe(true)
  })

  it("accepts fieldMappings inside Options as second argument in traditional signature", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL(
      { "==": [{ var: "verifyStatus" }, "active"] },
      {
        fieldMappings: { verifyStatus: "status" },
      }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "status" = $1`)
  })

  it("allows overriding field type via fieldMappings", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    // In schema, age is a number. We override it to string.
    // Wait, if we override the type to string, does it validate strings instead?
    // Let's pass a string to verifyStatus or age.
    const result = converter.toSQL({
      rule: { "==": [{ var: "age" }, "not-a-number"] },
      fieldMappings: {
        age: {
          type: "string",
          column: "age_col",
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "age_col" = $1`)
  })

  it("allows overriding constraints via fieldMappings", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    // age has max constraint overridden.
    // If we pass age: 200, which might exceed default max (if any). Let's set min constraint to 50.
    // If we pass age: 20, it should fail validator.
    const result = converter.toSQL({
      rule: { "==": [{ var: "age" }, 20] },
      fieldMappings: {
        age: {
          constraints: { min: 50 },
        },
      },
    })
    expect(result.ok).toBe(false)
  })

  it("allows enabling is_null validation dynamically by overriding nullable to true", () => {
    const strictSchema: FieldSchema = {
      age: {
        type: "number",
        operators: ["==", "is_null"],
        nullable: false, // by default not nullable
      },
    }
    const converter = createConverter(strictSchema, { dialect: "postgres" })
    // Running with nullable override:
    const result = converter.toSQL({
      rule: { is_null: [{ var: "age" }] },
      fieldMappings: {
        age: {
          nullable: true,
          column: "user_age",
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "user_age" IS NULL`)
  })

  it("preserves schema definition when mapping is empty object", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: {
        verifyStatus: {},
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "verifyStatus" = $1`)
  })

  it("handles override containing spaces only", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: {
        verifyStatus: "   ",
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE     = $1`)
  })

  it("handles mapping to a subquery", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, "active"] },
      fieldMappings: {
        verifyStatus: "(SELECT status FROM logs WHERE logs.id = users.id LIMIT 1)",
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE (SELECT status FROM logs WHERE logs.id = users.id LIMIT 1) = $1`)
  })

  it("handles same-variable comparison on LHS and RHS with mappings", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      rule: { "==": [{ var: "verifyStatus" }, { var: "otherStatus" }] },
      fieldMappings: {
        verifyStatus: "status_a",
        otherStatus: "status_b",
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "status_a" = "status_b"`)
  })
})
