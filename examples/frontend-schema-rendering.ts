import { toPublicSchema, FieldSchema } from "../src/index.js"

// 1. Cấu hình Schema ở Backend (chứa cả cấu hình Database nội bộ lẫn cấu hình UI cho Frontend)
const serverSchema: FieldSchema = {
  // Trường age: Nhập số, hiển thị ô input dạng số (Number Input)
  age: {
    type: "number",
    operators: [">", "<", "=="],
    constraints: { min: 0, max: 120 },
    internal: { table: "users", column: "user_age" }, // [Bảo mật] Ẩn thông tin DB này khỏi FE
    validate: (val) => (typeof val === "number" ? true : "Tuổi phải là số"), // [Bảo mật] Hàm JS chạy ở server
    config: {
      label: "Tuổi",
      placeholder: "Nhập số tuổi (0-120)",
      component: "number-input", // Gợi ý FE render ô input số
      icon: "user-clock-icon",
    },
  },

  // Trường status: Lọc theo danh sách có sẵn, hiển thị Select Dropdown
  status: {
    type: "string",
    operators: ["==", "in"],
    constraints: {
      // Danh sách lựa chọn hiển thị trên FE kèm label đa ngôn ngữ hoặc thân thiện
      allowedValues: [
        { value: "active", label: "Đang hoạt động", labelKey: "status.active" },
        { value: "inactive", label: "Tạm dừng", labelKey: "status.inactive" },
        { value: "pending", label: "Chờ phê duyệt", labelKey: "status.pending" },
      ],
    },
    internal: { table: "users", column: "status_code" }, // [Bảo mật] Ẩn
    config: {
      label: "Trạng thái tài khoản",
      placeholder: "Chọn trạng thái...",
      component: "select", // Gợi ý FE render dropdown
      multiple: true, // Cho phép chọn nhiều (đối với toán tử "in")
    },
  },

  // Trường created_at: Lọc ngày tháng, hiển thị DatePicker
  created_at: {
    type: "date",
    operators: ["between", ">", "<"],
    internal: { table: "users", column: "created_date" }, // [Bảo mật] Ẩn
    config: {
      label: "Ngày tạo tài khoản",
      component: "datepicker", // Gợi ý FE render bộ chọn ngày tháng
      format: "YYYY-MM-DD",
    },
  },

  // Trường vip: Lọc dạng boolean, hiển thị Switch/Toggle hoặc Checkbox
  vip: {
    type: "boolean",
    operators: ["=="],
    internal: { table: "users", column: "is_vip" }, // [Bảo mật] Ẩn
    config: {
      label: "Thành viên VIP",
      component: "switch", // Gợi ý FE render nút gạt bật/tắt (Switch)
    },
  },
}

// 2. Chuyển đổi thành Public Schema gửi về cho Frontend
// Hàm toPublicSchema sẽ loại bỏ toàn bộ các thuộc tính nhạy cảm như "internal", "columnName", và hàm "validate"
const publicSchema = toPublicSchema(serverSchema)

console.log("=== PUBLIC SCHEMA GỬI VỀ FRONTEND ===")
console.log(JSON.stringify(publicSchema, null, 2))

/*
Đầu ra của publicSchema sẽ trông như thế này (An toàn tuyệt đối cho Client):
{
  "age": {
    "type": "number",
    "operators": [">", "<", "=="],
    "constraints": { "min": 0, "max": 120 },
    "config": {
      "label": "Tuổi",
      "placeholder": "Nhập số tuổi (0-120)",
      "component": "number-input",
      "icon": "user-clock-icon"
    }
  },
  "status": {
    "type": "string",
    "operators": ["==", "in"],
    "constraints": {
      "allowedValues": [
        { "value": "active", "label": "Đang hoạt động", "labelKey": "status.active" },
        { "value": "inactive", "label": "Tạm dừng", "labelKey": "status.inactive" },
        { "value": "pending", "label": "Chờ phê duyệt", "labelKey": "status.pending" }
      ]
    },
    "config": {
      "label": "Trạng thái tài khoản",
      "placeholder": "Chọn trạng thái...",
      "component": "select",
      "multiple": true
    }
  },
  "created_at": {
    "type": "date",
    "operators": ["between", ">", "<"],
    "config": {
      "label": "Ngày tạo tài khoản",
      "component": "datepicker",
      "format": "YYYY-MM-DD"
    }
  },
  "vip": {
    "type": "boolean",
    "operators": ["=="],
    "config": {
      "label": "Thành viên VIP",
      "component": "switch"
    }
  }
}
*/

// 3. Ví dụ mã xử lý ở Frontend (React / Vue / Angular Component Renderer)
// Đoạn code dưới đây mô phỏng cách FE đọc Public Schema để tự động sinh giao diện
interface FEFieldDef {
  type: string
  operators: string[]
  constraints?: {
    allowedValues?: Array<{ value: any; label: string; labelKey?: string } | any>
    min?: number | string
    max?: number | string
  }
  config?: {
    label?: string
    placeholder?: string
    component?: "select" | "number-input" | "datepicker" | "switch" | "text-input"
    multiple?: boolean
    [key: string]: any
  }
}

function renderUIForField(fieldKey: string, fieldDef: FEFieldDef) {
  const label = fieldDef.config?.label ?? fieldKey
  const componentType = fieldDef.config?.component ?? "text-input" // Mặc định là text input
  const placeholder = fieldDef.config?.placeholder ?? ""

  console.log(`\n[FE Render] Rendering field: "${fieldKey}"`)
  console.log(` -> Nhãn hiển thị (Label): ${label}`)

  switch (componentType) {
    case "select":
      console.log(` -> Render Component: <Select dropdown placeholder="${placeholder}" multiple=${!!fieldDef.config?.multiple}>`)
      // Hiển thị danh sách tuỳ chọn có sẵn trong constraints.allowedValues
      const options = fieldDef.constraints?.allowedValues ?? []
      options.forEach((opt: any) => {
        const val = typeof opt === "object" ? opt.value : opt
        const lbl = typeof opt === "object" ? opt.label : opt
        console.log(`    * [Option] Value: "${val}" | Label: "${lbl}"`)
      })
      console.log(` </Select>`)
      break

    case "number-input":
      const min = fieldDef.constraints?.min ?? "Không giới hạn"
      const max = fieldDef.constraints?.max ?? "Không giới hạn"
      console.log(` -> Render Component: <NumberInput min={${min}} max={${max}} placeholder="${placeholder}" />`)
      break

    case "datepicker":
      const dateFormat = fieldDef.config?.format ?? "YYYY-MM-DD"
      console.log(` -> Render Component: <DatePicker format="${dateFormat}" />`)
      break

    case "switch":
      console.log(` -> Render Component: <SwitchToggle label="${label}" />`)
      break

    default:
      console.log(` -> Render Component: <TextInput placeholder="${placeholder}" />`)
      break
  }
}

// Chạy thử hàm render ở FE với Public Schema
console.log("\n=== FRONTEND DUYỆT SCHEMA VÀ RENDER GIAO DIỆN ===")
for (const [fieldKey, fieldDef] of Object.entries(publicSchema)) {
  renderUIForField(fieldKey, fieldDef as FEFieldDef)
}
