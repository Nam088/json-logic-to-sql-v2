import { describe, it, expect, beforeAll } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Execute SQLite SQL directly on SQLite DB", () => {
  let db: DatabaseSync

  beforeAll(() => {
    db = new DatabaseSync(":memory:")

    // 1. Setup table and sample data
    db.exec(`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        salary INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        vip INTEGER NOT NULL
      );
    `)

    const insert = db.prepare(`
      INSERT INTO test_users (name, age, salary, created_at, status, vip)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    insert.run("Alice", 25, 1500, "2026-06-01T10:00:00.000Z", "active", 1)
    insert.run("Bob", 30, 2000, "2026-05-01T10:00:00.000Z", "pending", 1)
    insert.run("Charlie", 35, 3000, "2026-05-01T10:00:00.000Z", "active", 0)
    insert.run("David", 20, 1000, "2026-04-01T10:00:00.000Z", "active", 1)
    insert.run("Eve", 40, 4000, "2026-07-01T10:00:00.000Z", "inactive", 0)
  })

  const sqliteSchema: FieldSchema = {
    id: { type: "number", operators: ["==", "!=", ">", "<", ">=", "<="] },
    age: { type: "number", operators: ["==", ">", "<", ">=", "<=", "between"], constraints: { min: 0, max: 120 } },
    salary: { type: "number", operators: [">", "<", "=="], sortable: true },
    created_at: { type: "date", operators: ["==", ">", "<", "between"], sortable: true },
    status: {
      type: "string",
      operators: ["==", "in", "not_in"],
      constraints: { allowedValues: ["active", "inactive", "pending"] },
    },
    vip: { type: "boolean", operators: ["=="] },
  }

  it("compiles and executes SQLite positional (?) dialect queries", () => {
    const converter = createConverter(sqliteSchema, { dialect: "sqlite", sort: true })

    const logic = {
      and: [
        { "==": [{ var: "vip" }, true] },
        { in: [{ var: "status" }, ["active", "pending"]] },
        { ">=": [{ var: "age" }, 22] },
      ],
    }

    const sortRules = [{ field: "salary", direction: "desc" as const }]
    const pagination = { limit: 10, offset: 0 }

    const result = converter.toSQL(logic, sortRules, pagination)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, params } = result.value
    expect(sql).toBe('WHERE ("vip" = ? AND "status" IN (?, ?) AND "age" >= ?) ORDER BY "salary" DESC LIMIT ? OFFSET ?')
    expect(params).toEqual([1, "active", "pending", 22, 10, 0])

    const stmt = db.prepare(`SELECT * FROM test_users ${sql}`)
    const rows = stmt.all(...(params as any[])) as any[]

    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe("Bob")
    expect(rows[1].name).toBe("Alice")
  })

  it("compiles and executes SQLite named (:param) dialect queries", () => {
    const converter = createConverter(sqliteSchema, { dialect: "sqlite-named", sort: true })

    const logic = {
      and: [
        { "==": [{ var: "vip" }, true] },
        { in: [{ var: "status" }, ["active", "pending"]] },
        { ">=": [{ var: "age" }, 22] },
      ],
    }

    const sortRules = [{ field: "salary", direction: "desc" as const }]
    const pagination = { limit: 10, offset: 0 }

    const result = converter.toSQL(logic, sortRules, pagination)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, namedParams } = result.value
    expect(sql).toBe(
      'WHERE ("vip" = :vip_1 AND "status" IN (:status_0_2, :status_1_3) AND "age" >= :age_4) ORDER BY "salary" DESC LIMIT :limit_5 OFFSET :offset_6'
    )
    expect(namedParams).toEqual({
      vip_1: 1,
      status_0_2: "active",
      status_1_3: "pending",
      age_4: 22,
      limit_5: 10,
      offset_6: 0,
    })

    const stmt = db.prepare(`SELECT * FROM test_users ${sql}`)
    const rows = stmt.all(namedParams) as any[]

    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe("Bob")
    expect(rows[1].name).toBe("Alice")
  })

  it("verifies SQLite pagination counts using filterSql and filterParams", () => {
    const converter = createConverter(sqliteSchema, { dialect: "sqlite", sort: true })

    const logic = {
      and: [{ "==": [{ var: "vip" }, true] }, { in: [{ var: "status" }, ["active", "pending"]] }],
    }

    // Limit to 1 row
    const result = converter.toSQL(logic, undefined, { limit: 1, offset: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, filterSql, params, filterParams } = result.value

    // List query (only 1 row)
    const listStmt = db.prepare(`SELECT * FROM test_users ${sql}`)
    const listRows = listStmt.all(...params) as any[]
    expect(listRows).toHaveLength(1)

    // Count query (total records matching filter, should be 3: Alice, Bob, David)
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM test_users ${filterSql}`)
    const countRows = countStmt.all(...filterParams) as any[]
    expect(countRows[0].total).toBe(3)
  })
})
