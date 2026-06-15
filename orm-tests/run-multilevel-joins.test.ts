import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { createConverter, defineOperator } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

const DB_CONNECTION_STRING = "postgresql://postgres:postgres@localhost:5432/postgres"

describe("Execute Multi-level JOIN SQL directly on PostgreSQL", () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: DB_CONNECTION_STRING })
    await client.connect()

    // Clean up tables if they exist
    await client.query(`DROP TABLE IF EXISTS multijoin_order_details CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_orders CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_customer_profiles CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_products CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_suppliers CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_categories CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_customers CASCADE;`)

    // Create 7 related tables representing a multi-level e-commerce system
    await client.query(`
      CREATE TABLE multijoin_customers (
        id INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        level INT NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE multijoin_customer_profiles (
        id SERIAL PRIMARY KEY,
        customer_id INT UNIQUE REFERENCES multijoin_customers(id) ON DELETE CASCADE,
        city VARCHAR(100) NOT NULL,
        country VARCHAR(100) NOT NULL,
        membership_vip BOOLEAN NOT NULL DEFAULT FALSE
      );
    `)

    await client.query(`
      CREATE TABLE multijoin_suppliers (
        id INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        location_country VARCHAR(100) NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE multijoin_categories (
        id INT PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE multijoin_products (
        id INT PRIMARY KEY,
        supplier_id INT REFERENCES multijoin_suppliers(id) ON DELETE SET NULL,
        category_id INT REFERENCES multijoin_categories(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        price NUMERIC(10,2) NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE multijoin_orders (
        id INT PRIMARY KEY,
        customer_id INT REFERENCES multijoin_customers(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        total NUMERIC(10,2) NOT NULL,
        order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `)

    await client.query(`
      CREATE TABLE multijoin_order_details (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES multijoin_orders(id) ON DELETE CASCADE,
        product_id INT REFERENCES multijoin_products(id) ON DELETE CASCADE,
        quantity INT NOT NULL
      );
    `)

    // Seed Data
    // Suppliers
    await client.query(`
      INSERT INTO multijoin_suppliers (id, name, location_country) VALUES
      (10, 'Apple Corp', 'USA'),
      (20, 'ZARA Group', 'Spain'),
      (30, 'Samsung Inc', 'Korea');
    `)

    // Categories
    await client.query(`
      INSERT INTO multijoin_categories (id, name) VALUES
      (1, 'Electronics'),
      (2, 'Apparel'),
      (3, 'Furniture');
    `)

    // Products
    await client.query(`
      INSERT INTO multijoin_products (id, supplier_id, category_id, name, price) VALUES
      (100, 10, 1, 'MacBook Pro', 1999.99),
      (101, 10, 1, 'iPhone 15', 999.99),
      (200, 20, 2, 'Leather Jacket', 149.99),
      (201, 20, 2, 'T-Shirt', 29.99),
      (300, 30, 1, 'Samsung Galaxy S24', 899.99);
    `)

    // Customers & Profiles
    await client.query(`
      INSERT INTO multijoin_customers (id, name, level) VALUES
      (1, 'Alice', 5),
      (2, 'Bob', 2),
      (3, 'Charlie', 4);
    `)

    await client.query(`
      INSERT INTO multijoin_customer_profiles (customer_id, city, country, membership_vip) VALUES
      (1, 'Paris', 'France', TRUE),
      (2, 'London', 'UK', FALSE),
      (3, 'New York', 'USA', TRUE);
    `)

    // Orders & Details
    // Alice ordered MacBook Pro (Electronics from USA) and Leather Jacket (Apparel from Spain) - total: 2150.00
    await client.query(`
      INSERT INTO multijoin_orders (id, customer_id, status, total) VALUES
      (500, 1, 'completed', 2150.00);
    `)
    await client.query(`
      INSERT INTO multijoin_order_details (order_id, product_id, quantity) VALUES
      (500, 100, 1),
      (500, 200, 1);
    `)

    // Bob ordered Samsung S24 (Electronics from Korea) - total: 900.00 (pending)
    await client.query(`
      INSERT INTO multijoin_orders (id, customer_id, status, total) VALUES
      (501, 2, 'pending', 900.00);
    `)
    await client.query(`
      INSERT INTO multijoin_order_details (order_id, product_id, quantity) VALUES
      (501, 300, 1);
    `)

    // Charlie ordered T-Shirt (Apparel from Spain) - total: 30.00 (completed)
    await client.query(`
      INSERT INTO multijoin_orders (id, customer_id, status, total) VALUES
      (502, 3, 'completed', 30.00);
    `)
    await client.query(`
      INSERT INTO multijoin_order_details (order_id, product_id, quantity) VALUES
      (502, 201, 1);
    `)
  })

  afterAll(async () => {
    // Drop all tables
    await client.query(`DROP TABLE IF EXISTS multijoin_order_details CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_orders CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_customer_profiles CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_products CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_suppliers CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_categories CASCADE;`)
    await client.query(`DROP TABLE IF EXISTS multijoin_customers CASCADE;`)
    await client.end()
  })

  it("translates and executes a 7-table multi-layer JOIN query filtering on diverse nested dimensions", async () => {
    // Define the FieldSchema utilizing internal configurations with table aliases for all joined dimensions
    const schema: FieldSchema = {
      // 1. Customer table (alias c)
      customer_name: { type: "string", operators: ["=="], internal: { table: "multijoin_customers", column: "name", alias: "c" } },
      
      // 2. Profile table (alias cp)
      customer_vip: { type: "boolean", operators: ["=="], internal: { table: "multijoin_customer_profiles", column: "membership_vip", alias: "cp" } },
      customer_city: { type: "string", operators: ["==", "in"], internal: { table: "multijoin_customer_profiles", column: "city", alias: "cp" } },
      
      // 3. Orders table (alias o)
      order_status: { type: "string", operators: ["=="], internal: { table: "multijoin_orders", column: "status", alias: "o" } },
      order_total: { type: "number", operators: [">", "<"], internal: { table: "multijoin_orders", column: "total", alias: "o" }, sortable: true },
      
      // 4. Products table (alias p)
      product_price: { type: "number", operators: [">"], internal: { table: "multijoin_products", column: "price", alias: "p" } },

      // 5. Category table (alias cat)
      category_name: { type: "string", operators: ["=="], internal: { table: "multijoin_categories", column: "name", alias: "cat" } },

      // 6. Supplier table (alias s)
      supplier_country: { type: "string", operators: ["=="], internal: { table: "multijoin_suppliers", column: "location_country", alias: "s" } },
    }

    const converter = createConverter(schema, { sort: true })

    // JSON Logic Criteria:
    // - Customer must be VIP (cp.membership_vip == true)
    // - Order status is "completed" (o.status == "completed")
    // - Order total is > 100 (o.total > 100)
    // - Product Category is "Electronics" (cat.name == "Electronics")
    // - Supplier Country is "USA" (s.location_country == "USA")
    const complexFilter = {
      and: [
        { "==": [{ var: "customer_vip" }, true] },
        { "==": [{ var: "order_status" }, "completed"] },
        { ">": [{ var: "order_total" }, 100] },
        { "==": [{ var: "category_name" }, "Electronics"] },
        { "==": [{ var: "supplier_country" }, "USA"] },
      ],
    }

    const result = converter.toSQL(complexFilter, [{ field: "order_total", direction: "desc" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, params } = result.value

    // Build the full multi-table query with all necessary JOIN clauses
    const query = `
      SELECT 
        c.name AS customer_name,
        cp.membership_vip AS customer_vip,
        cp.city AS customer_city,
        o.id AS order_id,
        o.status AS order_status,
        o.total AS order_total,
        p.name AS product_name,
        cat.name AS category_name,
        s.name AS supplier_name,
        s.location_country AS supplier_country
      FROM multijoin_customers c
      INNER JOIN multijoin_customer_profiles cp ON c.id = cp.customer_id
      INNER JOIN multijoin_orders o ON c.id = o.customer_id
      INNER JOIN multijoin_order_details od ON o.id = od.order_id
      INNER JOIN multijoin_products p ON od.product_id = p.id
      INNER JOIN multijoin_categories cat ON p.category_id = cat.id
      INNER JOIN multijoin_suppliers s ON p.supplier_id = s.id
      ${sql}
    `

    const dbResult = await client.query(query, params)

    // Verify correct execution & records mapping
    // - Alice: VIP (true), completed, total (2150.00 > 100), has Electronics product from USA (MacBook Pro). (Should be returned)
    // - Bob: not VIP, pending order. (Should be filtered out)
    // - Charlie: VIP, completed, but total (30.00 < 100), and Apparel product from Spain. (Should be filtered out)
    expect(dbResult.rows).toHaveLength(1)
    
    const row = dbResult.rows[0]
    expect(row.customer_name).toBe("Alice")
    expect(row.customer_vip).toBe(true)
    expect(row.customer_city).toBe("Paris")
    expect(row.order_status).toBe("completed")
    expect(parseFloat(row.order_total)).toBe(2150.00)
    expect(row.product_name).toBe("MacBook Pro")
    expect(row.category_name).toBe("Electronics")
    expect(row.supplier_name).toBe("Apple Corp")
    expect(row.supplier_country).toBe("USA")
  })

  it("compiles and executes a custom arithmetic calculation operator across joined columns (quantity * price > 1000)", async () => {
    // 1. Define schema fields representing joined columns
    const schema: FieldSchema = {
      item_quantity: {
        type: "number",
        operators: ["calc_item_total_gt"],
        internal: { table: "multijoin_order_details", column: "quantity", alias: "od" },
      },
      product_price: {
        type: "number",
        operators: [], // sortable/reference-only, no operators allowed directly on filter
        internal: { table: "multijoin_products", column: "price", alias: "p" },
      },
    }

    // 2. Initialize converter with custom operator 'calc_item_total_gt'
    const converter = createConverter(schema, {
      operators: {
        calc_item_total_gt: defineOperator({
          allowedTypes: ["number"],
          arity: "variadic",
          validate: (customArgs) => {
            const args = Array.isArray(customArgs[0]) ? customArgs[0] : customArgs
            if (args.length !== 2) return "calc_item_total_gt requires a product_price field reference and a threshold value"
            const [fieldRef, threshold] = args
            if (typeof fieldRef !== "object" || fieldRef === null || !("var" in fieldRef)) {
              return "First argument must be a field reference"
            }
            if (typeof threshold !== "number" || threshold <= 0) {
              return "Second argument must be a positive number threshold"
            }
            const targetField = (fieldRef as { var: string }).var
            const targetDef = schema[targetField]
            if (!targetDef || targetDef.type !== "number") {
              return `First argument must be a valid number field, but got ${targetField}`
            }
            return true
          },
          compile: (ctx, node) => {
            // Left: od.quantity
            const leftCol = ctx.dialect.quoteIdentifier(node.columnName)
            const leftTbl = node.tableName ? ctx.dialect.quoteIdentifier(node.tableName) : ""
            const fullLeft = leftTbl ? `${leftTbl}.${leftCol}` : leftCol

            // Right 1: product_price reference { var: "product_price" }
            const val = node.values[0]
            if (typeof val === "object" && val !== null && "var" in val) {
              const fieldName = (val as { var: string }).var
              const fieldDef = schema[fieldName]
              if (fieldDef) {
                const rightCol = ctx.dialect.quoteIdentifier(fieldDef.internal?.column ?? fieldDef.columnName ?? fieldName)
                const rightTbl = fieldDef.internal?.alias ?? fieldDef.internal?.table
                const fullRight = rightTbl ? `${ctx.dialect.quoteIdentifier(rightTbl)}.${rightCol}` : rightCol

                // Right 2: threshold parameter
                const thresholdVal = node.values[1] as number
                const pThreshold = ctx.addParam(thresholdVal, "threshold")

                // Formula: (od.quantity * p.price) > :threshold
                return `((${fullLeft} * ${fullRight}) > ${pThreshold})`
              }
            }
            throw new Error("calc_item_total_gt compiler expects a field reference as first argument")
          },
        }),
      },
    })

    // JSON Logic rule checking if (item_quantity * product_price) > 1000
    const filterLogic = {
      calc_item_total_gt: [
        { var: "item_quantity" },
        { var: "product_price" },
        1000,
      ],
    }

    const result = converter.toSQL(filterLogic)
    if (!result.ok) {
      console.log("VALIDATION ERRORS:", JSON.stringify(result.errors, null, 2))
    }
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { sql, params } = result.value
    console.log("Calculation JOIN SQL:", sql)
    console.log("Calculation Params  :", params)

    expect(sql).toBe('WHERE (("od"."quantity" * "p"."price") > $1)')

    const query = `
      SELECT 
        c.name AS customer_name,
        o.id AS order_id,
        od.quantity AS item_quantity,
        p.name AS product_name,
        p.price AS product_price,
        (od.quantity * p.price) AS calculated_item_total
      FROM multijoin_customers c
      INNER JOIN multijoin_orders o ON c.id = o.customer_id
      INNER JOIN multijoin_order_details od ON o.id = od.order_id
      INNER JOIN multijoin_products p ON od.product_id = p.id
      ${sql}
    `

    const dbResult = await client.query(query, params)
    console.log("Calculated JOIN Results:")
    console.table(dbResult.rows)

    // - Alice: ordered 1 MacBook Pro (1999.99 * 1 = 1999.99 > 1000). (Should be returned)
    // - Alice: also ordered 1 Leather Jacket (149.99 * 1 = 149.99 < 1000). (Filtered out)
    // - Bob: ordered 1 Samsung S24 (899.99 * 1 = 899.99 < 1000). (Filtered out)
    // - Charlie: ordered 1 T-Shirt (29.99 * 1 = 29.99 < 1000). (Filtered out)
    expect(dbResult.rows).toHaveLength(1)
    expect(dbResult.rows[0].customer_name).toBe("Alice")
    expect(dbResult.rows[0].product_name).toBe("MacBook Pro")
    expect(parseFloat(dbResult.rows[0].calculated_item_total)).toBe(1999.99)
  })
})
