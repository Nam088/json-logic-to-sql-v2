import { describe, it, expect } from "vitest"
import { createConverter, toPublicSchema } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Reproduce Bug 1, 2, and 3", () => {
  it("Bug 1: Named parameter format syntax error with dots", () => {
    const schema: FieldSchema = {
      "user.profile.age": {
        type: "number",
        operators: ["=="],
        columnName: "age",
      },
    }
    const converter = createConverter(schema, { dialect: "postgres-named" })
    const result = converter.toSQL({ "==": [{ var: "user.profile.age" }, 25] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.sql).toBe('WHERE "age" = :user_profile_age_1')
    expect(result.value.namedParams).toEqual({ user_profile_age_1: 25 })
  })

  it("Bug 2: Logic bug in OR-expansion with negated operators (should use AND instead of OR)", () => {
    const schema: FieldSchema = {
      status: {
        type: "string",
        operators: ["!=", "not_in"],
      },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "!=": [{ var: "status" }, "active"] }, {
      fieldMappings: {
        status: { column: "status", orColumn: ["sec_status"] },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.sql).toBe('WHERE ("status" != $1 AND "sec_status" != $2)')
  })

  it("Bug 3: Security leak in toPublicSchema (backend mapping fields are exposed)", () => {
    const schema: FieldSchema = {
      email: {
        type: "string",
        column: "secret_email_col",
        orColumn: "alt_email_col",
        sqlExpression: "LOWER(email)",
        orExpression: "LOWER(alt_email)",
        operators: ["=="],
      },
    }
    const publicSchema = toPublicSchema(schema)

    expect(publicSchema.email.column).toBeUndefined()
    expect(publicSchema.email.orColumn).toBeUndefined()
    expect(publicSchema.email.sqlExpression).toBeUndefined()
    expect(publicSchema.email.orExpression).toBeUndefined()
  })

  it("New Bug 1: JSON Path Escaping Defect in MySQL & SQLite (backslash escaping)", () => {
    const jsonSchema: FieldSchema = {
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }
    const sqliteConv = createConverter(jsonSchema, { dialect: "sqlite" })
    const mysqlConv = createConverter(jsonSchema, { dialect: "mysql" })

    // SQLite should compile with nested replace to escape backslashes first, then quotes
    const rSqlite = sqliteConv.toSQL({ json_has_key: [{ var: "metadata" }, "foo\\"] })
    expect(rSqlite.ok).toBe(true)
    if (rSqlite.ok) {
      expect(rSqlite.value.sql).toBe(`WHERE json_type("metadata", '$."' || replace(replace(?, '\\', '\\\\'), '"', '\\"') || '"') IS NOT NULL`)
      expect(rSqlite.value.params).toEqual(["foo\\"])
    }

    // MySQL should compile with nested REPLACE to escape backslashes first, then quotes
    const rMysql = mysqlConv.toSQL({ json_has_key: [{ var: "metadata" }, "foo\\"] })
    expect(rMysql.ok).toBe(true)
    if (rMysql.ok) {
      expect(rMysql.value.sql).toBe(`WHERE JSON_CONTAINS_PATH(\`metadata\`, 'one', CONCAT('$."', REPLACE(REPLACE(?, '\\\\', '\\\\\\\\'), '"', '\\\\"'), '"'))`)
      expect(rMysql.value.params).toEqual(["foo\\"])
    }
  })

  it("New Bug 2: Array Validation Bypass in json_has_key", () => {
    const jsonSchema: FieldSchema = {
      metadata: { type: "array", operators: ["json_has_key"] },
    }
    const converter = createConverter(jsonSchema, { dialect: "postgres" })
    const result = converter.toSQL({ json_has_key: [{ var: "metadata" }, ["profile"]] })
    
    // It should fail validation because the key argument is an array instead of a string
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain("Key name must be a string")
    }
  })

  it("New Bug 3: PostgreSQL json_has_key and json_has_any_keys compiles to jsonb_exists and jsonb_exists_any", () => {
    const jsonSchema: FieldSchema = {
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }
    const pgPositional = createConverter(jsonSchema, { dialect: "postgres" })
    const pgAnonymous = createConverter(jsonSchema, { dialect: "postgres-anonymous" })

    // Positional Dialect
    const r1 = pgPositional.toSQL({ json_has_key: [{ var: "metadata" }, "profile"] })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.value.sql).toBe('WHERE jsonb_exists("metadata", $1)')
    }

    const r2 = pgPositional.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["profile", "settings"]] })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.value.sql).toBe('WHERE jsonb_exists_any("metadata", ARRAY[$1::text, $2::text])')
    }

    // Anonymous Dialect (completely eliminates the ? operator conflict)
    const r3 = pgAnonymous.toSQL({ json_has_key: [{ var: "metadata" }, "profile"] })
    expect(r3.ok).toBe(true)
    if (r3.ok) {
      expect(r3.value.sql).toBe('WHERE jsonb_exists("metadata", ?)')
    }

    const r4 = pgAnonymous.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["profile", "settings"]] })
    expect(r4.ok).toBe(true)
    if (r4.ok) {
      expect(r4.value.sql).toBe('WHERE jsonb_exists_any("metadata", ARRAY[?::text, ?::text])')
    }
  })
})

