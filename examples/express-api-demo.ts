import express from "express"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createConverter, toPublicSchema, FieldSchema } from "../src/index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, "../public")))

// 1. Initialize SQLite in-memory database and populate sample data
const db = new DatabaseSync(":memory:")
db.exec(`
  CREATE TABLE api_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    status TEXT NOT NULL,
    vip INTEGER NOT NULL,
    metadata TEXT
  );
`)

const insert = db.prepare(`
  INSERT INTO api_users (name, age, status, vip, metadata) VALUES (?, ?, ?, ?, ?)
`)
insert.run("Alice", 25, "active", 1, JSON.stringify({ profile: { city: "New York", rating: 5 } }))  // VIP
insert.run("Bob", 30, "pending", 1, JSON.stringify({ profile: { city: "Los Angeles", rating: 4 } }))   // VIP
insert.run("Charlie", 35, "active", 0, JSON.stringify({ profile: { city: "New York", rating: 3 } })) // Non-VIP
insert.run("David", 17, "active", 1, JSON.stringify({ profile: { city: "Chicago", rating: 5 } }))   // VIP (minor)
insert.run("Eve", 40, "inactive", 0, JSON.stringify({ profile: { city: "Los Angeles", rating: 2 } }))   // Non-VIP

// 2. Define FieldSchema on the Backend
const schema: FieldSchema = {
  id: {
    type: "number",
    operators: ["==", "===", "!=", "!==", ">", "<", ">=", "<=", "between", "in", "not_in"],
    config: {
      label: "User ID",
      placeholder: "Enter ID...",
      component: "number-input",
    },
  },
  name: {
    type: "string",
    operators: ["==", "===", "!=", "!==", "contains", "not_contains", "startsWith", "endsWith", "like", "ilike", "is_null", "is_not_null"],
    config: {
      label: "Full Name",
      placeholder: "Enter name...",
      component: "text-input",
    },
  },
  age: {
    type: "number",
    operators: ["==", "===", "!=", "!==", ">", "<", ">=", "<=", "between", "is_null", "is_not_null"],
    constraints: { min: 0, max: 120 },
    config: {
      label: "Age",
      placeholder: "Enter age (0-120)",
      component: "number-input",
    },
  },
  status: {
    type: "string",
    operators: ["==", "===", "!=", "!==", "in", "not_in", "is_null", "is_not_null"],
    constraints: { allowedValues: ["active", "inactive", "pending"] },
    config: {
      label: "Status",
      placeholder: "Select status...",
      component: "select",
    },
  },
  vip: {
    type: "boolean",
    operators: ["==", "===", "!=", "!==", "is_null", "is_not_null"],
    config: {
      label: "VIP Member",
      component: "switch",
    },
  },
  "metadata.profile.city": {
    type: "string",
    columnName: "metadata",
    jsonPath: ["profile", "city"],
    operators: ["==", "===", "!=", "!==", "contains", "startsWith", "is_null", "is_not_null"],
    config: {
      label: "City (JSON)",
      placeholder: "Enter city...",
      component: "text-input",
    },
  },
  "metadata.profile.rating": {
    type: "number",
    columnName: "metadata",
    jsonPath: ["profile", "rating"],
    operators: ["==", "===", "!=", "!==", ">", "<", "between", "is_null", "is_not_null"],
    config: {
      label: "Rating Stars (JSON)",
      placeholder: "Enter rating (1-5)",
      component: "number-input",
    },
  },
}

// Initialize compiler targeting SQLite Dialect
const converter = createConverter(schema, { dialect: "sqlite", sort: true })

/**
 * Endpoint 1: GET /api/schema
 * Returns the public schema for the frontend to render query builder UI.
 */
app.get("/api/schema", (_req, res) => {
  const publicSchema = toPublicSchema(schema)
  res.json({
    success: true,
    schema: publicSchema,
  })
})

/**
 * Endpoint 2: POST /api/query
 * Receives JSON Logic query, validates and executes it.
 */
app.post("/api/query", (req, res) => {
  const { filter, sort, pagination } = req.body

  // Safe compilation and validation
  const result = converter.toSQL(filter, sort, pagination)

  if (!result.ok) {
    // Return validation errors
    res.status(400).json({
      success: false,
      errors: result.errors,
    })
    return
  }

  const { sql, params, filterSql, filterParams } = result.value

  try {
    // A. Execute list query with LIMIT/OFFSET
    const listStmt = db.prepare(`SELECT * FROM api_users ${sql}`)
    const rows = listStmt.all(...(params as any[]))

    // B. Execute count query (without LIMIT/OFFSET parameters)
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM api_users ${filterSql}`)
    const countRes = countStmt.all(...(filterParams as any[])) as any[]
    const total = countRes[0]?.total ?? 0

    res.json({
      success: true,
      data: {
        sql,
        params,
        rows,
        total,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Database query error",
    })
  }
})

// Listen on port 3000
const PORT = 3000
const server = app.listen(PORT, () => {
  console.log(`[Express API] Server is running at http://localhost:${PORT}`)
  console.log(`[GET]  Get UI schema: http://localhost:${PORT}/api/schema`)
  console.log(`[POST] Safe query execution: http://localhost:${PORT}/api/query`)
})

// Clean shutdown support
export { server }
