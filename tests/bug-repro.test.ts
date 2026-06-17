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
      expect(rSqlite.value.sql).toBe(`WHERE json_type("metadata", '$."' || replace(replace(?, '\\\\', '\\\\\\\\'), '"', '\\\\"') || '"') IS NOT NULL`)
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
      expect(r2.value.sql).toBe('WHERE jsonb_exists_any("metadata", ARRAY[$1, $2])')
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
      expect(r4.value.sql).toBe('WHERE jsonb_exists_any("metadata", ARRAY[?, ?])')
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
})

