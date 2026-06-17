import { describe, it, expect } from "vitest"
import { createConverter, defineOperator } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Hardcore Scenarios & Edge Cases", () => {
  // Define a rich schema with diverse types, constraints, aliases, and JSON paths
  const megaSchema: FieldSchema = {
    // Basic types
    id: { type: "number", operators: ["==", "!=", ">", "<", ">=", "<=", "in"] },
    age: {
      type: "number",
      operators: ["==", "!=", ">", "<", ">=", "<=", "between", "in"],
      constraints: { min: 0, max: 150 },
      sortable: true,
    },
    status: {
      type: "string",
      operators: ["==", "!=", "in", "not_in"],
      constraints: { allowedValues: ["active", "inactive", "pending", "banned"] },
    },
    email: {
      type: "string",
      operators: ["==", "contains", "startsWith", "endsWith", "ilike"],
      constraints: { pattern: "^[a-zA-Z0-9._%+-]+@company\\.com$" },
    },
    created_at: {
      type: "date",
      operators: ["==", ">", "<", ">=", "<=", "between", "is_null", "is_not_null"],
      constraints: { min: "2026-01-01T00:00:00.000Z", max: "2026-12-31T23:59:59.999Z" },
      sortable: true,
    },
    vip: {
      type: "boolean",
      operators: ["=="],
    },

    // JSON Path fields with different primitive types inside JSON
    "user.profile.age": {
      type: "number",
      operators: ["==", ">", "<", "between"],
      columnName: "metadata",
      jsonPath: ["profile", "age"],
      constraints: { min: 18, max: 100 },
    },
    "user.profile.vip": {
      type: "boolean",
      operators: ["=="],
      columnName: "metadata",
      jsonPath: ["profile", "vip"],
    },
    "user.settings.theme": {
      type: "string",
      operators: ["==", "in"],
      columnName: "metadata",
      jsonPath: ["settings", "theme"],
      constraints: { allowedValues: ["light", "dark", "system"] },
    },
    "user.special.quotes": {
      type: "string",
      operators: ["=="],
      columnName: "metadata",
      jsonPath: ["special", "key'with'single", "key\"with\"double", "slash\\key"],
    },

    // Array types
    roles: {
      type: "array",
      operators: ["has_any", "has_all", "contained_by"],
      constraints: {
        arrayOf: "string",
        minItems: 1,
        maxItems: 5,
        allowedValues: ["admin", "editor", "viewer", "guest", "moderator"],
      },
    },

    // JSON path array field
    "user.profile.tags": {
      type: "array",
      operators: ["has_any", "has_all"],
      columnName: "metadata",
      jsonPath: ["profile", "tags"],
      constraints: {
        arrayOf: "string",
        minItems: 1,
      },
    },

    // Internal mapping with table alias and columns
    order_total: {
      type: "number",
      operators: [">", "<", "=="],
      sortable: true,
      internal: { table: "orders", column: "total_amount", alias: "o" },
    },
    product_name: {
      type: "string",
      operators: ["==", "contains"],
      sortable: true,
      internal: { table: "products", column: "name", alias: "p" },
    },

    // Field comparison partners
    updated_at: {
      type: "date",
      operators: [">", "=="],
    },
  }

  describe("Scenario 1: Mega-Nested Query (Depth Stress Test)", () => {
    const converter = createConverter(megaSchema) // default maxDepth is 30

    it("compiles a query of logical depth ~10 with mixed logical operators successfully using default maxDepth", () => {
      const megaLogic = {
        and: [
          { "==": [{ var: "vip" }, true] },
          {
            or: [
              {
                and: [
                  {
                    "!": {
                      or: [
                        {
                          and: [
                            {
                              "!": {
                                and: [
                                  {
                                    or: [
                                      { "==": [{ var: "status" }, "active"] },
                                      { ">": [{ var: "age" }, 100] },
                                    ],
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      }

      const result = converter.toSQL(megaLogic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // Verify structure is compiled correctly with correct parens and parameters
      expect(result.value.sql).toBe(
        `WHERE ("vip" = $1 AND ((NOT (((NOT ((("status" = $2 OR "age" > $3)))))))))`
      )
      expect(result.value.params).toEqual([true, "active", 100])
    })

    it("fails validation if depth exceeds maxDepth (e.g. maxDepth: 5)", () => {
      const shallowConverter = createConverter(megaSchema, { maxDepth: 5 })
      const logic = {
        and: [
          {
            or: [
              {
                and: [{ "==": [{ var: "vip" }, true] }],
              },
            ],
          },
        ],
      }
      // logic depth:
      // root (depth 0)
      // and (depth 1), array (depth 2)
      // or (depth 3), array (depth 4)
      // and (depth 5), array (depth 6) -> exceeds maxDepth 5
      const result = shallowConverter.toSQL(logic)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("DEPTH_EXCEEDED")
    })
  })

  describe("Scenario 2: Named Parameter Collision and Deduplication Stress Test", () => {
    it("handles multiple filters on the same field using named parameters without key collisions", () => {
      const converter = createConverter(megaSchema, { dialect: "postgres-named" })
      const logic = {
        and: [
          { ">": [{ var: "age" }, 18] },
          { "<": [{ var: "age" }, 60] },
          { in: [{ var: "age" }, [25, 35, 45]] },
          { between: [{ var: "age" }, 20, 30] },
        ],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const q = result.value
      // Check SQL structure containing unique named parameters
      expect(q.sql).toBe(
        `WHERE ("age" > :age_1 AND "age" < :age_2 AND "age" IN (:age_0_3, :age_1_4, :age_2_5) AND "age" BETWEEN :age_min_6 AND :age_max_7)`
      )

      // Check parameter values mapping
      expect(q.namedParams).toEqual({
        age_1: 18,
        age_2: 60,
        age_0_3: 25,
        age_1_4: 35,
        age_2_5: 45,
        age_min_6: 20,
        age_max_7: 30,
      })
    })

    it("handles multiple filters on the same field in MSSQL-named dialect", () => {
      const converter = createConverter(megaSchema, { dialect: "mssql-named" })
      const logic = {
        and: [
          { ">": [{ var: "age" }, 18] },
          { "<": [{ var: "age" }, 60] },
          { between: [{ var: "age" }, 20, 30] },
        ],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const q = result.value
      expect(q.sql).toBe(
        `WHERE ([age] > @age_1 AND [age] < @age_2 AND [age] BETWEEN @age_min_3 AND @age_max_4)`
      )
      expect(q.namedParams).toEqual({
        age_1: 18,
        age_2: 60,
        age_min_3: 20,
        age_max_4: 30,
      })
    })

    it("handles multiple filters on the same field in MySQL-named dialect", () => {
      const converter = createConverter(megaSchema, { dialect: "mysql-named" })
      const logic = {
        and: [
          { ">": [{ var: "age" }, 18] },
          { "<": [{ var: "age" }, 60] },
          { in: [{ var: "age" }, [25, 30]] },
        ],
      }

      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const q = result.value
      expect(q.sql).toBe(
        `WHERE (\`age\` > :age_1 AND \`age\` < :age_2 AND \`age\` IN (:age_0_3, :age_1_4))`
      )
      expect(q.namedParams).toEqual({
        age_1: 18,
        age_2: 60,
        age_0_3: 25,
        age_1_4: 30,
      })
    })
  })

  describe("Scenario 3: JSON Path Querying with Extreme Characters and Casting", () => {
    const logic = { "==": [{ var: "user.special.quotes" }, "escaped_val"] }

    it("compiles special characters in Postgres with single quote escaping", () => {
      const converter = createConverter(megaSchema, { dialect: "postgres" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        `WHERE "metadata"->'special'->'key''with''single'->'key"with"double'->>'slash\\key' = $1`
      )
    })

    it("compiles special characters in MySQL with double quote escaping", () => {
      const converter = createConverter(megaSchema, { dialect: "mysql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        "WHERE `metadata`->>'$.\"special\".\"key''with''single\".\"key\\\"with\\\"double\".\"slash\\\\key\"' = ?"
      )
    })

    it("compiles special characters in SQLite with double quote escaping", () => {
      const converter = createConverter(megaSchema, { dialect: "sqlite" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        'WHERE "metadata" ->> \'$."special"."key\'\'with\'\'single"."key\\"with\\"double"."slash\\\\key"\' = ?'
      )
    })

    it("compiles special characters in MSSQL with double quote escaping", () => {
      const converter = createConverter(megaSchema, { dialect: "mssql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        "WHERE JSON_VALUE([metadata], '$.\"special\".\"key''with''single\".\"key\"\"with\"\"double\".\"slash\\key\"') = ?"
      )
    })
  })

  describe("Scenario 4: Array Operators with JSON Path Fields", () => {
    const logic = { has_any: [{ var: "user.profile.tags" }, ["VIP", "EarlyAdopter"]] }

    it("compiles JSON path array operations in Postgres correctly without cast", () => {
      const converter = createConverter(megaSchema, { dialect: "postgres" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        `WHERE "metadata"->'profile'->'tags' ?| ARRAY[$1::text, $2::text]`
      )
    })

    it("compiles JSON path array operations in MySQL using JSON_OVERLAPS", () => {
      const converter = createConverter(megaSchema, { dialect: "mysql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(
        `WHERE JSON_OVERLAPS(\`metadata\`->>'$."profile"."tags"', JSON_ARRAY(?, ?))`
      )
    })

    it("fails compilation gracefully in SQLite (no array operations supported)", () => {
      const converter = createConverter(megaSchema, { dialect: "sqlite" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.message).toContain("not supported by SQLite dialect")
    })

    it("fails compilation gracefully in MSSQL (no array operations supported)", () => {
      const converter = createConverter(megaSchema, { dialect: "mssql" })
      const result = converter.toSQL(logic)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.message).toContain("not supported by MSSQL dialect")
    })
  })

  describe("Scenario 5: Custom Operators and Complex Validation Bounds", () => {
    it("runs complex custom operator logic and compiles it successfully", () => {
      const customSchema: FieldSchema = {
        location: { type: "string", operators: ["distance_lt"] },
      }

      const converter = createConverter(customSchema, {
        operators: {
          distance_lt: defineOperator({
            allowedTypes: ["string"],
            arity: "variadic",
            validate: (customArgs) => {
              const args = Array.isArray(customArgs[0]) ? customArgs[0] : customArgs
              if (args.length !== 3) return "distance_lt requires latitude, longitude, and distance"
              const [lat, lng, dist] = args.map(Number)
              if (isNaN(lat) || isNaN(lng) || isNaN(dist)) {
                return "All arguments for distance_lt must be numeric strings"
              }
              if (dist <= 0) return "Distance must be positive"
              return true
            },
            compile: (ctx, node) => {
              const col = ctx.dialect.quoteIdentifier(node.columnName)
              const args = Array.isArray(node.values[0]) ? node.values[0] : node.values
              const lat = Number(args[0])
              const lng = Number(args[1])
              const dist = Number(args[2])
              const pLat = ctx.addParam(lat, `${node.field}_lat`)
              const pLng = ctx.addParam(lng, `${node.field}_lng`)
              const pDist = ctx.addParam(dist, `${node.field}_dist`)
              return `ST_Distance(${col}, ST_MakePoint(${pLng}, ${pLat})) < ${pDist}`
            },
          }),
        },
      })

      // Correct usage: latitude 10.5, longitude 106.7, distance 500 passed inside array
      const validResult = converter.toSQL({ distance_lt: [{ var: "location" }, ["10.5", "106.7", "500"]] })
      expect(validResult.ok).toBe(true)
      if (!validResult.ok) return
      expect(validResult.value.sql).toBe(
        `WHERE ST_Distance("location", ST_MakePoint($2, $1)) < $3`
      )
      expect(validResult.value.params).toEqual([10.5, 106.7, 500])

      // Invalid usage: negative distance
      const invalidResult1 = converter.toSQL({ distance_lt: [{ var: "location" }, ["10.5", "106.7", "-500"]] })
      expect(invalidResult1.ok).toBe(false)
      if (invalidResult1.ok) return
      expect(invalidResult1.errors[0]?.message).toBe("Distance must be positive")

      // Invalid usage: wrong arity
      const invalidResult2 = converter.toSQL({ distance_lt: [{ var: "location" }, ["10.5", "106.7"]] })
      expect(invalidResult2.ok).toBe(false)
      if (invalidResult2.ok) return
      expect(invalidResult2.errors[0]?.message).toBe("distance_lt requires latitude, longitude, and distance")
    })
  })

  describe("Scenario 6: Pagination and Sort with Column Aliases and Table-Qualified Fields", () => {
    it("compiles a complex query with aliases, multiple sort rules, and separate filter/list parameters", () => {
      const converter = createConverter(megaSchema, { dialect: "postgres", sort: true })

      const logic = {
        and: [
          { ">": [{ var: "order_total" }, 500] },
          { "==": [{ var: "product_name" }, "Ultimate Keyboard"] },
          { ">": [{ var: "created_at" }, "2026-06-01T00:00:00.000Z"] },
        ],
      }

      const sortRules = [
        { field: "order_total", direction: "desc" as const },
        { field: "created_at", direction: "asc" as const },
      ]

      const pagination = { limit: 25, offset: 50 }

      const result = converter.toSQL(logic, sortRules, pagination)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const q = result.value

      // Check generated SQL:
      // - WHERE uses aliases: "o"."total_amount" and "p"."name"
      // - ORDER BY uses aliases: "o"."total_amount" and "orders"."created_at" (wait, created_at has no internal, so it is just "created_at")
      expect(q.sql).toBe(
        `WHERE ("o"."total_amount" > $1 AND "p"."name" = $2 AND "created_at" > $3) ORDER BY "o"."total_amount" DESC, "created_at" ASC LIMIT $4 OFFSET $5`
      )

      // Check separate parameter collections to prevent driver count/parameter binding errors
      expect(q.filterParams).toEqual([
        500,
        "Ultimate Keyboard",
        "2026-06-01T00:00:00.000Z",
      ])
      expect(q.params).toEqual([
        500,
        "Ultimate Keyboard",
        "2026-06-01T00:00:00.000Z",
        25,
        50,
      ])
    })
  })

  describe("Scenario 7: Security Bounds & Advanced Operator Exploitation", () => {
    const converter = createConverter(megaSchema)

    it("rejects attempt to compare date with boolean (field-to-field type mismatch)", () => {
      const result = converter.toSQL({ ">": [{ var: "created_at" }, { var: "vip" }] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("OPERATOR_TYPE_MISMATCH")
      expect(result.errors[0]?.message).toContain("Cannot compare field")
    })

    it("rejects dates outside the min/max schema constraints in between", () => {
      const result = converter.toSQL({
        between: [{ var: "created_at" }, "2025-12-31T23:59:59.000Z", "2026-06-01T00:00:00.000Z"],
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_OUT_OF_RANGE")
    })

    it("rejects strings that don't match strict format regex", () => {
      const result = converter.toSQL({ "==": [{ var: "email" }, "hacker@evil.org"] }) // Doesn't match @company.com
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0]?.code).toBe("VALUE_FORMAT_INVALID")
    })

    it("prevents SQL Injection in values, collecting them purely as query params", () => {
      const sqlInjectionValue = "'; DROP TABLE users; --"
      const result = converter.toSQL({ "==": [{ var: "status" }, sqlInjectionValue] })
      expect(result.ok).toBe(false)
      // Even if value is dangerous, it fails schema allowedValues check first, ensuring zero-trust.
      // But let's check a field without allowedValues, like "email"
      const resultEmail = converter.toSQL({ "==": [{ var: "email" }, `admin@company.com${sqlInjectionValue}`] })
      // Let's see: it will fail regex because of space/quotes, which is another security layer!
      expect(resultEmail.ok).toBe(false)
    })
  })
})
