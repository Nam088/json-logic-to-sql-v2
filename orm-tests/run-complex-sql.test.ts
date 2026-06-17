import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

const DB_CONNECTION_STRING = "postgresql://postgres:postgres@localhost:5432/postgres"

describe("Execute Complex SQL directly on Postgres", () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: DB_CONNECTION_STRING })
    await client.connect()

    // 1. Setup table và data mẫu
    await client.query(`DROP TABLE IF EXISTS complex_users CASCADE;`)
    await client.query(`
      CREATE TABLE complex_users (
        id SERIAL PRIMARY KEY,
        age INT NOT NULL,
        salary INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(50) NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        roles TEXT[] NOT NULL,
        vip BOOLEAN NOT NULL
      );
    `)

    await client.query(`
      INSERT INTO complex_users (age, salary, created_at, updated_at, status, user_email, roles, vip) VALUES
      (30, 2000, '2026-05-01 10:00:00+00', '2026-05-02 10:00:00+00', 'active', 'john@company.com', '{"admin", "user"}', TRUE),
      (25, 1500, '2026-06-01 10:00:00+00', '2026-06-01 10:00:00+00', 'pending', 'clara@company.com', '{"user"}', TRUE),
      (35, 3000, '2026-05-01 10:00:00+00', '2026-05-02 10:00:00+00', 'active', 'rob@company.com', '{"user"}', FALSE),
      (30, 2000, '2026-05-01 10:00:00+00', '2026-05-02 10:00:00+00', 'inactive', 'jack@company.com', '{"user"}', TRUE),
      (30, 2000, '2026-05-01 10:00:00+00', '2026-05-02 10:00:00+00', 'active', 'john@other.com', '{"user"}', TRUE),
      (1, 2500, '2025-05-01 10:00:00+00', '2025-05-01 10:00:00+00', 'active', 'bobby@company.com', '{"user"}', TRUE),
      (30, 2000, '2026-05-01 10:00:00+00', '2026-05-02 10:00:00+00', 'active', 'lucy@company.com', '{"banned", "guest"}', TRUE),
      (30, 800, '2026-05-01 10:00:00+00', '2026-05-02 10:00:00+00', 'active', 'tom@company.com', '{"user"}', TRUE);
    `)
  })

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS complex_users CASCADE;`)
    await client.end()
  })

  it("compiles and successfully executes complex query on Postgres, returning exactly the correct rows", async () => {
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
        columnName: "user_email",
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

    const complexLogic = {
      and: [
        { "==": [{ var: "vip" }, true] },
        { in: [{ var: "status" }, ["active", "pending"]] },
        { contains: [{ var: "email" }, "@company.com"] },
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

    const sortRules = [{ field: "salary", direction: "desc" as const }]

    const pagination = { limit: 10, offset: 0 }

    const result = conv.toSQL(complexLogic, sortRules, pagination)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, params } = result.value
    console.log("Generated SQL:", sql)
    console.log("Parameters   :", params)

    const res = await client.query(`SELECT * FROM complex_users ${sql}`, params)

    console.log("Query Results:")
    console.table(res.rows)

    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].user_email).toBe("john@company.com")
    expect(res.rows[1].user_email).toBe("clara@company.com")
  })

  it("verifies that pagination builds correctly and count query matches (returns the total records count ignoring limit/offset)", async () => {
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
        columnName: "user_email",
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

    const complexLogic = {
      and: [
        { "==": [{ var: "vip" }, true] },
        { in: [{ var: "status" }, ["active", "pending"]] },
        { contains: [{ var: "email" }, "@company.com"] },
        {
          or: [
            { ">=": [{ var: "age" }, { var: "id" }] },
            { ">": [{ var: "updated_at" }, { var: "created_at" }] },
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

    const sortRules = [{ field: "salary", direction: "desc" as const }]

    // Phân trang lấy 1 dòng
    const pagination = { limit: 1, offset: 0 }

    const result = conv.toSQL(complexLogic, sortRules, pagination)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, filterSql, params, filterParams } = result.value

    // 1. Thực thi câu query lấy danh sách có phân trang (chỉ trả về 1 dòng)
    const listRes = await client.query(`SELECT * FROM complex_users ${sql}`, params)
    console.log("Pagination List Query Results (Limit 1):")
    console.table(listRes.rows)

    expect(listRes.rows).toHaveLength(1)
    expect(listRes.rows[0].user_email).toBe("john@company.com")

    // 2. Thực thi câu query COUNT sử dụng filterSql và cùng mảng params (phải trả về tổng 2 dòng)
    const countQuery = `SELECT COUNT(*)::int AS total FROM complex_users ${filterSql}`
    console.log("Count Query:", countQuery)
    const countRes = await client.query(countQuery, filterParams)

    console.log("Total Count Result:", countRes.rows[0].total)

    expect(countRes.rows[0].total).toBe(2)
  })

  it("executes queries using runtime fieldMappings and OR-expansions against complex_users Postgres table", async () => {
    const customSchema: FieldSchema = {
      userAge: {
        type: "number",
        operators: ["==", "between"],
      },
      userStatus: {
        type: "string",
        operators: ["==", "in"],
      },
    }

    const conv = createConverter(customSchema)

    // 1. Test raw SQL expression mapping (UPPER)
    const result1 = conv.toSQL({
      rule: { "==": [{ var: "userStatus" }, "ACTIVE"] },
      fieldMappings: {
        userStatus: "UPPER(status)",
      }
    })

    expect(result1.ok).toBe(true)
    if (result1.ok) {
      console.log("POSTGRES FIELD_MAPPING RAW SQL:", result1.value.sql)
      const res = await client.query(`SELECT * FROM complex_users ${result1.value.sql}`, result1.value.params)
      // active, active, active, active, active -> 5 rows
      expect(res.rows).toHaveLength(6)
    }

    // 2. Test OR-expansion mapping with multiple columns
    const result2 = conv.toSQL({
      rule: { between: [{ var: "userAge" }, 25, 30] },
      fieldMappings: {
        userAge: {
          column: "age",
          orColumn: ["salary / 100"]
        }
      }
    })

    expect(result2.ok).toBe(true)
    if (result2.ok) {
      console.log("POSTGRES FIELD_MAPPING OR-EXPANSION SQL:", result2.value.sql)
      const res = await client.query(`SELECT * FROM complex_users ${result2.value.sql}`, result2.value.params)
      expect(res.rows.length).toBeGreaterThan(0)
    }
  })
})

describe("Execute JSON Path SQL directly on Postgres", () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: DB_CONNECTION_STRING })
    await client.connect()

    await client.query(`DROP TABLE IF EXISTS json_users CASCADE;`)
    await client.query(`
      CREATE TABLE json_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        metadata JSONB NOT NULL
      );
    `)

    await client.query(`
      INSERT INTO json_users (name, metadata) VALUES
      ('Alice', '{"profile": {"age": 25, "vip": true, "email": "alice@company.com", "tags": ["admin", "user"], "scores": [10, 20]}, "settings": {"theme": "dark"}}'),
      ('Bob', '{"profile": {"age": 17, "vip": false, "email": "bob@company.com", "tags": ["user"], "scores": [30]}}'),
      ('Charlie', '{"profile": {"age": 30, "vip": true, "email": "charlie@company.com", "tags": ["guest"]}, "preferences": {"lang": "en"}}');
    `)
  })

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS json_users CASCADE;`)
    await client.end()
  })

  it("filters users using JSON Path Querying and type casting", async () => {
    const jsonSchema: FieldSchema = {
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
      "user.profile.email": {
        type: "string",
        operators: ["=="],
        columnName: "metadata",
        jsonPath: ["profile", "email"],
      },
    }

    const conv = createConverter(jsonSchema)

    const logic = {
      and: [{ ">": [{ var: "user.profile.age" }, 20] }, { "==": [{ var: "user.profile.vip" }, true] }],
    }

    const result = conv.toSQL(logic)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, params } = result.value
    const res = await client.query(`SELECT * FROM json_users ${sql}`, params)

    expect(res.rows).toHaveLength(2)
    const names = res.rows.map((r) => r.name).sort()
    expect(names).toEqual(["Alice", "Charlie"])
  })

  it("filters users using json_has_key and json_has_any_keys on Postgres", async () => {
    const jsonSchema: FieldSchema = {
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }
    const conv = createConverter(jsonSchema)

    // 1. json_has_key "settings" (Only Alice)
    const r1 = conv.toSQL({ json_has_key: [{ var: "metadata" }, "settings"] })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      const res1 = await client.query(`SELECT * FROM json_users ${r1.value.sql}`, r1.value.params)
      expect(res1.rows).toHaveLength(1)
      expect(res1.rows[0].name).toBe("Alice")
    }

    // 2. json_has_any_keys ["settings", "preferences"] (Alice and Charlie)
    const r2 = conv.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["settings", "preferences"]] })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      const res2 = await client.query(`SELECT * FROM json_users ${r2.value.sql}`, r2.value.params)
      expect(res2.rows).toHaveLength(2)
      const names = res2.rows.map((r) => r.name).sort()
      expect(names).toEqual(["Alice", "Charlie"])
    }
  })

  it("filters users using has_any/has_all on nested JSON array on Postgres", async () => {
    const jsonSchema: FieldSchema = {
      "user.profile.tags": {
        type: "array",
        operators: ["has_any", "has_all"],
        columnName: "metadata",
        jsonPath: ["profile", "tags"],
      },
      "user.profile.scores": {
        type: "array",
        operators: ["has_any"],
        columnName: "metadata",
        jsonPath: ["profile", "scores"],
      },
    }
    const conv = createConverter(jsonSchema)

    // 1. Test has_any
    const r1 = conv.toSQL({ has_any: [{ var: "user.profile.tags" }, ["admin", "guest"]] })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      console.log("POSTGRES HAS_ANY NESTED SQL:", r1.value.sql)
      const res1 = await client.query(`SELECT * FROM json_users ${r1.value.sql}`, r1.value.params)
      // Alice (has admin) and Charlie (has guest)
      expect(res1.rows).toHaveLength(2)
      const names = res1.rows.map((r) => r.name).sort()
      expect(names).toEqual(["Alice", "Charlie"])
    }

    // 2. Test has_all
    const r2 = conv.toSQL({ has_all: [{ var: "user.profile.tags" }, ["admin", "user"]] })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      console.log("POSTGRES HAS_ALL NESTED SQL:", r2.value.sql)
      const res2 = await client.query(`SELECT * FROM json_users ${r2.value.sql}`, r2.value.params)
      // Only Alice has both admin and user
      expect(res2.rows).toHaveLength(1)
      expect(res2.rows[0].name).toBe("Alice")
    }

    // 3. Test has_any with numeric array in JSON
    const r3 = conv.toSQL({ has_any: [{ var: "user.profile.scores" }, [10, 30]] })
    expect(r3.ok).toBe(true)
    if (r3.ok) {
      console.log("POSTGRES HAS_ANY NUMERIC NESTED SQL:", r3.value.sql)
      const res3 = await client.query(`SELECT * FROM json_users ${r3.value.sql}`, r3.value.params)
      // Alice (has 10) and Bob (has 30)
      expect(res3.rows).toHaveLength(2)
      const names = res3.rows.map((r) => r.name).sort()
      expect(names).toEqual(["Alice", "Bob"])
    }
  })
})
