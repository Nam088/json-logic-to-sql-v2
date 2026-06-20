import { toPublicSchema, FieldSchema } from "../src/index.js"

// 1. Backend Schema Configuration (contains DB mapping and UI layout configs)
const serverSchema: FieldSchema = {
  age: {
    type: "number",
    operators: [">", "<", "==", "between", "in"],
    constraints: { min: 0, max: 120 },
    internal: { table: "users", column: "user_age" },
    config: {
      label: "Age",
      placeholder: "Enter age",
      component: "number-input",
    },
  },
  status: {
    type: "string",
    operators: ["==", "in", "is_null", "is_not_null"],
    constraints: {
      allowedValues: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
    internal: { table: "users", column: "status_code" },
    config: {
      label: "Status",
      placeholder: "Select status...",
      component: "select",
    },
  },
}

// Convert to Public Schema to send to Frontend
const publicSchema = toPublicSchema(serverSchema)

// 2. Define user-friendly display labels for Frontend operators
const OPERATOR_LABELS: Record<string, string> = {
  "==": "Equals",
  "!=": "Not Equals",
  ">": "Greater Than",
  "<": "Less Than",
  ">=": "Greater Than or Equal",
  "<=": "Less Than or Equal",
  between: "Between (Min - Max)",
  in: "In list (Multi-Select)",
  not_in: "Not in list",
  contains: "Contains keyword",
  startsWith: "Starts with",
  endsWith: "Ends with",
  is_null: "Is Empty / Null",
  is_not_null: "Is Not Empty / Not Null",
}

// 3. Simulate Frontend dynamic rendering based on the selected Field and Operator
interface FEFieldDef {
  type: string
  operators: string[]
  constraints?: {
    allowedValues?: Array<{ value: any; label: string } | any>
    min?: number | string
    max?: number | string
  }
  config?: {
    label?: string
    placeholder?: string
    component?: "select" | "number-input" | "text-input"
    [key: string]: any
  }
}

/**
 * Simulates rendering the value input depending on the chosen operator.
 */
function renderValueInputForOperator(fieldKey: string, fieldDef: FEFieldDef, selectedOp: string) {
  const componentType = fieldDef.config?.component ?? "text-input"
  const placeholder = fieldDef.config?.placeholder ?? ""

  console.log(`\n--- [FE Render] ${fieldDef.config?.label ?? fieldKey} with operator: "${OPERATOR_LABELS[selectedOp] ?? selectedOp}" ---`)

  // Step A: Render the operator dropdown selector
  console.log(`[Operator Dropdown] Allow user to select from: ${JSON.stringify(fieldDef.operators.map(op => OPERATOR_LABELS[op] ?? op))}`)
  console.log(`[Selected Operator] => "${OPERATOR_LABELS[selectedOp] ?? selectedOp}"`)

  // Step B: Render dynamic value input according to the selected operator
  switch (selectedOp) {
    case "is_null":
    case "is_not_null":
      // For empty/null check operators, no value input is needed!
      console.log(`[Value Input] => (No input field required - Null/NotNull check)`)
      break

    case "between":
      // Between operator requires 2 inputs (Min and Max)
      if (componentType === "number-input") {
        console.log(`[Value Input] => Render 2 number inputs: <NumberInput label="From" /> and <NumberInput label="To" />`)
      } else {
        console.log(`[Value Input] => Render 2 text inputs: <TextInput label="From" /> and <TextInput label="To" />`)
      }
      break

    case "in":
    case "not_in":
      // in/not_in operators require multi-select values
      if (fieldDef.constraints?.allowedValues) {
        console.log(`[Value Input] => Render Multi-select Dropdown: <Select multiple placeholder="${placeholder}">`)
        fieldDef.constraints.allowedValues.forEach((opt: any) => {
          console.log(`    * [Option] Value: "${opt.value}" | Label: "${opt.label}"`)
        })
        console.log(` </Select>`)
      } else {
        console.log(`[Value Input] => Render tag input: <TagInput placeholder="Enter comma-separated values..." />`)
      }
      break

    default:
      // Default (==, !=, >, <) renders a single input field
      if (componentType === "select" && fieldDef.constraints?.allowedValues) {
        console.log(`[Value Input] => Render Single-select Dropdown: <Select placeholder="${placeholder}">`)
        fieldDef.constraints.allowedValues.forEach((opt: any) => {
          console.log(`    * [Option] Value: "${opt.value}" | Label: "${opt.label}"`)
        })
        console.log(` </Select>`)
      } else if (componentType === "number-input") {
        console.log(`[Value Input] => Render single number input: <NumberInput placeholder="${placeholder}" />`)
      } else {
        console.log(`[Value Input] => Render single text input: <TextInput placeholder="${placeholder}" />`)
      }
      break
  }
}

// 4. Run Frontend dynamic interaction simulation
console.log("=== STARTING DYNAMIC FRONTEND INTERACTION SIMULATION ===")

// Scenario A: User selects field "age"
const ageField = publicSchema.age as FEFieldDef
// User selects operator ">"
renderValueInputForOperator("age", ageField, ">")
// User switches to operator "between"
renderValueInputForOperator("age", ageField, "between")
// User switches to operator "in"
renderValueInputForOperator("age", ageField, "in")

// Scenario B: User selects field "status"
const statusField = publicSchema.status as FEFieldDef
// User selects operator "=="
renderValueInputForOperator("status", statusField, "==")
// User switches to operator "is_null"
renderValueInputForOperator("status", statusField, "is_null")
