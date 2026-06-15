import { createConverter, FieldSchema } from "../src/index.js"

// 1. Declare module augmentation to extend the FieldDef interface
// This lets TypeScript know about our custom properties on the schema fields.
declare module "../src/types.js" {
  interface FieldDef {
    permissionRequired?: string
    auditLog?: boolean
  }
}

// 2. Define the schema utilizing both declaration merging and dynamic metadata (index signature)
const schema: FieldSchema = {
  salary: {
    type: "number",
    operators: [">", "<", "=="],
    // custom attribute defined via TypeScript module augmentation (compile-time checked)
    permissionRequired: "hr:read-salary",
    auditLog: true,

    // config is allowed to specify any arbitrary field at runtime due to the index signature [key: string]: any
    config: {
      label: "Salary Amount",
      labelKey: "fields.salary",
      currency: "USD", // Custom metadata
      maskValue: true, // Custom metadata
    },
  },
  status: {
    type: "string",
    operators: ["==", "in"],
    constraints: {
      allowedValues: [
        { value: "active", label: "Active Status", color: "green", icon: "check-circle" },
        { value: "inactive", label: "Inactive Status", color: "red", icon: "x-circle" },
      ],
    },
    config: {
      label: "Status",
      badgeColor: "success", // Custom metadata
    },
  },
}

// 3. Compile the rules as usual
const converter = createConverter(schema)
const result = converter.toSQL({ ">": [{ var: "salary" }, 5000] })

if (result.ok) {
  console.log("SQL :", result.value.sql)
  console.log("Args:", result.value.params)
} else {
  console.error("Errors:", result.errors)
}
