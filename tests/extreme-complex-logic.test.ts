import { describe, it, expect } from "vitest"
import { createConverter, defineOperator, toPublicSchema } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Extreme and Complex Logical Scenarios", () => {
  const extremeSchema: FieldSchema = {
    // Root level fields
    id: { type: "number", operators: ["==", "!=", ">", "<", "in"] },
    active: { type: "boolean", operators: ["=="] },
    birth_date: { type: "date", operators: ["==", "date_within_days"] },

    // Nested structures with duplicates (id exists at root, user.id, user.profile.id)
    user: {
      columnName: "user_data",
      properties: {
        id: { type: "string", operators: ["==", "!="] },
        profile: {
          properties: {
            id: { type: "uuid", operators: ["=="] },
            age: { type: "number", operators: [">=", "<=", "between"] },
            vip: { type: "boolean", operators: ["=="] },
            tags: {
              type: "array",
              operators: ["has_any", "has_all"],
              constraints: { arrayOf: "string" },
            },
            contacts: {
              properties: {
                email: {
                  type: "string",
                  operators: ["==", "contains"],
                  constraints: { pattern: "^[^\\s@]+@drkumo\\.com$" },
                },
                phone: {
                  type: "string",
                  operators: ["==", "startsWith", "regex_match"],
                },
                location: {
                  properties: {
                    coordinates: {
                      properties: {
                        lat: { type: "number", operators: [">", "<"] },
                        lng: { type: "number", operators: [">", "<"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        meta: {
          operators: ["json_has_key", "json_has_any_keys", "is_null", "is_not_null"],
          properties: {
            ip: {
              type: "string",
              operators: ["=="],
              constraints: { format: "ip" },
            },
          },
        },
      },
    },
  }

  // Define a custom regex operator that works differently across dialects
  const regexOperator = defineOperator({
    allowedTypes: ["string"],
    arity: "binary",
    validate: (args) => {
      const pattern = Array.isArray(args[0]) ? args[0][0] : args[0]
      if (typeof pattern !== "string") {
        return "Regex pattern must be a string"
      }
      try {
        new RegExp(pattern)
      } catch {
        return "Invalid regex pattern"
      }
      return true
    },
    compile: (ctx, node, col) => {
      const pattern = node.values[0] as string
      const param = ctx.addParam(pattern, `${node.field}_regex`)

      if (ctx.dialect.name.startsWith("postgres")) {
        return `${col} ~* ${param}`
      }
      if (ctx.dialect.name.startsWith("mysql")) {
        return `${col} REGEXP ${param}`
      }
      if (ctx.dialect.name.startsWith("sqlite")) {
        return `${col} REGEXP ${param}`
      }
      if (ctx.dialect.name.startsWith("mssql")) {
        return `${col} LIKE ${param}`
      }
      return `${col} LIKE ${param}`
    },
  })

  describe("Scenario 1: Mega nested tree with 12+ conditions and alternating gates", () => {
    it("compiles deep nested logical trees cleanly in Postgres", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const logic = {
        and: [
          { "==": [{ var: "active" }, true] },
          {
            or: [
              {
                and: [
                  { ">=": [{ var: "user.profile.age" }, 18] },
                  { "<=": [{ var: "user.profile.age" }, 65] },
                ],
              },
              {
                and: [
                  { "==": [{ var: "user.id" }, "guest_user"] },
                  {
                    "!": {
                      or: [
                        { "==": [{ var: "id" }, 999] },
                        { contains: [{ var: "user.profile.contacts.email" }, "admin"] },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.sql).toBe(
        `WHERE ("active" = $1 AND ((CAST("user_data"->'profile'->>'age' AS numeric) >= $2 AND CAST("user_data"->'profile'->>'age' AS numeric) <= $3) OR ("user_data"->>'id' = $4 AND NOT (("id" = $5 OR "user_data"->'profile'->'contacts'->>'email' LIKE $6)))))`
      )
      expect(result.value.params).toEqual([true, 18, 65, "guest_user", 999, "%admin%"])
    })
  })

  describe("Scenario 2: Deep 5+ levels JSON path traversal across dialects", () => {
    const logic = {
      and: [
        { ">": [{ var: "user.profile.contacts.location.coordinates.lat" }, 10.5] },
        { "<": [{ var: "user.profile.contacts.location.coordinates.lng" }, 106.7] },
      ],
    }

    it("compiles for PostgreSQL", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.sql).toBe(
        `WHERE (CAST("user_data"->'profile'->'contacts'->'location'->'coordinates'->>'lat' AS numeric) > $1 AND CAST("user_data"->'profile'->'contacts'->'location'->'coordinates'->>'lng' AS numeric) < $2)`
      )
      expect(result.value.params).toEqual([10.5, 106.7])
    })

    it("compiles for MySQL", () => {
      const converter = createConverter(extremeSchema, { dialect: "mysql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.sql).toBe(
        "WHERE (CAST(`user_data`->>'$.\"profile\".\"contacts\".\"location\".\"coordinates\".\"lat\"' AS DECIMAL) > ? AND CAST(`user_data`->>'$.\"profile\".\"contacts\".\"location\".\"coordinates\".\"lng\"' AS DECIMAL) < ?)"
      )
      expect(result.value.params).toEqual([10.5, 106.7])
    })

    it("compiles for SQLite", () => {
      const converter = createConverter(extremeSchema, { dialect: "sqlite" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.sql).toBe(
        'WHERE (CAST("user_data" ->> \'$.\"profile\".\"contacts\".\"location\".\"coordinates\".\"lat\"\' AS NUMERIC) > ? AND CAST("user_data" ->> \'$.\"profile\".\"contacts\".\"location\".\"coordinates\".\"lng\"\' AS NUMERIC) < ?)'
      )
      expect(result.value.params).toEqual([10.5, 106.7])
    })

    it("compiles for MSSQL", () => {
      const converter = createConverter(extremeSchema, { dialect: "mssql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.sql).toBe(
        "WHERE (CAST(JSON_VALUE([user_data], '$.\"profile\".\"contacts\".\"location\".\"coordinates\".\"lat\"') AS DECIMAL) > ? AND CAST(JSON_VALUE([user_data], '$.\"profile\".\"contacts\".\"location\".\"coordinates\".\"lng\"') AS DECIMAL) < ?)"
      )
      expect(result.value.params).toEqual([10.5, 106.7])
    })
  })

  describe("Scenario 3: Duplicate key namespacing", () => {
    it("handles root 'id', 'user.id', and 'user.profile.id' in the same query without collisions", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const logic = {
        and: [
          { "==": [{ var: "id" }, 123] },
          { "!=": [{ var: "user.id" }, "user_1"] },
          { "==": [{ var: "user.profile.id" }, "00000000-0000-0000-0000-000000000000"] },
        ],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.sql).toBe(
        `WHERE ("id" = $1 AND "user_data"->>'id' != $2 AND CAST("user_data"->'profile'->>'id' AS uuid) = $3)`
      )
      expect(result.value.params).toEqual([123, "user_1", "00000000-0000-0000-0000-000000000000"])
    })
  })

  describe("Scenario 4: Direct operators on JSONB parent fields", () => {
    it("enforces json_has_key and json_has_any_keys on 'user.meta' while supporting nested properties", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const logic = {
        and: [
          { json_has_key: [{ var: "user.meta" }, "ip"] },
          { "==": [{ var: "user.meta.ip" }, "127.0.0.1"] },
        ],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.sql).toBe(
        `WHERE (("user_data"->'meta' ? $1) AND "user_data"->'meta'->>'ip' = $2)`
      )
      expect(result.value.params).toEqual(["ip", "127.0.0.1"])
    })
  })

  describe("Scenario 5: Advanced custom operators", () => {
    it("compiles custom regex match operator across Postgres and MySQL dialects", () => {
      const pgConv = createConverter(extremeSchema, {
        dialect: "postgres",
        operators: { regex_match: regexOperator },
      })
      const myConv = createConverter(extremeSchema, {
        dialect: "mysql",
        operators: { regex_match: regexOperator },
      })

      const logic = {
        regex_match: [{ var: "user.profile.contacts.phone" }, "^\\+1[0-9]{10}$"],
      }

      const pgRes = pgConv.toSQL(logic)
      expect(pgRes.ok).toBe(true)
      if (!pgRes.ok) return
      expect(pgRes.value.sql).toBe(
        `WHERE "user_data"->'profile'->'contacts'->>'phone' ~* $1`
      )
      expect(pgRes.value.params).toEqual(["^\\+1[0-9]{10}$"])

      const myRes = myConv.toSQL(logic)
      expect(myRes.ok).toBe(true)
      if (!myRes.ok) return
      expect(myRes.value.sql).toBe(
        "WHERE `user_data`->>'$.\"profile\".\"contacts\".\"phone\"' REGEXP ?"
      )
      expect(myRes.value.params).toEqual(["^\\+1[0-9]{10}$"])
    })

    it("rejects invalid regex patterns at validation stage", () => {
      const pgConv = createConverter(extremeSchema, {
        dialect: "postgres",
        operators: { regex_match: regexOperator },
      })

      // Invalid regex (unmatched parentheses)
      const logic = {
        regex_match: [{ var: "user.profile.contacts.phone" }, "([a-z]+"],
      }

      const res = pgConv.toSQL(logic)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.errors[0]?.message).toContain("Invalid regex pattern")
    })
  })

  describe("Scenario 6: Mixed arrays and boundary edge cases", () => {
    it("compiles array operations correctly and runs constraints checks", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const logic = {
        and: [
          { has_any: [{ var: "user.profile.tags" }, ["VIP", "Beta"]] },
          { "==": [{ var: "user.profile.contacts.email" }, "test@drkumo.com"] },
        ],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        `WHERE ("user_data"->'profile'->>'tags' && ARRAY[$1, $2] AND "user_data"->'profile'->'contacts'->>'email' = $3)`
      )
      expect(result.value.params).toEqual(["VIP", "Beta", "test@drkumo.com"])
    })

    it("rejects email value that fails custom pattern validation", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const logic = {
        "==": [{ var: "user.profile.contacts.email" }, "test@gmail.com"], // must end with @drkumo.com
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
    })

    it("rejects invalid IP address for formatted string metadata check", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const logic = {
        "==": [{ var: "user.meta.ip" }, "999.999.999.999"],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
    })
  })

  describe("Scenario 7: Deep Boolean JSON Casting across all dialects", () => {
    const logic = { "==": [{ var: "user.profile.vip" }, false] }

    it("compiles boolean cast in Postgres", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        `WHERE CAST("user_data"->'profile'->>'vip' AS boolean) = $1`
      )
    })

    it("compiles boolean cast in MySQL", () => {
      const converter = createConverter(extremeSchema, { dialect: "mysql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        "WHERE CAST(`user_data`->>'$.\"profile\".\"vip\"' AS SIGNED) = ?"
      )
    })

    it("compiles boolean cast in SQLite", () => {
      const converter = createConverter(extremeSchema, { dialect: "sqlite" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        'WHERE CAST("user_data" ->> \'$."profile"."vip"\' AS INTEGER) = ?'
      )
    })

    it("compiles boolean cast in MSSQL", () => {
      const converter = createConverter(extremeSchema, { dialect: "mssql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        "WHERE CAST(JSON_VALUE([user_data], '$.\"profile\".\"vip\"') AS BIT) = ?"
      )
    })
  })

  describe("Scenario 8: Parameter Index Stress Test (25+ Named Parameters)", () => {
    it("generates unique parameter names for a huge batch of conditions without collisions", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres-named" })
      
      const conditions = Array.from({ length: 26 }, (_, i) => ({
        "==": [{ var: "id" }, i],
      }))
      const logic = { or: conditions }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const keys = Object.keys(result.value.namedParams || {})
      expect(keys).toHaveLength(26)
      expect(keys[0]).toBe("id_1")
      expect(keys[25]).toBe("id_26")
      expect(result.value.namedParams?.["id_26"]).toBe(25)
    })
  })

  describe("Scenario 9: Validation boundaries for Object types", () => {
    it("rejects mathematical comparisons on object-type fields", () => {
      const converter = createConverter(extremeSchema)
      const result = converter.toSQL({ ">": [{ var: "user.profile" }, 10] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("FIELD_NOT_ALLOWED")
      expect(result.errors[0]?.message).toContain("is not allowed")
    })

    it("rejects access to non-existent deep paths", () => {
      const converter = createConverter(extremeSchema)
      const result = converter.toSQL({ "==": [{ var: "user.profile.contacts.nonexistent" }, "test"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("FIELD_NOT_ALLOWED")
    })
  })

  describe("Scenario 10: MSSQL Nested JSON Operators", () => {
    it("compiles json_has_key on nested paths using JSON_QUERY in MSSQL", () => {
      const converter = createConverter(extremeSchema, { dialect: "mssql" })
      const logic = { json_has_key: [{ var: "user.meta" }, "ip"] }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // Since user.meta is a nested path and object, it compiles using JSON_QUERY
      expect(result.value.sql).toBe(
        "WHERE EXISTS (SELECT 1 FROM OPENJSON(JSON_QUERY([user_data], '$.\"meta\"')) WHERE [key] = ?)"
      )
      expect(result.value.params).toEqual(["ip"])
    })
  })

  describe("Scenario 11: Complex Date Interval Custom Operator 'date_within_days'", () => {
    const dateWithinDays = defineOperator({
      allowedTypes: ["date"],
      arity: "variadic",
      validate: (args) => {
        const val = Array.isArray(args[0]) ? args[0] : args
        if (val.length !== 2) return "date_within_days requires a reference date and offset in days"
        const days = Number(val[1])
        if (isNaN(days) || days < 0) return "Days offset must be a non-negative number"
        return true
      },
      compile: (ctx, node, col) => {
        const values = Array.isArray(node.values[0]) ? node.values[0] : node.values
        const refDate = values[0]
        const days = Number(values[1])
        
        const pRef = ctx.addParam(refDate, `${node.field}_ref_date`, "date")
        const pDays = ctx.addParam(days, `${node.field}_days`, "number")

        if (ctx.dialect.name.startsWith("postgres")) {
          return `${col} >= CAST(${pRef} AS timestamp) - ${pDays} * INTERVAL '1 day' AND ${col} <= CAST(${pRef} AS timestamp) + ${pDays} * INTERVAL '1 day'`
        }
        if (ctx.dialect.name.startsWith("mysql")) {
          return `ABS(DATEDIFF(${col}, ${pRef})) <= ${pDays}`
        }
        return `ABS(JULIANDAY(${col}) - JULIANDAY(${pRef})) <= ${pDays}`
      }
    })

    it("compiles interval operations on birth_date in Postgres and MySQL", () => {
      const pgConv = createConverter(extremeSchema, {
        dialect: "postgres",
        operators: { date_within_days: dateWithinDays }
      })
      const myConv = createConverter(extremeSchema, {
        dialect: "mysql",
        operators: { date_within_days: dateWithinDays }
      })

      const logic = { date_within_days: [{ var: "birth_date" }, ["2026-06-17T12:00:00Z", 7]] }

      const pgRes = pgConv.toSQL(logic)
      expect(pgRes.ok).toBe(true)
      if (!pgRes.ok) return
      expect(pgRes.value.sql).toBe(
        `WHERE "birth_date" >= CAST($1 AS timestamp) - $2 * INTERVAL '1 day' AND "birth_date" <= CAST($1 AS timestamp) + $2 * INTERVAL '1 day'`
      )
      expect(pgRes.value.params).toEqual(["2026-06-17T12:00:00.000Z", 7])

      const myRes = myConv.toSQL(logic)
      expect(myRes.ok).toBe(true)
      if (!myRes.ok) return
      expect(myRes.value.sql).toBe(
        "WHERE ABS(DATEDIFF(`birth_date`, ?)) <= ?"
      )
      expect(myRes.value.params).toEqual(["2026-06-17 12:00:00", 7])
    })
  })

  describe("Scenario 12: Truthy/Falsy Primitive Boundaries", () => {
    it("handles boundary checks on numeric fields with 0 and null correctly", () => {
      const converter = createConverter(extremeSchema)
      const logic = { "==": [{ var: "id" }, 0] }
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      expect(result.value?.params).toEqual([0])
    })
  })

  describe("Scenario 13: Strict allowedValues (allowList) validation boundaries", () => {
    const customSchema: FieldSchema = {
      status: {
        type: "string",
        operators: ["==", "in"],
        constraints: {
          allowedValues: [
            { value: "active", label: "Active", icon: "check" },
            { value: "inactive", label: "Inactive", icon: "close" }
          ]
        }
      },
      empty_allowed: {
        type: "string",
        operators: ["=="],
        constraints: {
          allowedValues: []
        }
      },
      mixed_type: {
        type: "number",
        operators: ["==", "in"],
        constraints: {
          allowedValues: [0, 1, 2]
        }
      }
    }

    it("accepts valid values from object allowedValues", () => {
      const converter = createConverter(customSchema)
      const res = converter.toSQL({ "==": [{ var: "status" }, "active"] })
      expect(res.ok).toBe(true)
      expect(res.value?.params).toEqual(["active"])
    })

    it("rejects invalid values from object allowedValues", () => {
      const converter = createConverter(customSchema)
      const res = converter.toSQL({ "==": [{ var: "status" }, "banned"] })
      expect(res.ok).toBe(false)
      expect(res.errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
    })

    it("rejects case mismatch strictly", () => {
      const converter = createConverter(customSchema)
      const res = converter.toSQL({ "==": [{ var: "status" }, "Active"] })
      expect(res.ok).toBe(false)
      expect(res.errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
    })

    it("rejects any value if allowedValues is an empty array", () => {
      const converter = createConverter(customSchema)
      const res = converter.toSQL({ "==": [{ var: "empty_allowed" }, "anything"] })
      expect(res.ok).toBe(false)
      expect(res.errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
    })

    it("validates all array elements when using the 'in' operator", () => {
      const converter = createConverter(customSchema)
      
      const valid = converter.toSQL({ in: [{ var: "mixed_type" }, [0, 2]] })
      expect(valid.ok).toBe(true)

      const invalid = converter.toSQL({ in: [{ var: "mixed_type" }, [0, 1, 3]] })
      expect(invalid.ok).toBe(false)
      expect(invalid.errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
    })

    it("preserves custom properties of allowedValues items (like icon) in public schema", () => {
      const pub = toPublicSchema(customSchema)
      const allowed = pub.status?.constraints?.allowedValues
      expect(allowed).toHaveLength(2)
      expect(allowed?.[0]).toEqual({ value: "active", label: "Active", icon: "check" })
      expect(allowed?.[1]).toEqual({ value: "inactive", label: "Inactive", icon: "close" })
    })

    it("compiles in operator with variables correctly", () => {
      const converter = createConverter(customSchema, { dialect: "postgres" })
      const result = converter.toSQL({ in: [{ var: "status" }, ["active", { var: "empty_allowed" }]] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe('WHERE "status" IN ($1, "empty_allowed")')
      expect(result.value.params).toEqual(["active"])
    })

    it("compiles between operator with variables correctly", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const result = converter.toSQL({
        between: [{ var: "user.profile.age" }, { var: "id" }, 100],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        'WHERE CAST("user_data"->\'profile\'->>\'age\' AS numeric) BETWEEN "id" AND $1'
      )
      expect(result.value.params).toEqual([100])
    })

    it("compiles between operator with multiple variables correctly", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const result = converter.toSQL({
        between: [{ var: "user.profile.age" }, { var: "id" }, { var: "user.profile.age" }],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        'WHERE CAST("user_data"->\'profile\'->>\'age\' AS numeric) BETWEEN "id" AND CAST("user_data"->\'profile\'->>\'age\' AS numeric)'
      )
      expect(result.value.params).toEqual([])
    })

    it("compiles array operators with variables correctly in Postgres", () => {
      const converter = createConverter(extremeSchema, { dialect: "postgres" })
      const result = converter.toSQL({
        has_any: [{ var: "user.profile.tags" }, ["VIP", { var: "user.id" }]],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        'WHERE "user_data"->\'profile\'->>\'tags\' && ARRAY[$1, "user_data"->>\'id\']'
      )
      expect(result.value.params).toEqual(["VIP"])
    })

    it("compiles array operators with variables correctly in MySQL", () => {
      const converter = createConverter(extremeSchema, { dialect: "mysql" })
      const result = converter.toSQL({
        has_any: [{ var: "user.profile.tags" }, ["VIP", { var: "user.id" }]],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        'WHERE JSON_OVERLAPS(`user_data`->>\'$.\"profile\".\"tags\"\', JSON_ARRAY(?, `user_data`->>\'$.\"id\"\'))'
      )
      expect(result.value.params).toEqual(["VIP"])
    })
  })
})