describe("Security review — newly found bugs (RED phase)", () => {
  // Bug A: `column` property in FieldDef is silently ignored for simple column names
  // when set directly in the schema (not via fieldMappings).
  // resolveRef() only uses def.column when it matches the raw-SQL heuristic /[\s(:]/,
  // so plain identifiers like "actual_status_col" are skipped and the field name is used instead.
  it("Bug A: column property in schema is used as columnName for simple identifiers", () => {
    const schema: FieldSchema = {
      status: {
        type: "string",
        operators: ["=="],
        column: "actual_status_col",
      },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "status" }, "active"] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Currently produces WHERE "status" = $1 (ignores column property)
    expect(result.value.sql).toBe(`WHERE "actual_status_col" = $1`)
  })

  // Bug B: whitespace-only fieldMappings string bypasses validation and produces
  // malformed SQL ("WHERE     = $1") that is invalid in all dialects.
  it("Bug B: whitespace-only fieldMappings value is rejected with an error", () => {
    const schema: FieldSchema = {
      status: { type: "string", operators: ["=="] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "status" }, "active"] }, {
      fieldMappings: { status: "   " },
    })

    // Currently produces ok:true with WHERE     = $1 (invalid SQL)
    expect(result.ok).toBe(false)
  })

  // Bug C: fieldMappings object spread merges ALL FieldDef properties including `operators`,
  // allowing a caller to inject a brand-new field (absent from the original schema) with a
  // full definition. The validator then accepts rules referencing that injected field.
  it("Bug C: fieldMappings object with operators cannot inject new fields absent from schema", () => {
    const schema: FieldSchema = {
      userId: { type: "number", operators: ["=="] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })

    const result = converter.toSQL({
      rule: { "==": [{ var: "injectedField" }, "anything"] },
      fieldMappings: {
        injectedField: {
          type: "string",
          operators: ["=="],  // attacker provides a complete field definition
        },
      },
    })

    // injectedField is not in the original schema — should be rejected
    // even when fieldMappings provides a full definition with operators
    expect(result.ok).toBe(false)
  })

  it("Bug D: fieldMappings object with whitespace-only orColumn or sqlExpression is rejected", () => {
    const schema: FieldSchema = {
      status: { type: "string", operators: ["=="] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    
    const resOrColumn = converter.toSQL({ "==": [{ var: "status" }, "active"] }, {
      fieldMappings: { status: { column: "status", orColumn: "   " } },
    })
    expect(resOrColumn.ok).toBe(false)
    if (!resOrColumn.ok) {
      expect(resOrColumn.errors[0].path).toBe("fieldMappings.status.orColumn")
    }

    const resOrColumnArray = converter.toSQL({ "==": [{ var: "status" }, "active"] }, {
      fieldMappings: { status: { column: "status", orColumn: ["status_2", "  "] } },
    })
    expect(resOrColumnArray.ok).toBe(false)
    if (!resOrColumnArray.ok) {
      expect(resOrColumnArray.errors[0].path).toBe("fieldMappings.status.orColumn[1]")
    }

    const resSqlExpr = converter.toSQL({ "==": [{ var: "status" }, "active"] }, {
      fieldMappings: { status: { sqlExpression: "   " } },
    })
    expect(resSqlExpr.ok).toBe(false)
    if (!resSqlExpr.ok) {
      expect(resSqlExpr.errors[0].path).toBe("fieldMappings.status.sqlExpression")
    }
  })

  it("Bug E: Extended ISO year without timezone is rejected in date normalizer", () => {
    const schema: FieldSchema = {
      created_at: { type: "date", operators: ["=="] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    
    // Extended year + time, but no timezone
    const result = converter.toSQL({ "==": [{ var: "created_at" }, "+010000-01-01T00:00:00"] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].code).toBe("VALUE_FORMAT_INVALID")
    }

    // Extended year + time WITH timezone -> OK
    const resultOk = converter.toSQL({ "==": [{ var: "created_at" }, "+010000-01-01T00:00:00Z"] })
    expect(resultOk.ok).toBe(true)
  })

  it("covers non-JSON Postgres array_op with mixed literals and field references", () => {
    const arraySchema: FieldSchema = {
      tags: { type: "array", operators: ["has_any"] },
      other_tag: { type: "string", operators: ["=="] },
    }
    const converter = createConverter(arraySchema, { dialect: "postgres" })
    const result = converter.toSQL({
      has_any: [{ var: "tags" }, ["VIP", { var: "other_tag" }]],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sql).toBe('WHERE "tags" && ARRAY[$1, "other_tag"]')
      expect(result.value.params).toEqual(["VIP"])
    }
  })

  it("Bug F: inherits internal table/alias for nested fields", () => {
    const schema: FieldSchema = {
      user: {
        column: "user_data",
        internal: { table: "users", alias: "u" },
        properties: {
          age: { type: "number", operators: ["=="] }
        }
      }
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ "==": [{ var: "user.age" }, 25] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sql).toBe('WHERE CAST("u"."user_data"->>\'age\' AS numeric) = $1')
    }
  })

  it("Bug G: compiles has_any comparing JSON array with native array without crashing", () => {
    const schema: FieldSchema = {
      "user.roles": { type: "array", columnName: "metadata", jsonPath: ["roles"], operators: ["has_any"] },
      other_roles: { type: "array", operators: ["has_any"] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ has_any: [{ var: "user.roles" }, { var: "other_roles" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sql).toBe('WHERE jsonb_exists_any("metadata"->\'roles\', "other_roles")')
    }
  })

  it("Bug I: compiles has_any comparing native array with JSON array in Postgres without crashing", () => {
    const schema: FieldSchema = {
      tags: { type: "array", operators: ["has_any"] },
      "user.tags": { type: "array", columnName: "metadata", jsonPath: ["tags"], operators: ["has_any"] },
    }
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({ has_any: [{ var: "tags" }, { var: "user.tags" }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sql).toBe('WHERE "tags" && ARRAY(SELECT jsonb_array_elements_text("metadata"->\'tags\'))')
    }
  })

  describe("Newly identified 10 bugs (RED phase)", () => {
    it("Bug 1: MySQL & MSSQL cast to DECIMAL(18, 6) instead of DECIMAL to avoid float truncation", () => {
      const schema: FieldSchema = {
        "user.age": { type: "number", columnName: "user_data", jsonPath: ["profile", "age"], operators: ["=="] }
      }
      const mysqlConv = createConverter(schema, { dialect: "mysql" })
      const mssqlConv = createConverter(schema, { dialect: "mssql" })

      const rMysql = mysqlConv.toSQL({ "==": [{ var: "user.age" }, 25.5] })
      expect(rMysql.ok).toBe(true)
      if (rMysql.ok) {
        expect(rMysql.value.sql).toBe("WHERE CAST(`user_data`->>'$.\"profile\".\"age\"' AS DECIMAL(18, 6)) = ?")
      }

      const rMssql = mssqlConv.toSQL({ "==": [{ var: "user.age" }, 25.5] })
      expect(rMssql.ok).toBe(true)
      if (rMssql.ok) {
        expect(rMssql.value.sql).toBe("WHERE CAST(JSON_VALUE([user_data], '$.\"profile\".\"age\"') AS DECIMAL(18, 6)) = ?")
      }
    })

    it("Bug 2: Postgres has_all/contained_by wraps right-side native array with to_jsonb", () => {
      const schema: FieldSchema = {
        "user.roles": { type: "array", columnName: "metadata", jsonPath: ["roles"], operators: ["has_all", "contained_by"] },
        other_roles: { type: "array", operators: ["has_all", "contained_by"] },
      }
      const converter = createConverter(schema, { dialect: "postgres" })

      const r1 = converter.toSQL({ has_all: [{ var: "user.roles" }, { var: "other_roles" }] })
      expect(r1.ok).toBe(true)
      if (r1.ok) {
        expect(r1.value.sql).toBe('WHERE "metadata"->\'roles\' @> to_jsonb("other_roles")')
      }

      const r2 = converter.toSQL({ contained_by: [{ var: "user.roles" }, { var: "other_roles" }] })
      expect(r2.ok).toBe(true)
      if (r2.ok) {
        expect(r2.value.sql).toBe('WHERE "metadata"->\'roles\' <@ to_jsonb("other_roles")')
      }
    })

    it("Bug 3: sort array containing null or primitives does not crash server", () => {
      const schema: FieldSchema = {
        age: { type: "number", operators: ["=="], sortable: true }
      }
      const converter = createConverter(schema, { sort: true })

      const rNull = converter.toSQL({ "==": [{ var: "age" }, 25] }, [null as any])
      expect(rNull.ok).toBe(false)
      if (!rNull.ok) {
        expect(rNull.errors[0].code).toBe("INVALID_STRUCTURE")
      }

      const rStr = converter.toSQL({ "==": [{ var: "age" }, 25] }, ["string_rule" as any])
      expect(rStr.ok).toBe(false)
      if (!rStr.ok) {
        expect(rStr.errors[0].code).toBe("INVALID_STRUCTURE")
      }
    })

    it("Bug 4: flattenSchema ignores null or undefined field definitions without crashing", () => {
      const schema: any = {
        age: { type: "number", operators: ["=="] },
        malformed1: null,
        malformed2: undefined,
        nested: {
          properties: {
            age: { type: "number", operators: ["=="] },
            malformed3: null,
          }
        }
      }
      expect(() => createConverter(schema)).not.toThrow()
      const converter = createConverter(schema)
      expect(converter.toSQL({ "==": [{ var: "age" }, 25] }).ok).toBe(true)
    })

    it("Bug 5: SQLite json_has_key compiles to replace single backslashes in key correctly", () => {
      const schema: FieldSchema = {
        metadata: { type: "array", operators: ["json_has_key"] },
      }
      const converter = createConverter(schema, { dialect: "sqlite" })
      const result = converter.toSQL({ json_has_key: [{ var: "metadata" }, "foo\\bar"] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe(`WHERE json_type("metadata", '$."' || replace(replace(?, '\\', '\\\\'), '"', '\\"') || '"') IS NOT NULL`)
      }
    })

    it("Bug 6: toPublicSchema strips jsonPath to avoid leaking internal DB structures", () => {
      const schema: FieldSchema = {
        "user.age": {
          type: "number",
          columnName: "user_data",
          jsonPath: ["profile", "age"],
          operators: ["=="],
        },
      }
      const pub = toPublicSchema(schema)
      expect(pub["user.age"].jsonPath).toBeUndefined()
    })

    it("Bug 7: between operator validates boundary order for Unix timestamp date values", () => {
      const schema: FieldSchema = {
        created_at: { type: "date", operators: ["between"] },
      }
      const converter = createConverter(schema)
      const result = converter.toSQL({ between: [{ var: "created_at" }, 1767225600000, 1600000000000] })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors[0].code).toBe("VALUE_OUT_OF_RANGE")
      }
    })

    it("Bug 8: Postgres json_has_any_keys casts ARRAY elements to ::text", () => {
      const schema: FieldSchema = {
        metadata: { type: "array", operators: ["json_has_any_keys"] },
      }
      const converter = createConverter(schema, { dialect: "postgres" })
      const result = converter.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["a", "b"]] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe('WHERE jsonb_exists_any("metadata", ARRAY[$1::text, $2::text])')
      }
    })

    it("Bug 9: fieldMappings deep merges internal configuration to retain table/alias", () => {
      const schema: FieldSchema = {
        status: {
          type: "string",
          operators: ["=="],
          internal: { table: "users", alias: "u", column: "status_col" }
        }
      }
      const converter = createConverter(schema)
      const result = converter.toSQL({ "==": [{ var: "status" }, "active"] }, {
        fieldMappings: { status: { internal: { column: "new_status_col" } } }
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe('WHERE "u"."new_status_col" = $1')
      }
    })

    it("Bug 10: verifies null check OR-expansion logic is correct (is_null uses AND, is_not_null uses OR)", () => {
      const schema: FieldSchema = {
        status: { type: "string", operators: ["is_null", "is_not_null"] }
      }
      const converter = createConverter(schema)

      const rNull = converter.toSQL({ is_null: [{ var: "status" }] }, {
        fieldMappings: { status: { column: "status", orColumn: ["sec_status"] } }
      })
      expect(rNull.ok).toBe(true)
      if (rNull.ok) {
        expect(rNull.value.sql).toBe('WHERE ("status" IS NULL AND "sec_status" IS NULL)')
      }

      const rNotNull = converter.toSQL({ is_not_null: [{ var: "status" }] }, {
        fieldMappings: { status: { column: "status", orColumn: ["sec_status"] } }
      })
      expect(rNotNull.ok).toBe(true)
      if (rNotNull.ok) {
        expect(rNotNull.value.sql).toBe('WHERE ("status" IS NOT NULL OR "sec_status" IS NOT NULL)')
      }
    })
  })
})

