import express from "express"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createConverter, toPublicSchema, FieldSchema } from "../src/index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, "../public")))

// 1. Khởi tạo cơ sở dữ liệu SQLite in-memory và thêm dữ liệu mẫu để chạy thực tế
const db = new DatabaseSync(":memory:")
db.exec(`
  CREATE TABLE api_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    age INTEGER NOT NULL,
    status TEXT NOT NULL,
    vip INTEGER NOT NULL
  );
`)

const insert = db.prepare(`
  INSERT INTO api_users (name, age, status, vip) VALUES (?, ?, ?, ?)
`)
insert.run("Alice", 25, "active", 1)  // VIP
insert.run("Bob", 30, "pending", 1)   // VIP
insert.run("Charlie", 35, "active", 0) // Non-VIP
insert.run("David", 17, "active", 1)   // VIP (minor)
insert.run("Eve", 40, "inactive", 0)   // Non-VIP

// 2. Định nghĩa FieldSchema ở Backend
const schema: FieldSchema = {
  id: { type: "number", operators: ["==", "!=", ">", "<"] },
  name: { type: "string", operators: ["==", "contains"] },
  age: {
    type: "number",
    operators: ["==", ">", "<", ">=", "<=", "between"],
    constraints: { min: 0, max: 120 },
    config: {
      label: "Tuổi",
      placeholder: "Nhập số tuổi (0-120)",
      component: "number-input",
    },
  },
  status: {
    type: "string",
    operators: ["==", "in", "not_in"],
    constraints: { allowedValues: ["active", "inactive", "pending"] },
    config: {
      label: "Trạng thái",
      placeholder: "Chọn trạng thái...",
      component: "select",
    },
  },
  vip: {
    type: "boolean",
    operators: ["=="],
    config: {
      label: "Thành viên VIP",
      component: "switch",
    },
  },
}

// Khởi tạo bộ biên dịch target SQLite Dialect
const converter = createConverter(schema, { dialect: "sqlite", sort: true })

/**
 * Endpoint 1: GET /api/schema
 * Trả về Public Schema đã dọn dẹp các trường bảo mật để Frontend render giao diện bộ lọc.
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
 * Nhận cấu trúc JSON Logic từ Client, kiểm tra tính hợp lệ và thực thi truy vấn.
 */
app.post("/api/query", (req, res) => {
  const { filter, sort, pagination } = req.body

  // Biên dịch và validate an toàn
  const result = converter.toSQL(filter, sort, pagination)

  if (!result.ok) {
    // Trả về mã lỗi 400 và chi tiết lỗi kiểm tra schema (chống probing/smuggling)
    res.status(400).json({
      success: false,
      errors: result.errors,
    })
    return
  }

  const { sql, params, filterSql, filterParams } = result.value

  try {
    // A. Thực thi truy vấn danh sách (List Query) kèm LIMIT/OFFSET
    const listStmt = db.prepare(`SELECT * FROM api_users ${sql}`)
    // Chuyển đổi boolean thành 0/1 cho tương thích SQLite
    const sqliteParams = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p))
    const rows = listStmt.all(...(sqliteParams as any[]))

    // B. Thực thi truy vấn đếm số lượng (Count Query) dùng filterParams (không bị lệch tham số do LIMIT/OFFSET)
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM api_users ${filterSql}`)
    const sqliteFilterParams = filterParams.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p))
    const countRes = countStmt.all(...(sqliteFilterParams as any[])) as any[]
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
      message: error.message || "Lỗi truy vấn cơ sở dữ liệu",
    })
  }
})

// Khởi động server demo trên cổng 3000
const PORT = 3000
const server = app.listen(PORT, () => {
  console.log(`[Express API] Server đang chạy tại http://localhost:${PORT}`)
  console.log(`[GET]  Lấy schema giao diện: http://localhost:${PORT}/api/schema`)
  console.log(`[POST] Truy vấn dữ liệu an toàn: http://localhost:${PORT}/api/query`)
})

// Hỗ trợ tắt server sạch sẽ nếu cần
export { server }
