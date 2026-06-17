import { describe, it, expect, beforeAll, afterAll } from "vitest"
import mysql from "mysql2/promise"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Execute MySQL SQL directly on MySQL DB", () => {
  let connection: mysql.Connection

  // Helper to retry connection until MySQL is ready (up to 30 seconds)
  beforeAll(async () => {
    let retries = 15
    while (retries > 0) {
      try {
        connection = await mysql.createConnection({
          host: "localhost",
          port: 3306,
          user: "testuser",
          password: "testpassword",
          database: "testdb",
          namedPlaceholders: true,
        })
        break
      } catch (_err) {
        console.log(`Waiting for MySQL to start... (${retries} retries left)`)
        retries--
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    if (!connection) {
      throw new Error("Could not connect to MySQL container")
    }

    // 1. Setup table and sample data
    await connection.query("DROP TABLE IF EXISTS test_users CASCADE;")
    await connection.query(`
      CREATE TABLE test_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        age INT NOT NULL,
        salary INT NOT NULL,
        created_at DATETIME NOT NULL,
        status VARCHAR(50) NOT NULL,
        roles JSON NOT NULL,
        vip BOOLEAN NOT NULL,
        metadata JSON NULL
      );
    `)

    await connection.query(`
      INSERT INTO test_users (name, age, salary, created_at, status, roles, vip, metadata) VALUES
      ('Alice', 25, 1500, '2026-06-01 10:00:00', 'active', '["admin", "user"]', true, '{"profile":{"age":25,"vip":true,"email":"alice@company.com"},"settings":{"theme":"dark"}}'),
      ('Bob', 30, 2000, '2026-05-01 10:00:00', 'pending', '["user"]', true, '{"profile":{"age":17,"vip":false}}'),
      ('Charlie', 35, 3000, '2026-05-01 10:00:00', 'active', '["user"]', false, '{"profile":{"age":30,"vip":true}}'),
      ('David', 20, 1000, '2026-04-01 10:00:00', 'active', '["user"]', true, '{"profile":{"age":20,"vip":true}}'),
      ('Eve', 40, 4000, '2026-07-01 10:00:00', 'inactive', '["guest"]', false, '{"profile":{"age":40,"vip":false}}'),
      ('Frank', 28, 1800, '2026-05-01 10:00:00', 'user', '["user"]', false, NULL);
    `)
  })

  afterAll(async () => {
    if (connection) {
      await connection.query("DROP TABLE IF EXISTS test_users;")
      await connection.end()
    }
  })

  const mysqlSchema: FieldSchema = {
    id: { type: "number", operators: ["==", "!=", ">", "<", ">=", "<="] },
    age: { type: "number", operators: ["==", ">", "<", ">=", "<=", "between"], constraints: { min: 0, max: 120 } },
    salary: { type: "number", operators: [">", "<", "=="], sortable: true },
    created_at: { type: "date", operators: ["==", ">", "<", "between"], sortable: true },
    status: {
      type: "string",
      operators: ["==", "in", "not_in"],
      constraints: { allowedValues: ["active", "inactive", "pending"] },
    },
    roles: { type: "array", operators: ["has_any", "has_all"] },
    vip: { type: "boolean", operators: ["=="] },
    "user.profile": {
      columnName: "metadata",
      jsonPath: ["profile"],
      operators: ["json_has_key", "json_has_any_keys"],
    },
  }

  it("compiles and executes MySQL positional (?) dialect queries", async () => {
    const converter = createConverter(mysqlSchema, { dialect: "mysql", sort: true })

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
    expect(sql).toBe("WHERE (`vip` = ? AND `status` IN (?, ?) AND `age` >= ?) ORDER BY `salary` DESC LIMIT ? OFFSET ?")
    expect(params).toEqual([true, "active", "pending", 22, 10, 0])

    const [rows] = (await connection.query(`SELECT * FROM test_users ${sql}`, params)) as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe("Bob")
    expect(rows[1].name).toBe("Alice")
  })

  it("compiles and executes MySQL named (:param) dialect queries and array operators", async () => {
    const converter = createConverter(mysqlSchema, { dialect: "mysql-named", sort: true })

    const logic = {
      and: [{ "==": [{ var: "vip" }, true] }, { has_any: [{ var: "roles" }, ["admin", "guest"]] }],
    }

    const result = converter.toSQL(logic)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, namedParams } = result.value
    expect(sql).toBe("WHERE (`vip` = :vip_1 AND JSON_OVERLAPS(`roles`, JSON_ARRAY(:roles_0_2, :roles_1_3)))")
    expect(namedParams).toEqual({
      vip_1: true,
      roles_0_2: "admin",
      roles_1_3: "guest",
    })

    const [rows] = (await connection.query(`SELECT * FROM test_users ${sql}`, namedParams)) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("Alice")
  })

  it("verifies MySQL pagination counts using filterSql and filterParams", async () => {
    const converter = createConverter(mysqlSchema, { dialect: "mysql", sort: true })

    const logic = {
      and: [{ "==": [{ var: "vip" }, true] }, { in: [{ var: "status" }, ["active", "pending"]] }],
    }

    // Limit to 1 row
    const result = converter.toSQL(logic, undefined, { limit: 1, offset: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, filterSql, params, filterParams } = result.value

    // List query (only 1 row)
    const [listRows] = (await connection.query(`SELECT * FROM test_users ${sql}`, params)) as any[]
    expect(listRows).toHaveLength(1)

    // Count query (total records matching filter, should be 3: Alice, Bob, David)
    const [countRows] = (await connection.query(
      `SELECT COUNT(*) as total FROM test_users ${filterSql}`,
      filterParams
    )) as any[]
    expect(countRows[0].total).toBe(3)
  })

  it("compiles and executes queries with date filtering (ISO string and Date objects)", async () => {
    const converter = createConverter(mysqlSchema, { dialect: "mysql" })

    // Query with standard ISO string
    const resultIso = converter.toSQL({
      ">": [{ var: "created_at" }, "2026-05-15T00:00:00.000Z"],
    })
    expect(resultIso.ok).toBe(true)
    if (!resultIso.ok) return

    expect(resultIso.value.params).toEqual(["2026-05-15 00:00:00"])
    const [rowsIso] = (await connection.query(`SELECT * FROM test_users ${resultIso.value.sql}`, resultIso.value.params)) as any[]
    // Should match Alice (2026-06-01) and Eve (2026-07-01)
    expect(rowsIso).toHaveLength(2)
    const namesIso = rowsIso.map((r: any) => r.name).sort()
    expect(namesIso).toEqual(["Alice", "Eve"])

    // Query with Date object
    const resultDate = converter.toSQL({
      "<": [{ var: "created_at" }, new Date("2026-04-15T00:00:00.000Z") as any],
    })
    expect(resultDate.ok).toBe(true)
    if (!resultDate.ok) return

    expect(resultDate.value.params).toEqual(["2026-04-15 00:00:00"])
    const [rowsDate] = (await connection.query(`SELECT * FROM test_users ${resultDate.value.sql}`, resultDate.value.params)) as any[]
    // Should match David (2026-04-01)
    expect(rowsDate).toHaveLength(1)
    expect(rowsDate[0].name).toBe("David")
  })

  it("compiles and executes MySQL array operators with variables", async () => {
    const converter = createConverter(mysqlSchema, { dialect: "mysql" })

    // roles has_any ["guest", status]
    const logic = {
      has_any: [{ var: "roles" }, ["guest", { var: "status" }]],
    }

    const result = converter.toSQL(logic)
    if (!result.ok) {
      console.log("VALIDATION ERRORS:", JSON.stringify((result as any).errors, null, 2))
    }
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, params } = result.value
    // Should result in: WHERE JSON_OVERLAPS(`roles`, JSON_ARRAY(?, `status`))
    expect(sql).toBe("WHERE JSON_OVERLAPS(`roles`, JSON_ARRAY(?, `status`))")
    expect(params).toEqual(["guest"])

    const [rows] = (await connection.query(`SELECT * FROM test_users ${sql}`, params)) as any[]
    
    // Eve (roles ["guest"] has "guest"), Frank (roles ["user"] has status "user")
    expect(rows).toHaveLength(2)
    const names = rows.map((r: any) => r.name).sort()
    expect(names).toEqual(["Eve", "Frank"])
  })

  it("compiles and executes json_has_key on MySQL", async () => {
    const converter = createConverter(mysqlSchema, { dialect: "mysql" })
    
    // Kiểm tra xem metadata.profile có chứa key "email" không
    const logic = {
      json_has_key: [{ var: "user.profile" }, "email"]
    }
    
    const result = converter.toSQL(logic)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    
    const { sql, params } = result.value
    console.log("MYSQL JSON_HAS_KEY SQL:", sql)
    
    const [rows] = (await connection.query(`SELECT * FROM test_users ${sql}`, params)) as any[]
    
    // Chỉ có Alice có profile.email
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("Alice")
  })
})
