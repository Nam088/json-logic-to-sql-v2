import { describe, it, expect, beforeAll, afterAll } from "vitest"
import sql, { NVarChar, Bit, Int, DateTime2, Decimal } from "mssql"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

const MSSQL_CONFIG: sql.config = {
  server: "localhost",
  port: 14330,
  user: "sa",
  password: "StrongP@ssw0rd!",
  database: "master",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 60000,
  requestTimeout: 30000,
}

async function waitForMssql(maxRetries = 20): Promise<sql.ConnectionPool> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const pool = await sql.connect(MSSQL_CONFIG)
      return pool
    } catch (_err) {
      console.log(`Waiting for MSSQL to start... (${maxRetries - i - 1} retries left)`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  throw new Error("Could not connect to MSSQL container after retries")
}

/**
 * Map a JS value to the appropriate mssql type so tedious doesn't default to NULL type.
 * This is critical for JSON_VALUE/JSON_QUERY which reject NULL-typed arguments.
 */
function inferMssqlType(value: unknown): sql.ISqlType {
  if (typeof value === "string") return NVarChar(4000)
  if (typeof value === "boolean") return Bit()
  if (typeof value === "number") return Number.isInteger(value) ? Int() : Decimal(18, 4)
  if (value instanceof Date) return DateTime2()
  return NVarChar(4000) // fallback
}

/**
 * Convert positional ? params → @p1, @p2, ... and bind them to a pool.Request.
 * We must create the Request from the pool so it has a valid connection.
 * Explicitly typed inputs prevent tedious from sending NULL-typed params.
 */
function buildPositionalRequest(
  pool: sql.ConnectionPool,
  querySql: string,
  params: unknown[]
): { query: string; request: sql.Request } {
  const request = pool.request()
  let index = 1
  const query = querySql.replace(/\?/g, () => {
    const paramName = `p${index}`
    const value = params[index - 1]
    request.input(paramName, inferMssqlType(value), value)
    index++
    return `@${paramName}`
  })
  return { query, request }
}

/**
 * Bind named @param-style params into a pool.Request.
 * Explicitly typed to prevent tedious from sending NULL-typed params.
 */
function buildNamedRequest(pool: sql.ConnectionPool, namedParams: Record<string, unknown>): sql.Request {
  const request = pool.request()
  for (const [key, value] of Object.entries(namedParams)) {
    request.input(key, inferMssqlType(value), value)
  }
  return request
}

// ─── Test Suite 1: Basic queries with positional (?) dialect ──────────────────

describe("Execute MSSQL SQL directly on MSSQL DB (anonymous ? dialect)", () => {
  let pool: sql.ConnectionPool

  beforeAll(async () => {
    pool = await waitForMssql()

    await pool.request().query(`IF OBJECT_ID('test_users', 'U') IS NOT NULL DROP TABLE test_users`)
    await pool.request().query(`
      CREATE TABLE test_users (
        id    INT IDENTITY(1,1) PRIMARY KEY,
        name  NVARCHAR(255) NOT NULL,
        age   INT NOT NULL,
        salary INT NOT NULL,
        created_at DATETIME2 NOT NULL,
        status NVARCHAR(50) NOT NULL,
        vip   BIT NOT NULL
      )
    `)
    await pool.request().query(`
      INSERT INTO test_users (name, age, salary, created_at, status, vip) VALUES
      ('Alice',   25, 1500, '2026-06-01T10:00:00', 'active',   1),
      ('Bob',     30, 2000, '2026-05-01T10:00:00', 'pending',  1),
      ('Charlie', 35, 3000, '2026-05-01T10:00:00', 'active',   0),
      ('David',   20, 1000, '2026-04-01T10:00:00', 'active',   1),
      ('Eve',     40, 4000, '2026-07-01T10:00:00', 'inactive', 0)
    `)
  })

  afterAll(async () => {
    if (pool) {
      await pool.request().query(`IF OBJECT_ID('test_users', 'U') IS NOT NULL DROP TABLE test_users`)
      await pool.close()
    }
  })

  const mssqlSchema: FieldSchema = {
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

  it("compiles and executes MSSQL positional (?) dialect — filter + sort", async () => {
    const converter = createConverter(mssqlSchema, { dialect: "mssql", sort: true })

    const logic = {
      and: [
        { "==": [{ var: "vip" }, true] },
        { in: [{ var: "status" }, ["active", "pending"]] },
        { ">=": [{ var: "age" }, 22] },
      ],
    }

    const result = converter.toSQL(logic, [{ field: "salary", direction: "desc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql: querySql, params } = result.value
    console.log("SQL  :", querySql)
    console.log("Params:", params)

    // ORDER BY needs OFFSET for MSSQL when using TOP — but we test the WHERE + ORDER BY part
    const { query, request } = buildPositionalRequest(pool, querySql, params)
    const res = await request.query(`SELECT * FROM test_users ${query}`)
    console.table(res.recordset)

    // vip=1, status IN (active,pending), age>=22 → Alice (active,25), Bob (pending,30)
    expect(res.recordset).toHaveLength(2)
    // ORDER BY salary DESC
    expect(res.recordset[0].name).toBe("Bob")
    expect(res.recordset[1].name).toBe("Alice")
  })

  it("compiles and executes MSSQL BETWEEN operator", async () => {
    const converter = createConverter(mssqlSchema, { dialect: "mssql" })

    const result = converter.toSQL({ between: [{ var: "age" }, 25, 35] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { query, request } = buildPositionalRequest(pool, result.value.sql, result.value.params)
    const res = await request.query(`SELECT * FROM test_users ${query}`)

    // age BETWEEN 25 AND 35 → Alice(25), Bob(30), Charlie(35)
    expect(res.recordset).toHaveLength(3)
    const names = res.recordset.map((r: any) => r.name).sort()
    expect(names).toEqual(["Alice", "Bob", "Charlie"])
  })

  it("compiles and executes MSSQL NOT IN operator", async () => {
    const converter = createConverter(mssqlSchema, { dialect: "mssql" })

    const result = converter.toSQL({ not_in: [{ var: "status" }, ["active", "pending"]] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { query, request } = buildPositionalRequest(pool, result.value.sql, result.value.params)
    const res = await request.query(`SELECT * FROM test_users ${query}`)

    // NOT IN (active, pending) → Eve (inactive)
    expect(res.recordset).toHaveLength(1)
    expect(res.recordset[0].name).toBe("Eve")
  })

  it("compiles and executes MSSQL LIKE contains operator", async () => {
    const schemaWithName: FieldSchema = {
      name: { type: "string", operators: ["contains", "startsWith", "endsWith"] },
    }
    const converter = createConverter(schemaWithName, { dialect: "mssql" })

    const result = converter.toSQL({ contains: [{ var: "name" }, "li"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { query, request } = buildPositionalRequest(pool, result.value.sql, result.value.params)
    const res = await request.query(`SELECT * FROM test_users ${query}`)

    // contains "li" → Alice, Charlie
    const names = res.recordset.map((r: any) => r.name).sort()
    expect(names).toEqual(["Alice", "Charlie"])
  })

  it("compiles and executes MSSQL IS NULL / IS NOT NULL operators", async () => {
    const nullableSchema: FieldSchema = {
      status: {
        type: "string",
        operators: ["==", "is_null", "is_not_null"],
        nullable: true,
        constraints: { allowedValues: ["active", "inactive", "pending"] },
      },
    }
    const converter = createConverter(nullableSchema, { dialect: "mssql" })

    // IS NOT NULL — all 5 rows have non-null status
    const r1 = converter.toSQL({ is_not_null: [{ var: "status" }] })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const { query: q1, request: req1 } = buildPositionalRequest(pool, r1.value.sql, r1.value.params)
    const res1 = await req1.query(`SELECT * FROM test_users ${q1}`)
    expect(res1.recordset).toHaveLength(5)

    // IS NULL — no rows have null status
    const r2 = converter.toSQL({ is_null: [{ var: "status" }] })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const { query: q2, request: req2 } = buildPositionalRequest(pool, r2.value.sql, r2.value.params)
    const res2 = await req2.query(`SELECT * FROM test_users ${q2}`)
    expect(res2.recordset).toHaveLength(0)
  })

  it("compiles and executes MSSQL pagination (limit/offset)", async () => {
    const converter = createConverter(mssqlSchema, { dialect: "mssql", sort: true })

    // Test with both sort and pagination
    const logic = { ">": [{ var: "age" }, 18] } // age > 18 (Alice 25, Bob 30, Charlie 35, Eve 40 - total 4 rows)
    const sort = [{ field: "salary", direction: "desc" as const }] // Eve 4000, Charlie 3000, Bob 2000, Alice 1500
    const pagination = { limit: 2, offset: 1 } // offset 1, limit 2 -> Charlie (3000), Bob (2000)

    const result = converter.toSQL(logic, sort, pagination)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql: querySql, params } = result.value
    console.log("MSSQL Pagination SQL:", querySql)
    // Should use OFFSET ROWS FETCH NEXT syntax
    expect(querySql).toContain("OFFSET")
    expect(querySql).toContain("FETCH NEXT")
    expect(querySql).not.toContain("LIMIT")

    const { query, request } = buildPositionalRequest(pool, querySql, params)
    const res = await request.query(`SELECT * FROM test_users ${query}`)
    expect(res.recordset).toHaveLength(2)
    expect(res.recordset[0].name).toBe("Charlie")
    expect(res.recordset[1].name).toBe("Bob")

    // Test pagination WITHOUT sort (should auto-inject ORDER BY (SELECT NULL))
    const resultNoSort = converter.toSQL(logic, undefined, { limit: 2 })
    expect(resultNoSort.ok).toBe(true)
    if (!resultNoSort.ok) return

    const { sql: querySqlNoSort, params: paramsNoSort } = resultNoSort.value
    console.log("MSSQL Pagination SQL (no sort):", querySqlNoSort)
    expect(querySqlNoSort).toContain("ORDER BY (SELECT NULL)")
    expect(querySqlNoSort).toContain("OFFSET")
    expect(querySqlNoSort).toContain("FETCH NEXT")

    const { query: queryNS, request: requestNS } = buildPositionalRequest(pool, querySqlNoSort, paramsNoSort)
    const resNS = await requestNS.query(`SELECT * FROM test_users ${queryNS}`)
    expect(resNS.recordset).toHaveLength(2)
  })
})

// ─── Test Suite 2: Named (@param) dialect ────────────────────────────────────

describe("Execute MSSQL SQL directly on MSSQL DB (named @param dialect)", () => {
  let pool: sql.ConnectionPool

  beforeAll(async () => {
    pool = await waitForMssql()

    await pool.request().query(`IF OBJECT_ID('test_users_named', 'U') IS NOT NULL DROP TABLE test_users_named`)
    await pool.request().query(`
      CREATE TABLE test_users_named (
        id     INT IDENTITY(1,1) PRIMARY KEY,
        name   NVARCHAR(255) NOT NULL,
        age    INT NOT NULL,
        salary INT NOT NULL,
        status NVARCHAR(50) NOT NULL,
        vip    BIT NOT NULL
      )
    `)
    await pool.request().query(`
      INSERT INTO test_users_named (name, age, salary, status, vip) VALUES
      ('Alice',   25, 1500, 'active',   1),
      ('Bob',     30, 2000, 'pending',  1),
      ('Charlie', 35, 3000, 'active',   0),
      ('David',   20, 1000, 'active',   1),
      ('Eve',     40, 4000, 'inactive', 0)
    `)
  })

  afterAll(async () => {
    if (pool) {
      await pool.request().query(`IF OBJECT_ID('test_users_named', 'U') IS NOT NULL DROP TABLE test_users_named`)
      await pool.close()
    }
  })

  const namedSchema: FieldSchema = {
    age: { type: "number", operators: ["==", ">", "<", ">=", "<=", "between"], constraints: { min: 0, max: 120 } },
    salary: { type: "number", operators: [">", "<", "=="], sortable: true },
    status: {
      type: "string",
      operators: ["==", "in", "not_in"],
      constraints: { allowedValues: ["active", "inactive", "pending"] },
    },
    vip: { type: "boolean", operators: ["=="] },
  }

  it("compiles and executes MSSQL named (@param) dialect — filter + sort", async () => {
    const converter = createConverter(namedSchema, { dialect: "mssql-named", sort: true })

    const logic = {
      and: [
        { "==": [{ var: "vip" }, true] },
        { in: [{ var: "status" }, ["active", "pending"]] },
        { ">=": [{ var: "age" }, 22] },
      ],
    }

    const result = converter.toSQL(logic, [{ field: "salary", direction: "desc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql: querySql, namedParams } = result.value
    console.log("SQL  :", querySql)
    console.log("Params:", namedParams)

    // Verify @param placeholders are used
    expect(querySql).toContain("@vip_")
    expect(querySql).toContain("@status_")
    expect(querySql).toContain("@age_")

    const request = buildNamedRequest(pool, namedParams ?? {})
    const res = await request.query(`SELECT * FROM test_users_named ${querySql}`)
    console.table(res.recordset)

    // vip=1, status IN (active,pending), age>=22 → Alice, Bob
    expect(res.recordset).toHaveLength(2)
    expect(res.recordset[0].name).toBe("Bob") // salary 2000 DESC
    expect(res.recordset[1].name).toBe("Alice") // salary 1500
  })

  it("verifies filterSql for COUNT queries with named params", async () => {
    const converter = createConverter(namedSchema, { dialect: "mssql-named", sort: true })

    const logic = {
      and: [{ "==": [{ var: "vip" }, true] }, { in: [{ var: "status" }, ["active", "pending"]] }],
    }

    const result = converter.toSQL(logic, [{ field: "salary", direction: "desc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql: querySql, filterSql, namedParams, filterNamedParams } = result.value

    // List query (all matching rows)
    const listReq = buildNamedRequest(pool, namedParams ?? {})
    const listRes = await listReq.query(`SELECT * FROM test_users_named ${querySql}`)
    expect(listRes.recordset).toHaveLength(3) // Alice, Bob, David

    // Count query — uses filterSql + filterNamedParams (no sort params)
    const countReq = buildNamedRequest(pool, filterNamedParams ?? {})
    const countRes = await countReq.query(`SELECT COUNT(*) AS total FROM test_users_named ${filterSql}`)
    expect(countRes.recordset[0].total).toBe(3)
  })
})

// ─── Test Suite 3: JSON path querying ────────────────────────────────────────

describe("Execute JSON Path SQL directly on MSSQL DB", () => {
  let pool: sql.ConnectionPool

  beforeAll(async () => {
    pool = await waitForMssql()

    await pool.request().query(`IF OBJECT_ID('json_users', 'U') IS NOT NULL DROP TABLE json_users`)
    await pool.request().query(`
      CREATE TABLE json_users (
        id       INT IDENTITY(1,1) PRIMARY KEY,
        name     NVARCHAR(255) NOT NULL,
        metadata NVARCHAR(MAX) NOT NULL
      )
    `)
    await pool.request().query(`
      INSERT INTO json_users (name, metadata) VALUES
      ('Alice',   '{"profile":{"age":25,"vip":true,"email":"alice@company.com"},"settings":{"theme":"dark"}}'),
      ('Bob',     '{"profile":{"age":17,"vip":false,"email":"bob@company.com"}}'),
      ('Charlie', '{"profile":{"age":30,"vip":true,"email":"charlie@company.com"},"preferences":{"lang":"en"}}')
    `)
  })

  afterAll(async () => {
    if (pool) {
      await pool.request().query(`IF OBJECT_ID('json_users', 'U') IS NOT NULL DROP TABLE json_users`)
      await pool.close()
    }
  })

  it("filters users using JSON_VALUE path querying with CAST on MSSQL", async () => {
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
    }

    const conv = createConverter(jsonSchema, { dialect: "mssql" })
    const result = conv.toSQL({
      and: [{ ">": [{ var: "user.profile.age" }, 20] }, { "==": [{ var: "user.profile.vip" }, true] }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql: querySql, params } = result.value
    console.log("JSON Path SQL:", querySql)
    // Should use CAST(...AS DECIMAL) and CAST(...AS BIT)
    expect(querySql).toContain("JSON_VALUE")
    expect(querySql).toContain("CAST")

    const { query, request } = buildPositionalRequest(pool, querySql, params)
    const res = await request.query(`SELECT * FROM json_users ${query}`)
    console.table(res.recordset)

    // age>20 AND vip=true → Alice(25,true), Charlie(30,true)
    expect(res.recordset).toHaveLength(2)
    const names = res.recordset.map((r: any) => r.name).sort()
    expect(names).toEqual(["Alice", "Charlie"])
  })

  it("filters users using json_has_key on MSSQL via JSON_VALUE/JSON_QUERY null check", async () => {
    const jsonSchema: FieldSchema = {
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }
    const conv = createConverter(jsonSchema, { dialect: "mssql" })

    // Only Alice has "settings" key
    const result = conv.toSQL({ json_has_key: [{ var: "metadata" }, "settings"] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    console.log("json_has_key SQL:", result.value.sql)
    const { query, request } = buildPositionalRequest(pool, result.value.sql, result.value.params)
    const res = await request.query(`SELECT * FROM json_users ${query}`)
    console.table(res.recordset)

    expect(res.recordset).toHaveLength(1)
    expect(res.recordset[0].name).toBe("Alice")
  })

  it("filters users using json_has_any_keys on MSSQL", async () => {
    const jsonSchema: FieldSchema = {
      metadata: { type: "array", operators: ["json_has_key", "json_has_any_keys"] },
    }
    const conv = createConverter(jsonSchema, { dialect: "mssql" })

    // Alice has "settings", Charlie has "preferences"
    const result = conv.toSQL({ json_has_any_keys: [{ var: "metadata" }, ["settings", "preferences"]] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    console.log("json_has_any_keys SQL:", result.value.sql)
    const { query, request } = buildPositionalRequest(pool, result.value.sql, result.value.params)
    const res = await request.query(`SELECT * FROM json_users ${query}`)
    console.table(res.recordset)

    expect(res.recordset).toHaveLength(2)
    const names = res.recordset.map((r: any) => r.name).sort()
    expect(names).toEqual(["Alice", "Charlie"])
  })
})
