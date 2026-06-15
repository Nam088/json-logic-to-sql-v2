import { describe, it, expect } from "vitest"
import { createConverter, toPublicSchema } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("New Features Suite", () => {
  describe("Date Validation (min/max) and UUID Format Check", () => {
    const schema: FieldSchema = {
      created_at: {
        type: "date",
        operators: ["==", "between", ">", "<"],
        constraints: {
          min: "2026-01-01T00:00:00.000Z",
          max: "2026-12-31T23:59:59.999Z",
        },
      },
      user_uuid: {
        type: "uuid",
        operators: ["=="],
      },
    }
    const converter = createConverter(schema)

    it("passes when date is within min/max range", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "2026-06-01T12:00:00.000Z"] })
      expect(result.ok).toBe(true)
    })

    it("fails when date is before min date", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "2025-12-31T23:59:59.000Z"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_OUT_OF_RANGE")
    })

    it("fails when date is after max date", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "2027-01-01T00:00:00.000Z"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_OUT_OF_RANGE")
    })

    it("fails when date format is invalid", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "not-a-valid-date"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_TYPE_MISMATCH")
    })

    it("passes with valid UUID on uuid type without manual constraint", () => {
      const result = converter.toSQL({ "==": [{ var: "user_uuid" }, "123e4567-e89b-12d3-a456-426614174000"] })
      expect(result.ok).toBe(true)
    })

    it("fails with invalid UUID format on uuid type", () => {
      const result = converter.toSQL({ "==": [{ var: "user_uuid" }, "not-a-uuid"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
    })
  })

  describe("Custom Regex Pattern & Custom Validate Function", () => {
    const schema: FieldSchema = {
      username: {
        type: "string",
        operators: ["=="],
        constraints: {
          pattern: "^[a-z0-9_]{3,15}$",
        },
      },
      even_number: {
        type: "number",
        operators: ["=="],
        validate: (val) => {
          if (typeof val !== "number" || val % 2 !== 0) {
            return "Value must be an even number"
          }
          return true
        },
      },
    }
    const converter = createConverter(schema)

    it("passes regex pattern matching constraints", () => {
      const result = converter.toSQL({ "==": [{ var: "username" }, "john_doe"] })
      expect(result.ok).toBe(true)
    })

    it("fails when regex pattern does not match", () => {
      const result = converter.toSQL({ "==": [{ var: "username" }, "JohnDoe!"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
    })

    it("passes custom validate function check", () => {
      const result = converter.toSQL({ "==": [{ var: "even_number" }, 42] })
      expect(result.ok).toBe(true)
    })

    it("fails custom validate function check with custom error message", () => {
      const result = converter.toSQL({ "==": [{ var: "even_number" }, 41] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
      expect(result.errors[0]?.message).toBe("Value must be an even number")
    })

    it("strips validate function from toPublicSchema", () => {
      const pub = toPublicSchema(schema)
      expect(pub.even_number).not.toHaveProperty("validate")
      expect(pub.username?.constraints?.pattern).toBe("^[a-z0-9_]{3,15}$")
    })
  })

  describe("Field-to-Field Comparison", () => {
    const schema: FieldSchema = {
      updated_at: { type: "date", operators: [">", "=="] },
      created_at: { type: "date", operators: ["<", "=="] },
      age: { type: "number", operators: [">", "=="] },
      score: { type: "number", operators: [">", "=="] },
      name: { type: "string", operators: ["=="] },
    }
    const converter = createConverter(schema)

    it("compiles field-to-field comparison correctly in Postgres", () => {
      const result = converter.toSQL({ ">": [{ var: "updated_at" }, { var: "created_at" }] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE "updated_at" > "created_at"')
      expect(result.value.params).toEqual([])
    })

    it("fails validation when fields are of incompatible types", () => {
      const result = converter.toSQL({ ">": [{ var: "age" }, { var: "name" }] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("OPERATOR_TYPE_MISMATCH")
      expect(result.errors[0]?.message).toContain("Cannot compare field")
    })

    it("fails validation if right-hand side field is not in schema", () => {
      const result = converter.toSQL({ ">": [{ var: "age" }, { var: "secret_field" }] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("FIELD_NOT_ALLOWED")
      expect(result.errors[0]?.field).toBe("secret_field")
    })
  })

  describe("Pagination Support", () => {
    const schema: FieldSchema = {
      age: { type: "number", operators: [">"] },
    }
    const converter = createConverter(schema)

    it("compiles pagination SQL and parameterizes limit and offset", () => {
      const result = converter.toSQL({ ">": [{ var: "age" }, 18] }, undefined, { limit: 10, offset: 20 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE "age" > $1 LIMIT $2 OFFSET $3')
      expect(result.value.limitSql).toBe("LIMIT $2")
      expect(result.value.offsetSql).toBe("OFFSET $3")
      expect(result.value.params).toEqual([18, 10, 20])
    })

    it("compiles pagination using the options object signature", () => {
      const result = converter.toSQL({ ">": [{ var: "age" }, 18] }, { pagination: { limit: 10, offset: 20 } })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE "age" > $1 LIMIT $2 OFFSET $3')
      expect(result.value.params).toEqual([18, 10, 20])
    })

    it("compiles using a single options object with 'rule'", () => {
      const result = converter.toSQL({
        rule: { ">": [{ var: "age" }, 18] },
        pagination: { limit: 10, offset: 20 },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE "age" > $1 LIMIT $2 OFFSET $3')
      expect(result.value.params).toEqual([18, 10, 20])
    })

    it("compiles using a single options object with 'logic'", () => {
      const result = converter.toSQL({
        logic: { ">": [{ var: "age" }, 18] },
        pagination: { limit: 10, offset: 20 },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE "age" > $1 LIMIT $2 OFFSET $3')
      expect(result.value.params).toEqual([18, 10, 20])
    })

    it("fails when limit is negative", () => {
      const result = converter.toSQL({ ">": [{ var: "age" }, 18] }, undefined, { limit: -5 })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("INVALID_STRUCTURE")
      expect(result.errors[0]?.path).toBe("pagination.limit")
    })

    it("fails when offset is not an integer", () => {
      const result = converter.toSQL({ ">": [{ var: "age" }, 18] }, undefined, { limit: 10, offset: 5.5 })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("INVALID_STRUCTURE")
      expect(result.errors[0]?.path).toBe("pagination.offset")
    })
  })

  describe("MySQL Dialect", () => {
    const schema: FieldSchema = {
      name: { type: "string", operators: ["==", "ilike"] },
      tags: { type: "array", operators: ["has_any", "has_all"] },
    }
    const converter = createConverter(schema, { dialect: "mysql" })

    it("uses backticks for quoteIdentifier and ? for parameters", () => {
      const result = converter.toSQL({ "==": [{ var: "name" }, "Alice"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe("WHERE `name` = ?")
      expect(result.value.params).toEqual(["Alice"])
    })

    it("compiles MySQL JSON_OVERLAPS for array has_any operation", () => {
      const result = converter.toSQL({ has_any: [{ var: "tags" }, ["admin", "editor"]] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe("WHERE JSON_OVERLAPS(`tags`, JSON_ARRAY(?, ?))")
      expect(result.value.params).toEqual(["admin", "editor"])
    })

    it("compiles MySQL JSON_CONTAINS for array has_all operation", () => {
      const result = converter.toSQL({ has_all: [{ var: "tags" }, ["admin", "editor"]] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe("WHERE JSON_CONTAINS(`tags`, JSON_ARRAY(?, ?))")
      expect(result.value.params).toEqual(["admin", "editor"])
    })

    it("simulates ilike using LOWER() and LIKE", () => {
      const result = converter.toSQL({ ilike: [{ var: "name" }, "%alice%"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe("WHERE LOWER(`name`) LIKE LOWER(?)")
      expect(result.value.params).toEqual(["%alice%"])
    })
  })

  describe("SQLite Dialect", () => {
    const schema: FieldSchema = {
      name: { type: "string", operators: ["=="] },
      tags: { type: "array", operators: ["has_any"] },
    }
    const converter = createConverter(schema, { dialect: "sqlite" })

    it("uses double quotes and ? for parameters", () => {
      const result = converter.toSQL({ "==": [{ var: "name" }, "Alice"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE "name" = ?')
    })

    it("throws compilation error on array operation (not supported by SQLite)", () => {
      const result = converter.toSQL({ has_any: [{ var: "tags" }, ["admin"]] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.message).toContain("not supported by SQLite dialect")
    })
  })

  describe("JSON Path Querying Dialect Compilation", () => {
    const jsonSchema: FieldSchema = {
      "user.profile.age": {
        type: "number",
        operators: [">", "=="],
        columnName: "user",
        jsonPath: ["profile", "age"],
      },
      "user.profile.vip": {
        type: "boolean",
        operators: ["=="],
        columnName: "user",
        jsonPath: ["profile", "vip"],
      },
      "user.profile.name": {
        type: "string",
        operators: ["=="],
        columnName: "user",
        jsonPath: ["profile", "name"],
      },
    }

    it("compiles JSON paths and casts in PostgreSQL", () => {
      const converter = createConverter(jsonSchema, { dialect: "postgres" })
      const result = converter.toSQL({ ">": [{ var: "user.profile.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE CAST("user"->'profile'->>'age' AS numeric) > $1`)
      expect(result.value.params).toEqual([25])

      const resultBool = converter.toSQL({ "==": [{ var: "user.profile.vip" }, true] })
      expect(resultBool.ok).toBe(true)
      if (!resultBool.ok) return
      expect(resultBool.value.sql).toBe(`WHERE CAST("user"->'profile'->>'vip' AS boolean) = $1`)
    })

    it("compiles JSON paths and casts in MySQL", () => {
      const converter = createConverter(jsonSchema, { dialect: "mysql" })
      const result = converter.toSQL({ ">": [{ var: "user.profile.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE CAST(\`user\`->>'$."profile"."age"' AS DECIMAL) > ?`)
      expect(result.value.params).toEqual([25])

      const resultBool = converter.toSQL({ "==": [{ var: "user.profile.vip" }, true] })
      expect(resultBool.ok).toBe(true)
      if (!resultBool.ok) return
      expect(resultBool.value.sql).toBe(`WHERE CAST(\`user\`->>'$."profile"."vip"' AS SIGNED) = ?`)
    })

    it("compiles JSON paths and casts in SQLite", () => {
      const converter = createConverter(jsonSchema, { dialect: "sqlite" })
      const result = converter.toSQL({ ">": [{ var: "user.profile.age" }, 25] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE CAST("user" ->> '$."profile"."age"' AS NUMERIC) > ?`)
      expect(result.value.params).toEqual([25])
    })
  })

  describe("contained_by, json_has_key, json_has_any_keys Dialect Compilation", () => {
    const customSchema: FieldSchema = {
      tags: { type: "array", operators: ["contained_by"] },
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }

    it("compiles contained_by, json_has_key, json_has_any_keys in PostgreSQL", () => {
      const converter = createConverter(customSchema, { dialect: "postgres" })

      const r1 = converter.toSQL({ contained_by: [{ var: "tags" }, ["t1", "t2"]] })
      expect(r1.ok).toBe(true)
      if (r1.ok) {
        expect(r1.value.sql).toBe(`WHERE "tags" <@ ARRAY[$1, $2]`)
        expect(r1.value.params).toEqual(["t1", "t2"])
      }

      const r2 = converter.toSQL({ json_has_key: [{ var: "metadata" }, "profile"] })
      expect(r2.ok).toBe(true)
      if (r2.ok) {
        expect(r2.value.sql).toBe(`WHERE ("metadata" ? $1)`)
        expect(r2.value.params).toEqual(["profile"])
      }

      const r3 = converter.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["profile", "settings"]] })
      expect(r3.ok).toBe(true)
      if (r3.ok) {
        expect(r3.value.sql).toBe(`WHERE ("metadata" ?| ARRAY[$1, $2])`)
        expect(r3.value.params).toEqual(["profile", "settings"])
      }
    })

    it("compiles contained_by, json_has_key, json_has_any_keys in MySQL", () => {
      const converter = createConverter(customSchema, { dialect: "mysql" })

      const r1 = converter.toSQL({ contained_by: [{ var: "tags" }, ["t1", "t2"]] })
      expect(r1.ok).toBe(true)
      if (r1.ok) {
        expect(r1.value.sql).toBe(`WHERE JSON_CONTAINS(JSON_ARRAY(?, ?), \`tags\`)`)
      }

      const r2 = converter.toSQL({ json_has_key: [{ var: "metadata" }, "profile"] })
      expect(r2.ok).toBe(true)
      if (r2.ok) {
        expect(r2.value.sql).toBe(`WHERE JSON_CONTAINS_PATH(\`metadata\`, 'one', CONCAT('$."', REPLACE(?, '"', '\\\\"'), '"'))`)
      }

      const r3 = converter.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["profile", "settings"]] })
      expect(r3.ok).toBe(true)
      if (r3.ok) {
        expect(r3.value.sql).toBe(
          `WHERE JSON_CONTAINS_PATH(\`metadata\`, 'one', CONCAT('$."', REPLACE(?, '"', '\\\\"'), '"'), CONCAT('$."', REPLACE(?, '"', '\\\\"'), '"'))`
        )
      }
    })

    it("compiles and handles contained_by, json_has_key, json_has_any_keys in SQLite", () => {
      const converter = createConverter(customSchema, { dialect: "sqlite" })

      const r1 = converter.toSQL({ contained_by: [{ var: "tags" }, ["t1"]] })
      expect(r1.ok).toBe(false)

      const r2 = converter.toSQL({ json_has_key: [{ var: "metadata" }, "profile"] })
      expect(r2.ok).toBe(true)
      if (r2.ok) {
        expect(r2.value.sql).toBe(`WHERE json_type("metadata", '$."' || replace(?, '"', '\\"') || '"') IS NOT NULL`)
      }

      const r3 = converter.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["profile", "settings"]] })
      expect(r3.ok).toBe(true)
      if (r3.ok) {
        expect(r3.value.sql).toBe(
          `WHERE (json_type("metadata", '$."' || replace(?, '"', '\\"') || '"') IS NOT NULL OR json_type("metadata", '$."' || replace(?, '"', '\\"') || '"') IS NOT NULL)`
        )
      }
    })
  })

  describe("MSSQL Dialect", () => {
    const schema: FieldSchema = {
      name: { type: "string", operators: ["==", "ilike"] },
      tags: { type: "array", operators: ["has_any"] },
      "user.profile.age": {
        type: "number",
        operators: [">", "=="],
        columnName: "metadata",
        jsonPath: ["profile", "age"],
      },
      "user.profile.vip": {
        type: "boolean",
        operators: ["=="],
        columnName: "metadata",
        jsonPath: ["profile", "vip"],
      },
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }

    it("uses square brackets and ? or named parameters", () => {
      const converter = createConverter(schema, { dialect: "mssql" })
      const result = converter.toSQL({ "==": [{ var: "name" }, "Alice"] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe("WHERE [name] = ?")
        expect(result.value.params).toEqual(["Alice"])
      }

      const namedConverter = createConverter(schema, { dialect: "mssql-named" })
      const namedResult = namedConverter.toSQL({ "==": [{ var: "name" }, "Alice"] })
      expect(namedResult.ok).toBe(true)
      if (namedResult.ok) {
        expect(namedResult.value.sql).toBe("WHERE [name] = @name_1")
        expect(namedResult.value.namedParams).toEqual({ name_1: "Alice" })
      }
    })

    it("compiles JSON paths and casts in MSSQL", () => {
      const converter = createConverter(schema, { dialect: "mssql" })
      const result = converter.toSQL({ ">": [{ var: "user.profile.age" }, 25] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe(`WHERE CAST(JSON_VALUE([metadata], '$."profile"."age"') AS DECIMAL) > ?`)
      }

      const resultBool = converter.toSQL({ "==": [{ var: "user.profile.vip" }, true] })
      expect(resultBool.ok).toBe(true)
      if (resultBool.ok) {
        expect(resultBool.value.sql).toBe(`WHERE CAST(JSON_VALUE([metadata], '$."profile"."vip"') AS BIT) = ?`)
      }
    })

    it("compiles json_has_key and json_has_any_keys in MSSQL", () => {
      const converter = createConverter(schema, { dialect: "mssql" })

      const resultKey = converter.toSQL({ json_has_key: [{ var: "metadata" }, "profile"] })
      expect(resultKey.ok).toBe(true)
      if (resultKey.ok) {
        expect(resultKey.value.sql).toBe(`WHERE EXISTS (SELECT 1 FROM OPENJSON([metadata]) WHERE [key] = ?)`)
      }

      const resultKeys = converter.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["profile", "settings"]] })
      expect(resultKeys.ok).toBe(true)
      if (resultKeys.ok) {
        expect(resultKeys.value.sql).toBe(
          `WHERE (EXISTS (SELECT 1 FROM OPENJSON([metadata]) WHERE [key] = ?) OR EXISTS (SELECT 1 FROM OPENJSON([metadata]) WHERE [key] = ?))`
        )
      }
    })

    it("throws compilation error on array operation (not supported by MSSQL)", () => {
      const converter = createConverter(schema, { dialect: "mssql" })
      const result = converter.toSQL({ has_any: [{ var: "tags" }, ["admin"]] })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors[0]?.message).toContain("not supported by MSSQL dialect")
      }
    })
  })

  describe("JSON Path with Special Characters Compilation", () => {
    const specialSchema: FieldSchema = {
      "user.special.field": {
        type: "string",
        operators: ["=="],
        columnName: "metadata",
        jsonPath: ["profile.test", "hello[world]", "escape'd", "double\"quote", "slash\\test"],
      },
    }

    it("compiles special characters in Postgres", () => {
      const converter = createConverter(specialSchema, { dialect: "postgres" })
      const result = converter.toSQL({ "==": [{ var: "user.special.field" }, "value"] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe(`WHERE "metadata"->'profile.test'->'hello[world]'->'escape''d'->'double"quote'->>'slash\\test' = $1`)
      }
    })

    it("compiles special characters in SQLite", () => {
      const converter = createConverter(specialSchema, { dialect: "sqlite" })
      const result = converter.toSQL({ "==": [{ var: "user.special.field" }, "value"] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe(`WHERE "metadata" ->> '$."profile.test"."hello[world]"."escape''d"."double\\"quote"."slash\\\\test"' = ?`)
      }
    })

    it("compiles special characters in MySQL", () => {
      const converter = createConverter(specialSchema, { dialect: "mysql" })
      const result = converter.toSQL({ "==": [{ var: "user.special.field" }, "value"] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe(`WHERE \`metadata\`->>'$."profile.test"."hello[world]"."escape''d"."double\\"quote"."slash\\\\test"' = ?`)
      }
    })

    it("compiles special characters in MSSQL", () => {
      const converter = createConverter(specialSchema, { dialect: "mssql" })
      const result = converter.toSQL({ "==": [{ var: "user.special.field" }, "value"] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.sql).toBe(
          "WHERE JSON_VALUE([metadata], '$.\"profile.test\".\"hello[world]\".\"escape''d\".\"double\"\"quote\".\"slash\\test\"') = ?"
        )
      }
    })
  })
})
