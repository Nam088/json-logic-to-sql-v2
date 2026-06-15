import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { createConverter } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

const DB_CONNECTION_STRING = "postgresql://postgres:postgres@localhost:5432/postgres"

describe("Execute Multi-table JOIN SQL directly on Postgres", () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: DB_CONNECTION_STRING })
    await client.connect()

    // 1. Setup multi-table database schema with prefix to avoid collision
    await client.query(`DROP TABLE IF EXISTS join_order_items CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS join_orders CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS join_products CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS join_users CASCADE;`)

    await client.query(`
      CREATE TABLE join_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        age INT NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE join_products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100) NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE join_orders (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES join_users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        total_amount NUMERIC(10,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `)

    await client.query(`
      CREATE TABLE join_order_items (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES join_orders(id) ON DELETE CASCADE,
        product_id INT REFERENCES join_products(id) ON DELETE CASCADE,
        quantity INT NOT NULL,
        unit_price NUMERIC(10,2) NOT NULL
      );
    `)

    // 2. Insert test data
    await client.query(`
      INSERT INTO join_users (id, name, age) VALUES 
      (1, 'Alice', 25), 
      (2, 'Bob', 30),
      (3, 'Charlie', 17),
      (4, 'David', 28);
    `)

    await client.query(`
      INSERT INTO join_products (id, name, sku) VALUES 
      (10, 'iPhone 15 Pro', 'IPHONE-15'), 
      (11, 'MacBook Air', 'MAC-AIR'), 
      (12, 'AirPods Pro', 'AIR-PRO'),
      (13, 'iPhone 14', 'IPHONE-14');
    `)

    await client.query(`
      INSERT INTO join_orders (id, user_id, status, total_amount) VALUES 
      (100, 1, 'paid', 1200.00),     -- Alice ordered iPhone 15 & AirPods
      (101, 2, 'pending', 2000.00),  -- Bob ordered MacBook
      (102, 3, 'paid', 200.00),      -- Charlie (minor) ordered AirPods
      (103, 4, 'paid', 800.00);      -- David ordered iPhone 14
    `)

    await client.query(`
      INSERT INTO join_order_items (order_id, product_id, quantity, unit_price) VALUES 
      (100, 10, 1, 1000.00), -- iPhone 15 for Alice
      (100, 12, 1, 200.00),  -- AirPods for Alice
      (101, 11, 1, 2000.00), -- MacBook for Bob
      (102, 12, 1, 200.00),  -- AirPods for Charlie
      (103, 13, 1, 800.00);  -- iPhone 14 for David
    `)
  })

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS join_order_items CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS join_orders CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS join_products CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS join_users CASCADE;`)
    await client.end()
  })

  it("compiles and successfully runs a multi-table JOIN query filtering across users, orders and products", async () => {
    // 3. Define schema with internal mappings/aliases matching the JOIN query
    const schema: FieldSchema = {
      // Base table (join_users) — alias "u"
      user_name: { type: "string", operators: ["=="], internal: { table: "join_users", column: "name", alias: "u" } },
      user_age: {
        type: "number",
        operators: [">=", "<"],
        internal: { table: "join_users", column: "age", alias: "u" },
      },

      // Joined table (join_orders) — alias "o"
      order_status: {
        type: "string",
        operators: ["=="],
        internal: { table: "join_orders", column: "status", alias: "o" },
      },
      order_total: {
        type: "number",
        operators: [">"],
        internal: { table: "join_orders", column: "total_amount", alias: "o" },
        sortable: true,
      },

      // Deeply joined table (join_products) — alias "p"
      product_name: {
        type: "string",
        operators: ["contains"],
        internal: { table: "join_products", column: "name", alias: "p" },
      },
    }

    const conv = createConverter(schema, { sort: true })

    // Query criteria:
    // - User age is >= 18
    // - Order status is "paid"
    // - Product name contains "iPhone"
    const complexLogic = {
      and: [
        { ">=": [{ var: "user_age" }, 18] },
        { "==": [{ var: "order_status" }, "paid"] },
        { contains: [{ var: "product_name" }, "iPhone"] },
      ],
    }

    // Sort by order_total descending
    const sort = [{ field: "order_total", direction: "desc" as const }]

    const result = conv.toSQL(complexLogic, sort)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, params } = result.value
    console.log("Generated WHERE SQL:", sql)
    console.log("Parameters         :", params)

    // Assemble the complete SELECT query with JOIN statements and our generated WHERE/ORDER clauses
    const query = `
      SELECT 
        u.name AS user_name, 
        u.age AS user_age, 
        o.id AS order_id, 
        o.status AS order_status, 
        o.total_amount AS order_total, 
        p.name AS product_name
      FROM join_users u
      LEFT JOIN join_orders o ON u.id = o.user_id
      LEFT JOIN join_order_items oi ON o.id = oi.order_id
      INNER JOIN join_products p ON oi.product_id = p.id
      ${sql}
    `

    const res = await client.query(query, params)

    console.log("JOIN Query Results:")
    console.table(res.rows)

    // Verify correct filtering & sorting (ORDER BY):
    // - Charlie should be filtered out (age 17 < 18)
    // - Bob should be filtered out (status pending)
    // - Alice (1200.00) and David (800.00) should be returned
    // - Alice must be the first row since total_amount 1200 > 800 (DESC sort)
    expect(res.rows).toHaveLength(2)

    expect(res.rows[0].user_name).toBe("Alice")
    expect(res.rows[0].product_name).toBe("iPhone 15 Pro")
    expect(parseFloat(res.rows[0].order_total)).toBe(1200)

    expect(res.rows[1].user_name).toBe("David")
    expect(res.rows[1].product_name).toBe("iPhone 14")
    expect(parseFloat(res.rows[1].order_total)).toBe(800)
  })
})
