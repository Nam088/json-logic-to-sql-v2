import { createConverter, FieldSchema } from "../src/index.js"

const schema: FieldSchema = {
  age: { type: "number", operators: [">", "=="] },
  salary: { type: "number", operators: [">"], sortable: true },
}

const rule = { ">": [{ var: "age" }, 18] }
const sortRules = [{ field: "salary", direction: "desc" as const }]
const pagination = { limit: 10, offset: 5 }

// 1. Compile for SQL Server (MSSQL)
const mssqlConverter = createConverter(schema, { dialect: "mssql", sort: true })
const mssqlResult = mssqlConverter.toSQL(rule, sortRules, pagination)

if (mssqlResult.ok) {
  console.log("--- MSSQL Output ---")
  console.log("SQL   :", mssqlResult.value.sql)
  // Expected: WHERE [age] > ? ORDER BY [salary] DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
  console.log("Params:", mssqlResult.value.params) // [18, 5, 10]
}

// 2. Compile for PostgreSQL
const postgresConverter = createConverter(schema, { dialect: "postgres", sort: true })
const postgresResult = postgresConverter.toSQL(rule, sortRules, pagination)

if (postgresResult.ok) {
  console.log("\n--- PostgreSQL Output ---")
  console.log("SQL   :", postgresResult.value.sql)
  // Expected: WHERE "age" > $1 ORDER BY "salary" DESC LIMIT $2 OFFSET $3
  console.log("Params:", postgresResult.value.params) // [18, 10, 5]
}
