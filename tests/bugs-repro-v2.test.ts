import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Reproduction of 10 logical / compilation / security bugs", () => {

  it("Bug 1: Postgres array_op wraps field reference in ARRAY constructor", () => {
    const schema: FieldSchema = {
      roles: { type: "array", operators: ["has_any"] },
      other_roles: { type: "array", operators: ["has_any"] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ has_any: [{ var: "roles" }, { var: "other_roles" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should NOT wrap "other_roles" in ARRAY[...]
      expect(result.value.sql).toBe('WHERE "roles" && "other_roles"')
    }
  })

  it("Bug 2: MySQL array_op wraps field reference in JSON_ARRAY", () => {
    const schema: FieldSchema = {
      roles: { type: "array", operators: ["has_any"] },
      other_roles: { type: "array", operators: ["has_any"] },
    }
    const converter = createConverter(schema, { dialect: "mysql" })
    const result = converter.toSQL({ has_any: [{ var: "roles" }, { var: "other_roles" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should NOT wrap `other_roles` in JSON_ARRAY(...)
      expect(result.value.sql).toBe('WHERE JSON_OVERLAPS(`roles`, `other_roles`)')
    }
  })

  it("Bug 3: ! operator allows multiple arguments without validation failure", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: ["=="] },
    }
    const converter = createConverter(schema)
    const result = converter.toSQL({ "!": [{ "==": [{ var: "age" }, 25] }, { "==": [{ var: "age" }, 30] }] })
    // It should fail validation because ! expects exactly one condition
    expect(result.ok).toBe(false)
  })

  it("Bug 4: between operator allows more than 3 arguments without validation failure", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: ["between"] },
    }
    const converter = createConverter(schema)
    const result = converter.toSQL({ between: [{ var: "age" }, 10, 20, 30] })
    // It should fail validation because between expects exactly 3 arguments (field, min, max)
    expect(result.ok).toBe(false)
  })

  it("Bug 5: Postgres JSON path array_op wraps field reference in ARRAY or jsonb_build_array", () => {
    const schema: FieldSchema = {
      "user.tags": { type: "array", columnName: "metadata", jsonPath: ["tags"], operators: ["has_any"] },
      "user.other_tags": { type: "array", columnName: "metadata", jsonPath: ["other_tags"], operators: ["has_any"] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ has_any: [{ var: "user.tags" }, { var: "user.other_tags" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should not wrap the compiled field reference in ARRAY[...] directly, but use SELECT jsonb_array_elements_text
      expect(result.value.sql).toBe('WHERE jsonb_exists_any("metadata"->\'tags\', ARRAY(SELECT jsonb_array_elements_text("metadata"->\'other_tags\')))')
    }
  })

  it("Bug 6: resolveRef does not detect raw SQL in internal.column", () => {
    const schema: FieldSchema = {
      coalesced_field: {
        type: "string",
        operators: ["=="],
        internal: {
          column: "COALESCE(col, 'default')"
        }
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "coalesced_field" }, "val"] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should NOT quote the entire COALESCE expression as a column identifier
      expect(result.value.sql).toBe("WHERE COALESCE(col, 'default') = $1")
    }
  })

  it("Bug 7: Date normalizer slices standard ISO year part incorrectly for far future dates", () => {
    const schema: FieldSchema = {
      created_at: { type: "date", operators: ["=="] },
    }
    const converter = createConverter(schema, { dialect: "mysql" })
    // Date in year 10000 (using the correct extended format prefix "+01" for JS parser)
    const farFutureDate = new Date("+010000-01-01T00:00:00.000Z")
    const result = converter.toSQL({ "==": [{ var: "created_at" }, farFutureDate as any] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // MySQL DATETIME expects "10000-01-01 00:00:00".
      // Currently, it gets sliced incorrectly and returns "+010000-01-01 00:00".
      expect(result.value.params[0]).toBe("10000-01-01 00:00:00")
    }
  })

  it("Bug 8: Sort compilation ignores sqlExpression / raw SQL columns", () => {
    const schema: FieldSchema = {
      full_name: {
        type: "string",
        sqlExpression: "first_name || ' ' || last_name",
        operators: ["=="],
        sortable: true,
      }
    }
    const converter = createConverter(schema, { dialect: "postgres", sort: true })
    const result = converter.toSQL({ "==": [{ var: "full_name" }, "Alice"] }, [{ field: "full_name", direction: "desc" }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Should sort by the sqlExpression, not the quoted logical field name
      expect(result.value.sql).toBe(`WHERE first_name || ' ' || last_name = $1 ORDER BY first_name || ' ' || last_name DESC`)
    }
  })

  it("Bug 9: Whitespace-only column property inside mapping object in fieldMappings is not rejected", () => {
    const schema: FieldSchema = {
      status: { type: "string", operators: ["=="] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "status" }, "active"] }, {
      fieldMappings: { status: { column: "   " } },
    })
    // It should be rejected as an invalid structure/whitespace mapping
    expect(result.ok).toBe(false)
  })

  it("Bug 10: Alternative columns from orColumn inherit jsonPath from primary column", () => {
    const schema: FieldSchema = {
      age: {
        type: "number",
        columnName: "metadata",
        jsonPath: ["profile", "age"],
        orColumn: "alt_age_simple_col",
        operators: ["=="],
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "age" }, 25] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // alt_age_simple_col is NOT a JSON column and does NOT have a jsonPath.
      // It should compile to standard column reference, not a JSON path query.
      expect(result.value.sql).toBe(`WHERE (CAST("metadata"->'profile'->>'age' AS numeric) = $1 OR "alt_age_simple_col" = $2)`)
    }
  })

  it("Bug 11: Null checks on typed JSON path fields do not apply casting", () => {
    const schema: FieldSchema = {
      birth_date: {
        type: "date",
        columnName: "metadata",
        jsonPath: ["profile", "birth_date"],
        operators: ["is_null", "is_not_null"],
        nullable: true,
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ is_null: [{ var: "birth_date" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should not cast to timestamp, just check if the raw JSON extract value is null:
      // "metadata"->'profile'->>'birth_date' IS NULL
      expect(result.value.sql).toBe(`WHERE "metadata"->'profile'->>'birth_date' IS NULL`)
    }
  })

  it("Bug 12: SQLite LIKE and ILIKE do not append ESCAPE clause for raw operator", () => {
    const schema: FieldSchema = {
      path: {
        type: "string",
        operators: ["like", "ilike"],
      }
    }
    const converter = createConverter(schema, { dialect: "sqlite" })
    const resultLike = converter.toSQL({ like: [{ var: "path" }, "C:\\Windows\\%"] })
    expect(resultLike.ok).toBe(true)
    if (resultLike.ok) {
      expect(resultLike.value.sql).toBe(`WHERE "path" LIKE ?`)
      expect(resultLike.value.params).toEqual(["C:\\Windows\\%"])
    }

    const resultILike = converter.toSQL({ ilike: [{ var: "path" }, "C:\\Windows\\%"] })
    expect(resultILike.ok).toBe(true)
    if (resultILike.ok) {
      expect(resultILike.value.sql).toBe(`WHERE LOWER("path") LIKE LOWER(?)`)
    }
  })

  it("Bug 13: flattenSchema handles legacy 'column' property on parent nested definitions", () => {
    const schema: FieldSchema = {
      user: {
        column: "user_data", // legacy column name
        properties: {
          profile: {
            properties: {
              age: { type: "number", operators: ["=="] }
            }
          }
        }
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "user.profile.age" }, 25] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should inherit user_data as columnName, not fall back to 'user'
      expect(result.value.sql).toBe(`WHERE CAST("user_data"->'profile'->>'age' AS numeric) = $1`)
    }
  })

  it("Bug 14: Sort compilation respects legacy 'column' property", () => {
    const schema: FieldSchema = {
      status: {
        type: "string",
        column: "actual_status_col",
        operators: ["=="],
        sortable: true,
      }
    }
    const converter = createConverter(schema, { dialect: "postgres", sort: true })
    const result = converter.toSQL({ "==": [{ var: "status" }, "active"] }, [{ field: "status", direction: "desc" }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sql).toBe(`WHERE "actual_status_col" = $1 ORDER BY "actual_status_col" DESC`)
    }
  })

  it("Bug 15: Alternative columns with table qualifier are quoted correctly", () => {
    const schema: FieldSchema = {
      status: {
        type: "string",
        columnName: "status",
        internal: { table: "users" },
        orColumn: "audit_log.status",
        operators: ["=="],
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "status" }, "active"] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should compile the alternative column as "audit_log"."status", NOT "users"."audit_log.status"
      expect(result.value.sql).toBe(`WHERE ("users"."status" = $1 OR "audit_log"."status" = $2)`)
    }
  })

  it("Bug 16: Nested properties inherit columnName from their closest parent that defines one", () => {
    const schema: FieldSchema = {
      user: {
        column: "user_data",
        properties: {
          profile: {
            column: "profile_data", // nested parent overrides column
            properties: {
              age: { type: "number", operators: ["=="] }
            }
          }
        }
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "user.profile.age" }, 25] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should inherit profile_data as columnName (with jsonPath ["age"]), NOT user_data
      expect(result.value.sql).toBe(`WHERE CAST("profile_data"->>'age' AS numeric) = $1`)
    }
  })

  it("Bug 17: jsonPath containing numeric strings compiles as array index", () => {
    const schema: FieldSchema = {
      first_email: {
        type: "string",
        columnName: "metadata",
        jsonPath: ["emails", "0"],
        operators: ["=="],
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "first_email" }, "test@example.com"] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // It should compile the index 0 as an integer ->0, NOT a string ->'0'
      expect(result.value.sql).toBe(`WHERE "metadata"->'emails'->>0 = $1`)
    }
  })

  it("Bug 18: Array parameter type normalization omission in array_op", () => {
    const schema: FieldSchema = {
      birth_dates: {
        type: "array",
        constraints: { arrayOf: "date" },
        operators: ["has_any"],
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const date = new Date("2026-01-01T00:00:00.000Z")
    const result = converter.toSQL({ has_any: [{ var: "birth_dates" }, [date as any]] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // The parameter should be normalized to ISO string: "2026-01-01T00:00:00.000Z"
      expect(result.value.params).toEqual(["2026-01-01T00:00:00.000Z"])
    }
  })

  it("Bug 22: Unary operators accept single argument without array wrapping in validator", () => {
    const schema: FieldSchema = {
      status: {
        type: "string",
        operators: ["is_null"],
        nullable: true,
      }
    }
    const converter = createConverter(schema)
    const result = converter.toSQL({ is_null: { var: "status" } })
    expect(result.ok).toBe(true)
  })

  it("Bug 25: Null check OR-expansion logic is correct (not inverted)", () => {
    const schema: FieldSchema = {
      status: {
        type: "string",
        operators: ["is_null", "is_not_null"],
        nullable: true,
        orColumn: "alt_status",
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    
    const rNull = converter.toSQL({ is_null: [{ var: "status" }] })
    expect(rNull.ok).toBe(true)
    if (rNull.ok) {
      // For is_null, both must be null (AND)
      expect(rNull.value.sql).toBe(`WHERE ("status" IS NULL AND "alt_status" IS NULL)`)
    }

    const rNotNull = converter.toSQL({ is_not_null: [{ var: "status" }] })
    expect(rNotNull.ok).toBe(true)
    if (rNotNull.ok) {
      // For is_not_null, at least one must be not null (OR)
      expect(rNotNull.value.sql).toBe(`WHERE ("status" IS NOT NULL OR "alt_status" IS NOT NULL)`)
    }
  })

  it("Bug 26: Date allowedValues validation matches by time value instead of reference equality", () => {
    const schema: FieldSchema = {
      birth_date: {
        type: "date",
        operators: ["=="],
        constraints: {
          allowedValues: [new Date("2026-01-01T00:00:00.000Z") as any]
        }
      }
    }
    const converter = createConverter(schema)
    // Passes because they represent the same point in time
    const result1 = converter.toSQL({ "==": [{ var: "birth_date" }, new Date("2026-01-01T00:00:00.000Z") as any] })
    expect(result1.ok).toBe(true)
    
    // Fails because date is not in allowedValues
    const result2 = converter.toSQL({ "==": [{ var: "birth_date" }, new Date("2026-01-02T00:00:00.000Z") as any] })
    expect(result2.ok).toBe(false)
  })

  it("Bug 27: between operator rejects when min boundary is greater than max boundary", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: ["between"] }
    }
    const converter = createConverter(schema)
    const result = converter.toSQL({ between: [{ var: "age" }, 30, 10] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].code).toBe("VALUE_OUT_OF_RANGE")
    }
  })

  it("Bug 28: like / contains operators support RHS field references without crashing", () => {
    const schema: FieldSchema = {
      first_name: { type: "string", columnName: "first_name", operators: ["contains", "startsWith"] },
      last_name: { type: "string", columnName: "last_name", operators: ["contains", "startsWith"] },
    }
    
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ contains: [{ var: "first_name" }, { var: "last_name" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sql).toBe(`WHERE "first_name" LIKE '%' || "last_name" || '%'`)
    }

    const converterMy = createConverter(schema, { dialect: "mysql" })
    const resultMy = converterMy.toSQL({ startsWith: [{ var: "first_name" }, { var: "last_name" }] })
    expect(resultMy.ok).toBe(true)
    if (resultMy.ok) {
      expect(resultMy.value.sql).toBe(`WHERE \`first_name\` LIKE CONCAT(\`last_name\`, '%')`)
    }
  })

  it("Bug 29: Array operators has_any/has_all allow comparing arrays of the same type", () => {
    const schema: FieldSchema = {
      roles: { type: "array", constraints: { arrayOf: "string" }, operators: ["has_any"] },
      other_roles: { type: "array", constraints: { arrayOf: "string" }, operators: ["has_any"] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ has_any: [{ var: "roles" }, { var: "other_roles" }] })
    expect(result.ok).toBe(true)
  })

  it("Bug 30: Date field accepts and normalizes Unix/Epoch milliseconds number values", () => {
    const schema: FieldSchema = {
      created_at: { type: "date", operators: ["=="] }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "created_at" }, 1767225600000] }) // 2026-01-01
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.params).toEqual(["2026-01-01T00:00:00.000Z"])
    }
  })

  it("Bug 31: Sort validation rejects non-array sort arguments gracefully instead of crashing", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: ["=="], sortable: true }
    }
    const converter = createConverter(schema, { sort: true })
    const result = converter.toSQL({ "==": [{ var: "age" }, 25] }, "invalid" as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].code).toBe("INVALID_STRUCTURE")
    }
  })

  it("Bug 32 & 33: flattenSchema correctly inherits custom jsonPath from nested parents without duplication", () => {
    const schema: FieldSchema = {
      user: {
        column: "user_data",
        properties: {
          profile: {
            jsonPath: ["info"],
            properties: {
              age: { type: "number", operators: ["=="] }
            }
          }
        }
      },
      audit: {
        columnName: "audit_data",
        jsonPath: ["log"],
        properties: {
          status: { type: "string", operators: ["=="] }
        }
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    
    // Bug 32: age inherits custom jsonPath ["info"] from user.profile
    const result1 = converter.toSQL({ "==": [{ var: "user.profile.age" }, 25] })
    expect(result1.ok).toBe(true)
    if (result1.ok) {
      expect(result1.value.sql).toBe(`WHERE CAST("user_data"->'info'->>'age' AS numeric) = $1`)
    }

    // Bug 33: audit.status does not duplicate ["log"] jsonPath
    const result2 = converter.toSQL({ "==": [{ var: "audit.status" }, "success"] })
    expect(result2.ok).toBe(true)
    if (result2.ok) {
      expect(result2.value.sql).toBe(`WHERE "audit_data"->'log'->>'status' = $1`)
    }
  })

  it("Bug 34: nested validation paths use dot separation instead of direct string concatenation", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: ["=="] }
    }
    const converter = createConverter(schema)
    const result = converter.toSQL({
      and: [
        {
          or: [
            { "==": [{ var: "age" }, "invalid-type"] }
          ]
        }
      ]
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Should be and[0].or[0], not and[0]or[0]
      expect(result.errors[0].path).toBe("and[0].or[0]")
    }
  })

  it("Bug 35: checkDepth does not prepend a leading dot to the root-level path", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: ["=="] }
    }
    const converter = createConverter(schema, { maxDepth: 1 })
    const result = converter.toSQL({
      and: [
        { "==": [{ var: "age" }, 25] }
      ]
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Path should be "and[0]", not ".and[0]"
      expect(result.errors[0].path).toBe("and[0]")
    }
  })

  it("Bug 36 & 37: Equality and list membership operators reject array fields", () => {
    const schema: FieldSchema = {
      roles: { type: "array", constraints: { arrayOf: "string" }, operators: ["==", "in"] }
    }
    const converter = createConverter(schema)
    
    // Bug 36: "in" on array should fail validation because array is not allowed for "in"
    const rIn = converter.toSQL({ in: [{ var: "roles" }, "admin"] })
    expect(rIn.ok).toBe(false)
    if (!rIn.ok) {
      expect(rIn.errors[0].code).toBe("OPERATOR_TYPE_MISMATCH")
    }

    // Bug 37: "==" on array should fail validation because array is not allowed for "=="
    const rEq = converter.toSQL({ "==": [{ var: "roles" }, ["admin"]] })
    expect(rEq.ok).toBe(false)
    if (!rEq.ok) {
      expect(rEq.errors[0].code).toBe("OPERATOR_TYPE_MISMATCH")
    }
  })

  it("Bug 38: SQLite compiles array_op (has_any, has_all, contained_by) using json_each", () => {
    const schema: FieldSchema = {
      roles: { type: "array", constraints: { arrayOf: "string" }, operators: ["has_any", "has_all", "contained_by"] },
      other_roles: { type: "array", constraints: { arrayOf: "string" }, operators: ["has_any", "has_all", "contained_by"] }
    }
    const converter = createConverter(schema, { dialect: "sqlite" })

    // has_any with literals
    const rAny = converter.toSQL({ has_any: [{ var: "roles" }, ["admin", "user"]] })
    expect(rAny.ok).toBe(true)
    if (rAny.ok) {
      expect(rAny.value.sql).toBe(`WHERE EXISTS (SELECT 1 FROM json_each("roles") WHERE value IN (?, ?))`)
    }

    // has_any with field ref
    const rAnyRef = converter.toSQL({ has_any: [{ var: "roles" }, { var: "other_roles" }] })
    expect(rAnyRef.ok).toBe(true)
    if (rAnyRef.ok) {
      expect(rAnyRef.value.sql).toBe(`WHERE EXISTS (SELECT 1 FROM json_each("roles") WHERE value IN (SELECT value FROM json_each("other_roles")))`)
    }

    // contained_by with literals
    const rCont = converter.toSQL({ contained_by: [{ var: "roles" }, ["admin", "user"]] })
    expect(rCont.ok).toBe(true)
    if (rCont.ok) {
      expect(rCont.value.sql).toBe(`WHERE NOT EXISTS (SELECT 1 FROM json_each("roles") WHERE value NOT IN (?, ?))`)
    }

    // has_all with literals
    const rAll = converter.toSQL({ has_all: [{ var: "roles" }, ["admin", "user"]] })
    expect(rAll.ok).toBe(true)
    if (rAll.ok) {
      expect(rAll.value.sql).toBe(`WHERE NOT EXISTS (SELECT value FROM json_each(json_array(?, ?)) WHERE value NOT IN (SELECT value FROM json_each("roles")))`)
    }
  })

  it("Bug 39: MySQL compiles array operations on JSON path with -> instead of ->>", () => {
    const schema: FieldSchema = {
      "user.roles": { type: "array", columnName: "metadata", jsonPath: ["roles"], operators: ["has_any"] },
      "user.other_roles": { type: "array", columnName: "metadata", jsonPath: ["other_roles"], operators: ["has_any"] }
    }
    const converter = createConverter(schema, { dialect: "mysql" })
    const result = converter.toSQL({ has_any: [{ var: "user.roles" }, { var: "user.other_roles" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Should compile using `->`, not `->>`
      expect(result.value.sql).toBe("WHERE JSON_OVERLAPS(`metadata`->'$.\"roles\"', `metadata`->'$.\"other_roles\"')")
    }
  })

  it("Bug 40: Null checking on JSON array paths uses unquoted extraction across all dialects", () => {
    const schema: FieldSchema = {
      roles: { type: "array", columnName: "metadata", jsonPath: ["roles"], operators: ["is_null"], nullable: true }
    }

    // Postgres
    const convPg = createConverter(schema, { dialect: "postgres" })
    const rPg = convPg.toSQL({ is_null: [{ var: "roles" }] })
    expect(rPg.ok).toBe(true)
    if (rPg.ok) {
      expect(rPg.value.sql).toBe(`WHERE "metadata"->>'roles' IS NULL`)
    }

    // MySQL
    const convMy = createConverter(schema, { dialect: "mysql" })
    const rMy = convMy.toSQL({ is_null: [{ var: "roles" }] })
    expect(rMy.ok).toBe(true)
    if (rMy.ok) {
      expect(rMy.value.sql).toBe("WHERE `metadata`->>'$.\"roles\"' IS NULL")
    }

    // SQLite
    const convSq = createConverter(schema, { dialect: "sqlite" })
    const rSq = convSq.toSQL({ is_null: [{ var: "roles" }] })
    expect(rSq.ok).toBe(true)
    if (rSq.ok) {
      expect(rSq.value.sql).toBe("WHERE \"metadata\" ->> '$.\"roles\"' IS NULL")
    }
  })
})
