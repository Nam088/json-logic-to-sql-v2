import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Sequelize } from "sequelize"
import { MikroORM, EntitySchema } from "@mikro-orm/core"
import { PostgreSqlDriver } from "@mikro-orm/postgresql"
import { DataSource } from "typeorm"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

// Define a common interface for User
interface IUser {
  id: number
  name: string
  age: number
  status: string
  user_email: string
  deleted_at: Date | null
  is_active: boolean
  user_uuid: string
  tags: string[]
}

// MikroORM User Entity Schema definition
class MikroUser implements IUser {
  id!: number
  name!: string
  age!: number
  status!: string
  user_email!: string
  deleted_at!: Date | null
  is_active!: boolean
  user_uuid!: string
  tags!: string[]
}

const MikroUserSchema = new EntitySchema({
  class: MikroUser,
  tableName: "users",
  properties: {
    id: { type: "number", primary: true },
    name: { type: "string" },
    age: { type: "number" },
    status: { type: "string" },
    user_email: { type: "string" },
    deleted_at: { type: "Date", nullable: true },
    is_active: { type: "boolean" },
    user_uuid: { type: "string" },
    tags: { type: "array" },
  },
})

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

const _converter = createConverter(schema)
const _sortConverter = createConverter(schema, { sort: true })

// 1. MikroORM configuration (uses built-in "postgres-anonymous" dialect)
const mikroOrmConverter = createConverter(schema, { dialect: "postgres-anonymous" })

// 2. Sequelize configuration (uses built-in "postgres-named" dialect)
const sequelizeConverter = createConverter(schema, { dialect: "postgres-named" })

// 3. TypeORM configuration (uses built-in "postgres-named" dialect with prefix: "")
const typeOrmConverter = createConverter(schema, { dialect: "postgres-named", prefix: "" })
const typeOrmSortConverter = createConverter(schema, { dialect: "postgres-named", prefix: "", sort: true })

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

describe("ORM Integration Tests with PostgreSQL", () => {
  describe("Sequelize Integration", () => {
    let sequelize: Sequelize

    beforeAll(async () => {
      sequelize = new Sequelize(DB_CONNECTION_STRING, {
        dialect: "postgres",
        logging: false,
      })
      await sequelize.authenticate()
    })

    afterAll(async () => {
      await sequelize.close()
    })

    for (const tc of testCases) {
      it(`Sequelize: should resolve: ${tc.name}`, async () => {
        const result = sequelizeConverter.toSQL(tc.logic)
        expect(result.ok).toBe(true)
        if (!result.ok) return

        const rows = (await sequelize.query(`SELECT * FROM users ${result.value.sql}`, {
          replacements: result.value.namedParams,
          type: "SELECT",
        })) as any[]

        expect(rows).toBeInstanceOf(Array)
        const names = rows.map((r) => r.name).sort()
        expect(names).toEqual(tc.expectedNames.sort())
      })
    }

    it("Sequelize: should sort and paginate correctly", async () => {
      const seqSortConverter = createConverter(schema, { dialect: "postgres-named", sort: true })
      const result = seqSortConverter.toSQL({ ">": [{ var: "age" }, 10] }, [{ field: "age", direction: "desc" }], {
        limit: 2,
        offset: 1,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const rows = (await sequelize.query(`SELECT * FROM users ${result.value.sql}`, {
        replacements: result.value.namedParams,
        type: "SELECT",
      })) as any[]

      expect(rows).toHaveLength(2)
      const names = rows.map((r) => r.name)
      expect(names).toEqual(["Charlie", "Alice"])
    })
  })

  describe("MikroORM Integration", () => {
    let orm: MikroORM

    beforeAll(async () => {
      orm = await MikroORM.init({
        driver: PostgreSqlDriver,
        clientUrl: DB_CONNECTION_STRING,
        entities: [MikroUserSchema],
      })
    })

    afterAll(async () => {
      await orm.close()
    })

    for (const tc of testCases) {
      it(`MikroORM: should resolve: ${tc.name}`, async () => {
        const result = mikroOrmConverter.toSQL(tc.logic)
        expect(result.ok).toBe(true)
        if (!result.ok) return

        const rows = (await orm.em
          .getConnection()
          .execute(`SELECT * FROM users ${result.value.sql}`, result.value.params)) as any[]

        expect(rows).toBeInstanceOf(Array)
        const names = rows.map((r) => r.name).sort()
        expect(names).toEqual(tc.expectedNames.sort())
      })
    }

    it("MikroORM: should sort and paginate correctly", async () => {
      const mikroSortConverter = createConverter(schema, { dialect: "postgres-anonymous", sort: true })
      const result = mikroSortConverter.toSQL({ ">": [{ var: "age" }, 10] }, [{ field: "age", direction: "asc" }], {
        limit: 2,
        offset: 2,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const rows = (await orm.em
        .getConnection()
        .execute(`SELECT * FROM users ${result.value.sql}`, result.value.params)) as any[]

      expect(rows).toHaveLength(2)
      const names = rows.map((r) => r.name)
      expect(names).toEqual(["Charlie", "David"])
    })
  })

  describe("TypeORM Integration", () => {
    let dataSource: DataSource

    beforeAll(async () => {
      dataSource = new DataSource({
        type: "postgres",
        url: DB_CONNECTION_STRING,
        synchronize: false,
        logging: false,
      })
      await dataSource.initialize()
    })

    afterAll(async () => {
      await dataSource.destroy()
    })

    for (const tc of testCases) {
      it(`TypeORM: should resolve: ${tc.name}`, async () => {
        const result = typeOrmConverter.toSQL(tc.logic)
        expect(result.ok).toBe(true)
        if (!result.ok) return

        const rows = (await dataSource
          .createQueryBuilder()
          .select()
          .from("users", "user")
          .where(result.value.sql, result.value.namedParams)
          .getRawMany()) as any[]

        expect(rows).toBeInstanceOf(Array)
        const names = rows.map((r) => r.name).sort()
        expect(names).toEqual(tc.expectedNames.sort())
      })
    }

    it("TypeORM: should sort correctly with ORDER BY", async () => {
      const result = typeOrmSortConverter.toSQL({ ">": [{ var: "age" }, 10] }, [{ field: "age", direction: "asc" }])
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const qb = dataSource
        .createQueryBuilder()
        .select()
        .from("users", "user")
        .where(result.value.filterSql, result.value.namedParams)

      if (result.value.orderFields) {
        result.value.orderFields.forEach((o) => {
          qb.addOrderBy(o.column, o.direction)
        })
      }

      const rows = (await qb.getRawMany()) as any[]

      expect(rows).toHaveLength(4)
      const names = rows.map((r) => r.name)
      expect(names).toEqual(["Bob", "Alice", "Charlie", "David"])
    })

    it("TypeORM: should sort and paginate correctly", async () => {
      const typeOrmFullConverter = createConverter(schema, { dialect: "postgres-named", prefix: "", sort: true })
      const result = typeOrmFullConverter.toSQL({ ">": [{ var: "age" }, 10] }, [{ field: "age", direction: "desc" }], {
        limit: 3,
        offset: 1,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const rows = (await dataSource
        .createQueryBuilder()
        .select()
        .from("users", "user")
        .where(result.value.sql, result.value.namedParams)
        .getRawMany()) as any[]

      expect(rows).toHaveLength(3)
      const names = rows.map((r) => r.name)
      expect(names).toEqual(["Charlie", "Alice", "Bob"])
    })
  })
})
