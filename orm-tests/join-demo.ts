/**
 * Demo: multi-table schema với JOIN support
 *
 * Tables:
 *   users       ← base table
 *   orders      ← LEFT JOIN users.id = orders.user_id
 *   order_items ← LEFT JOIN orders.id = order_items.order_id
 *   products    ← INNER JOIN order_items.product_id = products.id
 */

import { createConverter, toPublicSchema } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema: FieldSchema = {
  // users table (base — no internal needed)
  user_name: { type: "string", operators: ["==", "contains", "startsWith"], sortable: true },
  user_age: {
    type: "number",
    operators: [">", ">=", "<", "<=", "==", "between"],
    sortable: true,
    constraints: { min: 0, max: 150 },
  },
  user_status: {
    type: "string",
    operators: ["==", "in"],
    constraints: { allowedValues: ["active", "inactive", "banned"] },
  },
  user_email: {
    type: "string",
    operators: ["=="],
    internal: { column: "email" },
  },

  // orders table  (alias: "o" → consumer writes: LEFT JOIN orders o ON users.id = o.user_id)
  order_status: {
    type: "string",
    operators: ["==", "in"],
    internal: { table: "orders", column: "status", alias: "o" },
    constraints: { allowedValues: ["pending", "paid", "cancelled", "shipped"] },
  },
  order_total: {
    type: "number",
    operators: [">", ">=", "<", "<=", "between"],
    sortable: true,
    internal: { table: "orders", column: "total_amount", alias: "o" },
  },
  order_created: {
    type: "date",
    operators: ["is_null", "is_not_null"],
    nullable: true,
    sortable: true,
    internal: { table: "orders", column: "created_at", alias: "o" },
  },

  // order_items table  (alias: "oi")
  item_qty: {
    type: "number",
    operators: [">", ">=", "=="],
    internal: { table: "order_items", column: "quantity", alias: "oi" },
  },
  item_price: {
    type: "number",
    operators: [">", ">=", "<", "<="],
    internal: { table: "order_items", column: "unit_price", alias: "oi" },
  },

  // products table  (alias: "p")
  product_name: {
    type: "string",
    operators: ["==", "contains"],
    sortable: true,
    internal: { table: "products", column: "name", alias: "p" },
  },
  product_sku: {
    type: "string",
    operators: ["=="],
    internal: { table: "products", column: "sku", alias: "p" },
  },

  // sortable-only (computed / no filter)
  order_rank: { sortable: true },
}

const conv = createConverter(schema, { sort: true })

// ─── Helper ───────────────────────────────────────────────────────────────────

function run(label: string, ...args: Parameters<typeof conv.toSQL>) {
  const result = conv.toSQL(...args)
  console.log(`\n── ${label}`)
  if (!result.ok) {
    console.log("  ERRORS:", result.errors.map((e) => `[${e.code}] ${e.message}`).join(", "))
    return
  }
  const { sql, filterSql, sortSql, params } = result.value
  console.log("  WHERE :", filterSql)
  if (sortSql) console.log("  ORDER :", sortSql)
  console.log("  SQL   :", sql)
  console.log("  params:", params)
}

// ─── Queries ──────────────────────────────────────────────────────────────────

// 1. Single table — no JOIN generated
run("users only (no JOIN)", {
  and: [{ "==": [{ var: "user_status" }, "active"] }, { ">=": [{ var: "user_age" }, 18] }],
})

// 2. Filter on joined table — auto JOIN orders
run("filter on orders (single JOIN)", {
  and: [
    { "==": [{ var: "user_status" }, "active"] },
    { ">": [{ var: "order_total" }, 500] },
    { in: [{ var: "order_status" }, ["paid", "shipped"]] },
  ],
})

// 3. Deep join chain — orders + order_items + products
run("deep join: user + orders + items + products", {
  and: [
    { ">=": [{ var: "user_age" }, 18] },
    { ">": [{ var: "order_total" }, 100] },
    { ">=": [{ var: "item_qty" }, 2] },
    { contains: [{ var: "product_name" }, "Pro"] },
  ],
})

// 4. Sort với table-qualified ORDER BY
run("sort by order_total DESC, product_name ASC", { ">": [{ var: "order_total" }, 0] }, [
  { field: "order_total", direction: "desc" },
  { field: "product_name", direction: "asc" },
])

// 5. Sortable-only field (order_rank — no filter)
run("sort by sortable-only field (order_rank)", { "==": [{ var: "user_status" }, "active"] }, [
  { field: "order_rank", direction: "asc" },
])

// 6. NOT / negation across joins
run("NOT (active AND paid) — negation", {
  "!": [
    {
      and: [{ "==": [{ var: "user_status" }, "active"] }, { "==": [{ var: "order_status" }, "paid"] }],
    },
  ],
})

// 7. Validation error — unknown field
run("unknown field → FIELD_NOT_ALLOWED", { "==": [{ var: "internal_secret" }, "x"] })

// 8. Validation error — sort on non-sortable field
run("sort on non-sortable field → SORT_FIELD_NOT_SORTABLE", { "==": [{ var: "user_status" }, "active"] }, [
  { field: "order_status", direction: "asc" },
])

// ─── toPublicSchema ───────────────────────────────────────────────────────────

console.log("\n── toPublicSchema (gửi FE — không có internal, không có columnName)")
const pub = toPublicSchema(schema)
console.log(JSON.stringify(pub, null, 2))
