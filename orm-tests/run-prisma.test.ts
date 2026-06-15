import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

// Converters Setup
const schema: FieldSchema = {
  age: {
    type: "number",
    operators: [">", ">=", "<", "<=", "==", "!=", "between"],
    constraints: { min: 0, max: 150 },
    sortable: true,
  },
  name: {
    type: "string",
    operators: ["==", "contains", "not_contains", "startsWith", "endsWith", "ilike", "like"],
    sortable: true,
  },
  status: {
    type: "string",
    operators: ["==", "in", "not_in"],
    constraints: { allowedValues: ["active", "inactive", "banned"] },
  },
  score: { type: "number", operators: [">=", "<=", "between"] },
  deleted_at: {
    type: "date",
    operators: ["is_null", "is_not_null", "<", ">", "between"],
    nullable: true,
    sortable: true,
  },
  email: { type: "string", operators: ["=="], columnName: "user_email" },
  is_active: { type: "boolean", operators: ["==", "!="] },
  uuid: { type: "uuid", operators: ["==", "!="], columnName: "user_uuid" },
  tags: { type: "array", operators: ["has_any", "has_all", "contained_by"] },
  rank: { sortable: true },
  id: { type: "number", operators: ["==", "!=", ">", "<", ">=", "<="] },
}

const prismaConverter = createConverter(schema, { dialect: "postgres" })

const DB_CONNECTION_STRING = "postgresql://postgres:postgres@localhost:5432/postgres"

interface TestCase {
  name: string
  logic: unknown
  expectedNames: string[]
}

const testCases: TestCase[] = [
  {
    name: "simple comparison (>)",
    logic: { ">": [{ var: "age" }, 18] },
    expectedNames: ["Alice", "Charlie", "David"],
  },
  {
    name: "less than or equal (<=)",
    logic: { "<=": [{ var: "age" }, 25] },
    expectedNames: ["Alice", "Bob"],
  },
  {
    name: "between",
    logic: { between: [{ var: "age" }, 20, 35] },
    expectedNames: ["Alice", "Charlie"],
  },
  {
    name: "in list",
    logic: { in: [{ var: "status" }, ["active", "inactive"]] },
    expectedNames: ["Alice", "Bob", "Charlie"],
  },
  {
    name: "not in list",
    logic: { not_in: [{ var: "status" }, ["banned", "inactive"]] },
    expectedNames: ["Alice", "Charlie"],
  },
  {
    name: "is null",
    logic: { is_null: [{ var: "deleted_at" }] },
    expectedNames: ["Alice", "Bob", "Charlie"],
  },
  {
    name: "is not null",
    logic: { is_not_null: [{ var: "deleted_at" }] },
    expectedNames: ["David"],
  },
  {
    name: "logical AND",
    logic: {
      and: [{ ">": [{ var: "age" }, 18] }, { "==": [{ var: "status" }, "active"] }],
    },
    expectedNames: ["Alice", "Charlie"],
  },
  {
    name: "logical OR",
    logic: {
      or: [{ "==": [{ var: "status" }, "banned"] }, { "<": [{ var: "age" }, 20] }],
    },
    expectedNames: ["Bob", "David"],
  },
  {
    name: "logical NOT (!)",
    logic: { "!": [{ "==": [{ var: "is_active" }, true] }] },
    expectedNames: ["Bob", "David"],
  },
  {
    name: "contains (LIKE)",
    logic: { contains: [{ var: "name" }, "li"] },
    expectedNames: ["Alice", "Charlie"],
  },
  {
    name: "startsWith",
    logic: { startsWith: [{ var: "name" }, "Al"] },
    expectedNames: ["Alice"],
  },
  {
    name: "endsWith",
    logic: { endsWith: [{ var: "name" }, "lie"] },
    expectedNames: ["Charlie"],
  },
  {
    name: "ilike (case insensitive)",
    logic: { ilike: [{ var: "name" }, "%aLiCe%"] },
    expectedNames: ["Alice"],
  },
  {
    name: "array has_any",
    logic: { has_any: [{ var: "tags" }, ["tag1", "tag3"]] },
    expectedNames: ["Alice", "Bob", "Charlie"],
  },
  {
    name: "array has_all",
    logic: { has_all: [{ var: "tags" }, ["tag1", "tag2"]] },
    expectedNames: ["Alice"],
  },
  {
    name: "array contained_by",
    logic: { contained_by: [{ var: "tags" }, ["tag1", "tag3"]] },
    expectedNames: ["Charlie", "David"],
  },
  {
    name: "column alias (email)",
    logic: { "==": [{ var: "email" }, "charlie@test.com"] },
    expectedNames: ["Charlie"],
  },
  {
    name: "uuid field",
    logic: { "==": [{ var: "uuid" }, "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12"] },
    expectedNames: ["Bob"],
  },
  {
    name: "complex deeply nested logic",
    logic: {
      and: [
        { is_null: [{ var: "deleted_at" }] },
        {
          or: [
            {
              and: [
                { ">": [{ var: "age" }, 18] },
                { "==": [{ var: "status" }, "active"] },
                { has_any: [{ var: "tags" }, ["tag1"]] },
              ],
            },
            {
              and: [
                { "<=": [{ var: "age" }, 30] },
                { "==": [{ var: "status" }, "inactive"] },
                { "!": [{ "==": [{ var: "is_active" }, true] }] },
                { "==": [{ var: "email" }, "bob@test.com"] },
              ],
            },
          ],
        },
      ],
    },
    expectedNames: ["Alice", "Bob", "Charlie"],
  },
  {
    name: "field-to-field comparison (age >= id)",
    logic: { ">=": [{ var: "age" }, { var: "id" }] },
    expectedNames: ["Alice", "Bob", "Charlie", "David"],
  },
  {
    name: "field-to-field comparison (age > id) and active status",
    logic: {
      and: [{ ">": [{ var: "age" }, { var: "id" }] }, { "==": [{ var: "status" }, "active"] }],
    },
    expectedNames: ["Alice", "Charlie"],
  },
]

