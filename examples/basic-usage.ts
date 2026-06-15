import { createConverter, FieldSchema } from "../src/index.js"

const schema: FieldSchema = {
  age: {
    type: "number",
    operators: [">", "<", "==", "between"],
    constraints: { min: 0, max: 120 },
  },
  status: {
    type: "string",
    operators: ["==", "in"],
    constraints: { allowedValues: ["active", "inactive", "pending"] },
  },
}

const converter = createConverter(schema, { dialect: "postgres" })

// JSON Logic filter rule
const rule = {
  and: [{ ">": [{ var: "age" }, 18] }, { "==": [{ var: "status" }, "active"] }],
}

const result = converter.toSQL(rule)

if (result.ok) {
  const { sql, params } = result.value
  console.log("SQL   :", sql) // WHERE ("age" > $1 AND "status" = $2)
  console.log("Params:", params) // [18, "active"]
} else {
  console.error("Validation failed with errors:", result.errors)
}
