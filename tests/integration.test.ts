import { describe, it, expect } from "vitest"
import { createConverter, toPublicSchema } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

const schema: FieldSchema = {
  age: {
    type: "number",
    operators: [">", ">=", "<", "<=", "==", "!=", "between"],
    constraints: { min: 0, max: 150 },
    sortable: true,
  },
  name: { type: "string", operators: ["==", "contains", "startsWith", "endsWith", "ilike", "like"], sortable: true },
  status: {
    type: "string",
    operators: ["==", "in", "not_in"],
    constraints: { allowedValues: ["active", "inactive", "banned"] },
  },
  score: { type: "number", operators: [">=", "<=", "between"] },
  deleted_at: { type: "date", operators: ["is_null", "is_not_null"], nullable: true, sortable: true },
  email: { type: "string", operators: ["=="], columnName: "user_email" },
  rank: { sortable: true },
}

const converter = createConverter(schema)
const sortConverter = createConverter(schema, { sort: true })

describe("Integration — full pipeline PostgreSQL", () => {
  it("simple comparison", () => {
    const result = converter.toSQL({ ">": [{ var: "age" }, 18] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "age" > $1`)
    expect(result.value.params).toEqual([18])
  })

  it("and with multiple conditions", () => {
    const result = converter.toSQL({
      and: [{ ">": [{ var: "age" }, 18] }, { "==": [{ var: "status" }, "active"] }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE ("age" > $1 AND "status" = $2)`)
    expect(result.value.params).toEqual([18, "active"])
  })

  it("in operator", () => {
    const result = converter.toSQL({ in: [{ var: "status" }, ["active", "inactive"]] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "status" IN ($1, $2)`)
    expect(result.value.params).toEqual(["active", "inactive"])
  })

  it("between operator", () => {
    const result = converter.toSQL({ between: [{ var: "age" }, 18, 65] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "age" BETWEEN $1 AND $2`)
    expect(result.value.params).toEqual([18, 65])
  })

  it("contains → LIKE", () => {
    const result = converter.toSQL({ contains: [{ var: "name" }, "john"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "name" LIKE $1`)
    expect(result.value.params).toEqual(["%john%"])
  })

  it("ilike for case-insensitive search", () => {
    const result = converter.toSQL({ ilike: [{ var: "name" }, "%john%"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "name" ILIKE $1`)
  })

  it("is_null", () => {
    const result = converter.toSQL({ is_null: [{ var: "deleted_at" }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "deleted_at" IS NULL`)
    expect(result.value.params).toEqual([])
  })

  it("columnName alias", () => {
    const result = converter.toSQL({ "==": [{ var: "email" }, "test@test.com"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "user_email" = $1`)
  })

  it("returns errors for disallowed field", () => {
    const result = converter.toSQL({ "==": [{ var: "password" }, "hack"] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("FIELD_NOT_ALLOWED")
  })

  it("sortable-only field (no type) cannot be used in filter", () => {
    const result = converter.toSQL({ "==": [{ var: "rank" }, 1] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("OPERATOR_NOT_ALLOWED")
  })

  it("or with nested and", () => {
    const result = converter.toSQL({
      or: [
        { "==": [{ var: "status" }, "active"] },
        { and: [{ ">=": [{ var: "age" }, 18] }, { "==": [{ var: "status" }, "inactive"] }] },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toContain("OR")
    expect(result.value.sql).toContain("AND")
    expect(result.value.params).toHaveLength(3)
  })
})

describe("Sort — ORDER BY support", () => {
  it("appends ORDER BY for a single sort rule", () => {
    const result = sortConverter.toSQL({ ">": [{ var: "age" }, 18] }, [{ field: "age", direction: "asc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "age" > $1 ORDER BY "age" ASC`)
  })

  it("appends ORDER BY for multiple sort rules", () => {
    const result = sortConverter.toSQL({ ">": [{ var: "age" }, 18] }, [
      { field: "name", direction: "desc" },
      { field: "age", direction: "asc" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "age" > $1 ORDER BY "name" DESC, "age" ASC`)
  })

  it("uses columnName alias in ORDER BY", () => {
    const result = sortConverter.toSQL({ is_null: [{ var: "deleted_at" }] }, [
      { field: "deleted_at", direction: "asc" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toContain(`ORDER BY "deleted_at" ASC`)
  })

  it("sorts by sortable-only field (no type)", () => {
    const result = sortConverter.toSQL({ ">": [{ var: "age" }, 0] }, [{ field: "rank", direction: "asc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toContain(`ORDER BY "rank" ASC`)
  })

  it("works without sort rules (no ORDER BY)", () => {
    const result = sortConverter.toSQL({ ">": [{ var: "age" }, 18] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "age" > $1`)
    expect(result.value.sql).not.toContain("ORDER BY")
  })

  it("returns SORT_NOT_ENABLED when sort option is false", () => {
    const result = converter.toSQL({ ">": [{ var: "age" }, 18] }, [{ field: "age", direction: "asc" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("SORT_NOT_ENABLED")
  })

  it("returns SORT_FIELD_NOT_SORTABLE for field without sortable:true", () => {
    const result = sortConverter.toSQL({ ">": [{ var: "age" }, 18] }, [{ field: "status", direction: "asc" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("SORT_FIELD_NOT_SORTABLE")
  })

  it("returns FIELD_NOT_ALLOWED for unknown sort field", () => {
    const result = sortConverter.toSQL({ ">": [{ var: "age" }, 18] }, [{ field: "unknown_field", direction: "asc" }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("FIELD_NOT_ALLOWED")
  })
})

describe("internal config — table-qualified columns and toPublicSchema", () => {
  const joinSchema: FieldSchema = {
    user_name: {
      type: "string",
      operators: ["==", "contains"],
      sortable: true,
      internal: { table: "users", column: "name" },
    },
    order_total: { type: "number", operators: [">", "<"], internal: { table: "orders", column: "total" } },
    status: { type: "string", operators: ["=="], internal: { column: "order_status" } }, // column alias only, no table
    created_at: { type: "date", operators: ["is_null"], nullable: true, sortable: true, internal: { table: "orders" } }, // table only, column = field key
    plain_field: { type: "number", operators: ["=="] }, // no internal at all
  }
  const conv = createConverter(joinSchema, { sort: true })

  it("generates table-qualified column in WHERE", () => {
    const result = conv.toSQL({ "==": [{ var: "user_name" }, "Alice"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "users"."name" = $1`)
  })

  it("uses internal.column alias without table", () => {
    const result = conv.toSQL({ "==": [{ var: "status" }, "active"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "order_status" = $1`)
  })

  it("uses internal.table with field key as column when no column given", () => {
    const result = conv.toSQL({ is_null: [{ var: "created_at" }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "orders"."created_at" IS NULL`)
  })

  it("falls back to field key for plain field (no internal)", () => {
    const result = conv.toSQL({ "==": [{ var: "plain_field" }, 42] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "plain_field" = $1`)
  })

  it("generates table-qualified column in ORDER BY", () => {
    const result = conv.toSQL({ ">": [{ var: "order_total" }, 0] }, [{ field: "user_name", direction: "asc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toContain(`ORDER BY "users"."name" ASC`)
  })

  it("toPublicSchema strips internal from all fields", () => {
    const pub = toPublicSchema(joinSchema)
    expect(pub.user_name).not.toHaveProperty("internal")
    expect(pub.order_total).not.toHaveProperty("internal")
    expect(pub.plain_field).not.toHaveProperty("internal")
  })

  it("toPublicSchema keeps type, operators, constraints, nullable, sortable", () => {
    const pub = toPublicSchema(joinSchema)
    expect(pub.user_name).toMatchObject({ type: "string", operators: ["==", "contains"], sortable: true })
    expect(pub.order_total).toMatchObject({ type: "number", operators: [">", "<"] })
  })
})

describe("FieldDef.config — FE metadata", () => {
  const schema: FieldSchema = {
    age: {
      type: "number",
      operators: [">", "=="],
      config: { label: "Tuổi", labelKey: "field.age" },
    },
    status: {
      type: "string",
      operators: ["=="],
      constraints: { allowedValues: ["active", "inactive"] },
      config: { label: "Trạng thái", labelKey: "field.status" },
      internal: { column: "user_status" },
    },
    plain: { type: "number", operators: ["=="] },
  }
  const conv = createConverter(schema)

  it("config does not affect SQL generation", () => {
    const result = conv.toSQL({ ">": [{ var: "age" }, 18] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "age" > $1`)
  })

  it("config does not affect validation", () => {
    const errors1 = conv.toSQL({ "==": [{ var: "status" }, "active"] })
    expect(errors1.ok).toBe(true)
    const errors2 = conv.toSQL({ "==": [{ var: "status" }, "unknown"] })
    expect(errors2.ok).toBe(false)
  })

  it("toPublicSchema keeps config", () => {
    const pub = toPublicSchema(schema)
    expect(pub.age?.config).toEqual({ label: "Tuổi", labelKey: "field.age" })
    expect(pub.status?.config).toEqual({ label: "Trạng thái", labelKey: "field.status" })
  })

  it("toPublicSchema strips internal but keeps config on same field", () => {
    const pub = toPublicSchema(schema)
    expect(pub.status).not.toHaveProperty("internal")
    expect(pub.status?.config).toBeDefined()
  })

  it("field without config is fine", () => {
    const result = conv.toSQL({ "==": [{ var: "plain" }, 1] })
    expect(result.ok).toBe(true)
  })

  it("config.labelKey is kept in toPublicSchema", () => {
    const s: FieldSchema = {
      age: { type: "number", operators: ["=="], config: { label: "Tuổi", labelKey: "field.age" } },
    }
    const pub = toPublicSchema(s)
    expect(pub.age?.config).toEqual({ label: "Tuổi", labelKey: "field.age" })
  })
})

describe("AllowedValueObject — labelKey on options", () => {
  const schema: FieldSchema = {
    status: {
      type: "string",
      operators: ["==", "in"],
      constraints: {
        allowedValues: [
          { value: "active", label: "Đang hoạt động", labelKey: "status.active" },
          { value: "inactive", label: "Tạm dừng", labelKey: "status.inactive" },
        ],
      },
    },
  }
  const conv = createConverter(schema)

  it("accepts valid value with labelKey present", () => {
    const result = conv.toSQL({ "==": [{ var: "status" }, "active"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "status" = $1`)
  })

  it("rejects value not in allowedValues (labelKey does not affect validation)", () => {
    const result = conv.toSQL({ "==": [{ var: "status" }, "Đang hoạt động"] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe("VALUE_NOT_IN_ALLOWED_VALUES")
  })

  it("labelKey is passed through toPublicSchema on allowedValues", () => {
    const pub = toPublicSchema(schema)
    const opts = pub.status?.constraints?.allowedValues
    expect(opts?.[0]).toEqual({ value: "active", label: "Đang hoạt động", labelKey: "status.active" })
    expect(opts?.[1]).toEqual({ value: "inactive", label: "Tạm dừng", labelKey: "status.inactive" })
  })
})

describe("internal mapping — table-qualified columns in WHERE and ORDER BY", () => {
  const joinSchema: FieldSchema = {
    user_name: { type: "string", operators: ["=="], internal: { table: "users", column: "name" } },
    order_total: {
      type: "number",
      operators: [">", "<"],
      sortable: true,
      internal: { table: "orders", column: "total" },
    },
    product_name: {
      type: "string",
      operators: ["=="],
      sortable: true,
      internal: { table: "products", column: "name" },
    },
    plain_age: { type: "number", operators: ["=="] },
  }

  const conv = createConverter(joinSchema, { sort: true })

  it("generates table-qualified column for mapped field", () => {
    const result = conv.toSQL({ ">": [{ var: "order_total" }, 100] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "orders"."total" > $1`)
    expect(result.value.joinSql).toBeUndefined()
  })

  it("plain field (no internal) keeps field key as column", () => {
    const result = conv.toSQL({ "==": [{ var: "plain_age" }, 25] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "plain_age" = $1`)
  })

  it("generates table-qualified column in ORDER BY", () => {
    const result = conv.toSQL({ ">": [{ var: "order_total" }, 0] }, [{ field: "product_name", direction: "desc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sortSql).toBe(`ORDER BY "products"."name" DESC`)
  })
})

describe("internal mapping — alias replaces table name in SQL", () => {
  const schema: FieldSchema = {
    order_total: {
      type: "number",
      operators: [">"],
      sortable: true,
      internal: { table: "orders", column: "total_amount", alias: "o" },
    },
    product_name: {
      type: "string",
      operators: ["=="],
      sortable: true,
      internal: { table: "products", column: "name", alias: "p" },
    },
    user_age: { type: "number", operators: ["=="], internal: { table: "users", column: "age" } }, // no alias → use table name
    plain: { type: "number", operators: ["=="] }, // no internal
  }
  const conv = createConverter(schema, { sort: true })

  it("uses alias as table prefix in WHERE", () => {
    const result = conv.toSQL({ ">": [{ var: "order_total" }, 100] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "o"."total_amount" > $1`)
  })

  it("falls back to table name when no alias", () => {
    const result = conv.toSQL({ "==": [{ var: "user_age" }, 30] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toBe(`WHERE "users"."age" = $1`)
  })

  it("uses alias in ORDER BY", () => {
    const result = conv.toSQL({ ">": [{ var: "order_total" }, 0] }, [{ field: "product_name", direction: "asc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sortSql).toBe(`ORDER BY "p"."name" ASC`)
  })

  it("mixes alias and non-alias fields in same query", () => {
    const result = conv.toSQL({
      and: [{ ">": [{ var: "order_total" }, 0] }, { "==": [{ var: "user_age" }, 18] }, { "==": [{ var: "plain" }, 1] }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sql).toContain(`"o"."total_amount"`)
    expect(result.value.sql).toContain(`"users"."age"`)
    expect(result.value.sql).toContain(`"plain"`)
  })
})

describe("Complex Postgres Integration Query", () => {
  const complexSchema: FieldSchema = {
    id: { type: "number", operators: ["==", "!=", ">", "<", ">=", "<="] },
    age: { type: "number", operators: ["==", ">", "<", ">=", "<=", "between"], constraints: { min: 0, max: 120 } },
    salary: { type: "number", operators: [">", "<", "=="], sortable: true },
    created_at: {
      type: "date",
      operators: ["==", ">", "<", "between"],
      constraints: { min: "2026-01-01" },
      sortable: true,
    },
    updated_at: { type: "date", operators: [">", "=="] },
    status: {
      type: "string",
      operators: ["==", "in", "not_in"],
      constraints: { allowedValues: ["active", "inactive", "pending"] },
    },
    email: {
      type: "string",
      operators: ["==", "contains"],
      constraints: { pattern: "^[a-zA-Z0-9._%+-]+@company\\.com$" },
    },
    roles: { type: "array", operators: ["has_any", "has_all"] },
    vip: {
      type: "boolean",
      operators: ["=="],
      validate: (v) => (typeof v === "boolean" ? true : "VIP must be boolean"),
    },
  }

  const conv = createConverter(complexSchema, { sort: true })

  it("compiles a highly complex nested logic structure with pagination, sorting, custom validators, and field-to-field comparisons", () => {
    const complexLogic = {
      and: [
        { "==": [{ var: "vip" }, true] },
        { in: [{ var: "status" }, ["active", "pending"]] },
        { contains: [{ var: "email" }, "john@company.com"] },
        {
          or: [
            { ">=": [{ var: "age" }, { var: "id" }] }, // field-to-field
            { ">": [{ var: "updated_at" }, { var: "created_at" }] }, // field-to-field
            { between: [{ var: "created_at" }, "2026-01-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z"] },
          ],
        },
        {
          "!": {
            or: [{ has_all: [{ var: "roles" }, ["banned", "guest"]] }, { "<": [{ var: "salary" }, 1000] }],
          },
        },
      ],
    }

    const sortRules = [
      { field: "salary", direction: "desc" as const },
      { field: "created_at", direction: "asc" as const },
    ]

    const pagination = { limit: 50, offset: 100 }

    const result = conv.toSQL(complexLogic, sortRules, pagination)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const q = result.value
    // Verify parameters count
    // 1. vip (true)
    // 2. status (active)
    // 3. status (pending)
    // 4. email (%john@company.com%)
    // 5. created_at_min (2026-01-01...)
    // 6. created_at_max (2026-12-31...)
    // 7. roles_0 (banned)
    // 8. roles_1 (guest)
    // 9. salary (1000)
    // 10. limit (50)
    // 11. offset (100)
    expect(q.params).toHaveLength(11)
    expect(q.params).toEqual([
      true,
      "active",
      "pending",
      "%john@company.com%",
      "2026-01-01T00:00:00.000Z",
      "2026-12-31T23:59:59.000Z",
      "banned",
      "guest",
      1000,
      50,
      100,
    ])

    // Verify generated SQL structure
    expect(q.sql).toContain("WHERE")
    expect(q.sql).toContain('"vip" = $1')
    expect(q.sql).toContain('"status" IN ($2, $3)')
    expect(q.sql).toContain('"email" LIKE $4')
    expect(q.sql).toContain('("age" >= "id" OR "updated_at" > "created_at" OR "created_at" BETWEEN $5 AND $6)')
    expect(q.sql).toContain('NOT (("roles" @> ARRAY[$7, $8] OR "salary" < $9))')
    expect(q.sql).toContain('ORDER BY "salary" DESC, "created_at" ASC')
    expect(q.sql).toContain("LIMIT $10 OFFSET $11")
  })
})