describe("Prisma Integration Tests with PostgreSQL", () => {
  let prisma: PrismaClient
  let pool: pg.Pool

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_CONNECTION_STRING })
    const adapter = new PrismaPg(pool)
    prisma = new PrismaClient({ adapter })
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

  for (const tc of testCases) {
    it(`Prisma: should resolve: ${tc.name}`, async () => {
      const result = prismaConverter.toSQL(tc.logic)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const rows = (await prisma.$queryRawUnsafe(
        `SELECT * FROM users ${result.value.sql}`,
        ...result.value.params
      )) as any[]

      expect(rows).toBeInstanceOf(Array)
      const names = rows.map((r) => r.name).sort()
      expect(names).toEqual(tc.expectedNames.sort())
    })
  }

  it("Prisma: should sort and paginate correctly", async () => {
    const prismaSortConverter = createConverter(schema, { dialect: "postgres", sort: true })
    const result = prismaSortConverter.toSQL({ ">": [{ var: "age" }, 10] }, [{ field: "age", direction: "desc" }], {
      limit: 2,
      offset: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rows = (await prisma.$queryRawUnsafe(
      `SELECT * FROM users ${result.value.sql}`,
      ...result.value.params
    )) as any[]

    expect(rows).toHaveLength(2)
    const names = rows.map((r) => r.name)
    expect(names).toEqual(["Charlie", "Alice"])
  })

  it("Prisma: should support filterSql and filterParams for count queries alongside pagination", async () => {
    const prismaSortConverter = createConverter(schema, { dialect: "postgres", sort: true })
    const result = prismaSortConverter.toSQL({ ">": [{ var: "age" }, 10] }, [{ field: "age", direction: "desc" }], {
      limit: 2,
      offset: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { filterSql, filterParams } = result.value

    const countRows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total FROM users ${filterSql}`,
      ...filterParams
    )) as any[]

    expect(countRows[0].total).toBe(4) // Alice, Bob, Charlie, David are all > 10
  })
})
