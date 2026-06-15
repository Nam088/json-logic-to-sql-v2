import { toPublicSchema, FieldSchema } from "../src/index.js"

// 1. Cấu hình Schema ở Backend (chứa thông tin DB và UI cấu hình)
const serverSchema: FieldSchema = {
  age: {
    type: "number",
    operators: [">", "<", "==", "between", "in"],
    constraints: { min: 0, max: 120 },
    internal: { table: "users", column: "user_age" },
    config: {
      label: "Tuổi",
      placeholder: "Nhập số tuổi",
      component: "number-input",
    },
  },
  status: {
    type: "string",
    operators: ["==", "in", "is_null", "is_not_null"],
    constraints: {
      allowedValues: [
        { value: "active", label: "Đang hoạt động" },
        { value: "inactive", label: "Tạm dừng" },
      ],
    },
    internal: { table: "users", column: "status_code" },
    config: {
      label: "Trạng thái",
      placeholder: "Chọn trạng thái...",
      component: "select",
    },
  },
}

// Chuyển đổi thành Public Schema gửi về Frontend
const publicSchema = toPublicSchema(serverSchema)

// 2. Định nghĩa nhãn hiển thị thân thiện cho các toán tử ở FE
const OPERATOR_LABELS: Record<string, string> = {
  "==": "Bằng",
  "!=": "Khác",
  ">": "Lớn hơn",
  "<": "Nhỏ hơn",
  ">=": "Lớn hơn hoặc bằng",
  "<=": "Nhỏ hơn hoặc bằng",
  between: "Nằm trong khoảng (Min - Max)",
  in: "Một trong số các giá trị (Multi-Select)",
  not_in: "Không nằm trong số các giá trị",
  contains: "Chứa từ khoá",
  startsWith: "Bắt đầu với",
  endsWith: "Kết thúc với",
  is_null: "Không có giá trị (Rỗng)",
  is_not_null: "Có giá trị (Khác rỗng)",
}

// 3. Mô phỏng hàm render động của Frontend dựa trên Trường và Toán tử đang được chọn
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
 * Hàm mô phỏng render ô nhập liệu tuỳ thuộc vào toán tử được chọn.
 */
function renderValueInputForOperator(fieldKey: string, fieldDef: FEFieldDef, selectedOp: string) {
  const componentType = fieldDef.config?.component ?? "text-input"
  const placeholder = fieldDef.config?.placeholder ?? ""

  console.log(`\n--- [FE Render] ${fieldDef.config?.label ?? fieldKey} với toán tử: "${OPERATOR_LABELS[selectedOp] ?? selectedOp}" ---`)

  // Bước A: Hiển thị bộ chọn toán tử (Dropdown)
  console.log(`[Toán tử Dropdown] Cho phép người dùng chọn từ: ${JSON.stringify(fieldDef.operators.map(op => OPERATOR_LABELS[op] ?? op))}`)
  console.log(`[Toán tử Đang chọn] => "${OPERATOR_LABELS[selectedOp] ?? selectedOp}"`)

  // Bước B: Render ô nhập giá trị động tương ứng với toán tử đang chọn
  switch (selectedOp) {
    case "is_null":
    case "is_not_null":
      // Đối với toán tử kiểm tra rỗng, không cần render ô nhập giá trị!
      console.log(`[Giá trị Input] => (Không cần ô nhập liệu - toán tử kiểm tra Null/NotNull)`)
      break

    case "between":
      // Toán tử between yêu cầu 2 ô nhập liệu (Min và Max)
      if (componentType === "number-input") {
        console.log(`[Giá trị Input] => Render 2 ô số: <NumberInput label="Từ" /> và <NumberInput label="Đến" />`)
      } else {
        console.log(`[Giá trị Input] => Render 2 ô chữ: <TextInput label="Từ" /> và <TextInput label="Đến" />`)
      }
      break

    case "in":
    case "not_in":
      // Toán tử in/not_in yêu cầu chọn nhiều giá trị
      if (fieldDef.constraints?.allowedValues) {
        console.log(`[Giá trị Input] => Render Multi-select Dropdown: <Select multiple placeholder="${placeholder}">`)
        fieldDef.constraints.allowedValues.forEach((opt: any) => {
          console.log(`    * [Option] Value: "${opt.value}" | Label: "${opt.label}"`)
        })
        console.log(` </Select>`)
      } else {
        console.log(`[Giá trị Input] => Render ô nhập thẻ: <TagInput placeholder="Nhập các giá trị cách nhau bằng dấu phẩy..." />`)
      }
      break

    default:
      // Mặc định (==, !=, >, <) render 1 ô nhập đơn lẻ
      if (componentType === "select" && fieldDef.constraints?.allowedValues) {
        console.log(`[Giá trị Input] => Render Single-select Dropdown: <Select placeholder="${placeholder}">`)
        fieldDef.constraints.allowedValues.forEach((opt: any) => {
          console.log(`    * [Option] Value: "${opt.value}" | Label: "${opt.label}"`)
        })
        console.log(` </Select>`)
      } else if (componentType === "number-input") {
        console.log(`[Giá trị Input] => Render ô nhập số đơn lẻ: <NumberInput placeholder="${placeholder}" />`)
      } else {
        console.log(`[Giá trị Input] => Render ô nhập chữ đơn lẻ: <TextInput placeholder="${placeholder}" />`)
      }
      break
  }
}

// 4. Chạy mô phỏng tương tác trên Frontend
console.log("=== BẮT ĐẦU MÔ PHỎNG FRONTEND TƯƠNG TÁC ĐỘNG ===")

// Trường hợp A: Người dùng chọn trường "age" (Tuổi)
const ageField = publicSchema.age as FEFieldDef
// Người dùng chọn toán tử ">"
renderValueInputForOperator("age", ageField, ">")
// Người dùng đổi sang chọn toán tử "between"
renderValueInputForOperator("age", ageField, "between")
// Người dùng đổi sang chọn toán tử "in"
renderValueInputForOperator("age", ageField, "in")

// Trường hợp B: Người dùng chọn trường "status" (Trạng thái)
const statusField = publicSchema.status as FEFieldDef
// Người dùng chọn toán tử "=="
renderValueInputForOperator("status", statusField, "==")
// Người dùng đổi sang chọn toán tử "is_null"
renderValueInputForOperator("status", statusField, "is_null")
