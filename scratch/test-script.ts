
    const mockDocument = {};
    
    // Mock definitions
    let schema: any = {};
    const document: any = {
      getElementById: (id: string) => ({
        addEventListener: (event: string, callback: Function) => {},
        appendChild: (child: any) => {},
        querySelector: (selector: string) => ({ value: '', checked: false }),
        innerText: '',
        style: { display: '' }
      }),
      querySelector: (selector: string) => ({
        value: '',
        querySelector: (selector: string) => ({ value: '', checked: false }),
        remove: () => {}
      }),
      querySelectorAll: (selector: string) => [],
      createElement: (tag: string) => ({
        className: '',
        id: '',
        innerHTML: '',
        querySelector: (selector: string) => ({
          value: '',
          checked: false,
          addEventListener: (event: string, callback: Function) => {}
        }),
        appendChild: (child: any) => {},
        remove: () => {}
      })
    };
    const window: any = {
      addEventListener: (event: string, callback: Function) => {}
    };
    const fetch: any = (url: string, options?: any) => Promise.resolve({
      json: () => Promise.resolve({ success: true, schema: {}, data: { sql: '', params: [], rows: [] } })
    });
  
    
    

    // Khởi tạo: Lấy schema từ API
    async function loadSchema() {
      try {
        const res = await fetch("/api/schema");
        const json = await res.json();
        if (json.success) {
          schema = json.schema;
          
          // Khởi tạo root group và thêm một rule mặc định
          const builderRoot = mockDocument.getElementById("builder-root");
          const rootGroup = createGroup(true);
          builderRoot.appendChild(rootGroup);
          
          // Thêm 1 dòng điều kiện mặc định vào root group
          rootGroup.querySelector(".group-rules").appendChild(createRuleRow(rootGroup.id));
        }
      } catch (err) {
        console.error("Lỗi khi load schema:", err);
      }
    }

    function createGroup(isRoot = false) {
      const groupId = 'group-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      const group = document.createElement("div");
      group.className = "query-group";
      group.id = groupId;

      group.innerHTML = `
        <div class="group-header">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary); text-transform: uppercase;">Liên kết:</span>
            <select class="conj-select">
              <option value="and">VÀ (AND)</option>
              <option value="or">HOẶC (OR)</option>
            </select>
          </div>
          <div class="group-actions">
            <button class="btn btn-secondary btn-sm btn-add-rule">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Điều kiện
            </button>
            <button class="btn btn-secondary btn-sm btn-add-group">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
              Nhóm con
            </button>
            ${!isRoot ? `
              <button class="btn btn-danger btn-sm btn-delete-group">
                Xóa nhóm
              </button>
            ` : ''}
          </div>
        </div>
        <div class="group-rules"></div>
      `;

      const rulesContainer = group.querySelector(".group-rules");

      // Bind events
      group.querySelector(".btn-add-rule").addEventListener("click", () => {
        rulesContainer.appendChild(createRuleRow(groupId));
      });

      group.querySelector(".btn-add-group").addEventListener("click", () => {
        rulesContainer.appendChild(createGroup(false));
      });

      if (!isRoot) {
        group.querySelector(".btn-delete-group").addEventListener("click", () => {
          group.remove();
        });
      }

      return group;
    }

    function createRuleRow(groupId) {
      const rowId = 'row-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      const row = document.createElement("div");
      row.className = "rule-row";
      row.id = rowId;

      let fieldsHtml = "";
      for (const key in schema) {
        fieldsHtml += `<option value="${key}">${schema[key].config?.label || key}</option>`;
      }

      row.innerHTML = `
        <div class="form-group">
          <label>Cột dữ liệu</label>
          <select class="field-select" onchange="onFieldChange('${rowId}')">
            ${fieldsHtml}
          </select>
        </div>
        <div class="form-group small">
          <label>Toán tử</label>
          <select class="operator-select" onchange="onOperatorChange('${rowId}')">
            <!-- Nạp động -->
          </select>
        </div>
        <div class="form-group value-group" style="flex: 2;">
          <label>Giá trị</label>
          <div class="value-input-container">
            <!-- Nạp động -->
          </div>
        </div>
        <button class="btn btn-danger btn-icon-only btn-sm delete-rule-btn" style="align-self: flex-end; margin-bottom: 0.2rem;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;

      row.querySelector(".delete-rule-btn").addEventListener("click", () => {
        row.remove();
      });

      // trigger initial field setup via setTimeout to ensure DOM is attached
      setTimeout(() => {
        onFieldChange(rowId);
      }, 0);

      return row;
    }

    function onFieldChange(rowId) {
      const row = mockDocument.getElementById(rowId);
      if (!row) return;
      const fieldKey = row.querySelector(".field-select").value;
      const fieldDef = schema[fieldKey];
      const opSelect = row.querySelector(".operator-select");

      // Cập nhật danh sách toán tử
      let opsHtml = "";
      fieldDef.operators.forEach(op => {
        opsHtml += `<option value="${op}">${OPERATOR_LABELS[op] || op}</option>`;
      });
      opSelect.innerHTML = opsHtml;

      onOperatorChange(rowId);
    }

    const OPERATOR_LABELS = {
      "==": "Bằng (Loose)",
      "===": "Bằng (Strict)",
      "!=": "Khác (Loose)",
      "!==": "Khác (Strict)",
      ">": "Lớn hơn",
      "<": "Nhỏ hơn",
      ">=": "Lớn hơn hoặc bằng",
      "<=": "Nhỏ hơn hoặc bằng",
      "between": "Nằm trong khoảng",
      "in": "Một trong các giá trị",
      "not_in": "Không thuộc các giá trị",
      "contains": "Chứa chuỗi",
      "not_contains": "Không chứa chuỗi",
      "startsWith": "Bắt đầu với",
      "endsWith": "Kết thúc với",
      "like": "Khớp mẫu (LIKE)",
      "ilike": "Khớp không phân biệt hoa thường (ILIKE)",
      "is_null": "Rỗng (Null)",
      "is_not_null": "Khác rỗng (Not Null)"
    };

    function onOperatorChange(rowId) {
      const row = mockDocument.getElementById(rowId);
      if (!row) return;
      const fieldKey = row.querySelector(".field-select").value;
      const fieldDef = schema[fieldKey];
      const op = row.querySelector(".operator-select").value;
      const valContainer = row.querySelector(".value-input-container");

      const componentType = fieldDef.config?.component ?? "text-input";
      const placeholder = fieldDef.config?.placeholder ?? "";

      // 1. Đối với toán tử null/not_null -> Không cần giá trị
      if (op === "is_null" || op === "is_not_null") {
        valContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">Không yêu cầu nhập giá trị</span>`;
        return;
      }

      // 2. Đối với toán tử range (between) -> Render 2 ô nhập liệu
      if (op === "between") {
        if (componentType === "number-input") {
          valContainer.innerHTML = `
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <input type="number" class="val-input-min" placeholder="Từ" style="flex: 1;" />
              <span style="color: var(--text-muted)">-</span>
              <input type="number" class="val-input-max" placeholder="Đến" style="flex: 1;" />
            </div>
          `;
        } else {
          valContainer.innerHTML = `
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <input type="text" class="val-input-min" placeholder="Từ" style="flex: 1;" />
              <span style="color: var(--text-muted)">-</span>
              <input type="text" class="val-input-max" placeholder="Đến" style="flex: 1;" />
            </div>
          `;
        }
        return;
      }

      // 3. Đối với toán tử chứa danh sách (in / not_in)
      if (op === "in" || op === "not_in") {
        if (fieldDef.constraints?.allowedValues) {
          // Render danh sách checkbox chọn nhiều
          let checkboxHtml = `<div class="multi-select-wrap">`;
          fieldDef.constraints.allowedValues.forEach(opt => {
            const val = typeof opt === "object" ? opt.value : opt;
            const label = typeof opt === "object" ? opt.label : opt;
            checkboxHtml += `
              <label class="multi-select-option">
                <input type="checkbox" class="val-input-multi" value="${val}">
                ${label}
              </label>
            `;
          });
          checkboxHtml += `</div>`;
          valContainer.innerHTML = checkboxHtml;
        } else {
          valContainer.innerHTML = `<input type="text" class="val-input" placeholder="Các giá trị cách nhau bằng dấu phẩy (,)" style="width: 100%;" />`;
        }
        return;
      }

      // 4. Đối với toán tử cơ bản (==, !=, >, <) -> Render 1 ô nhập đơn lẻ
      if (componentType === "select" && fieldDef.constraints?.allowedValues) {
        let optionsHtml = "";
        fieldDef.constraints.allowedValues.forEach(opt => {
          const val = typeof opt === "object" ? opt.value : opt;
          const label = typeof opt === "object" ? opt.label : opt;
          optionsHtml += `<option value="${val}">${label}</option>`;
        });
        valContainer.innerHTML = `
          <select class="val-input" style="width: 100%;">
            ${optionsHtml}
          </select>
        `;
      } else if (componentType === "switch") {
        valContainer.innerHTML = `
          <div class="switch-container">
            <label class="switch">
              <input type="checkbox" class="val-input-boolean">
              <span class="slider"></span>
            </label>
            <span style="font-size: 0.85rem; color: var(--text-muted)">Bật / Tắt</span>
          </div>
        `;
      } else if (componentType === "number-input") {
        valContainer.innerHTML = `<input type="number" class="val-input" placeholder="${placeholder}" style="width: 100%;" />`;
      } else {
        valContainer.innerHTML = `<input type="text" class="val-input" placeholder="${placeholder}" style="width: 100%;" />`;
      }
    }

    // Chuyển đổi giao diện người dùng cấu hình thành định dạng JSON Logic
    function buildJsonLogic() {
      const rootGroup = document.querySelector("#builder-root > .query-group");
      if (!rootGroup) return null;
      return getGroupLogic(rootGroup);
    }

    function getGroupLogic(groupEl) {
      const conj = groupEl.querySelector(":scope > .group-header .conj-select").value;
      const rulesContainer = groupEl.querySelector(":scope > .group-rules");
      const children = rulesContainer.children;

      const conditions = [];

      for (const child of children) {
        if (child.classList.contains("rule-row")) {
          const ruleLogic = getRuleRowLogic(child);
          if (ruleLogic) {
            conditions.push(ruleLogic);
          }
        } else if (child.classList.contains("query-group")) {
          const subGroupLogic = getGroupLogic(child);
          if (subGroupLogic) {
            conditions.push(subGroupLogic);
          }
        }
      }

      if (conditions.length === 0) return null;
      if (conditions.length === 1) return conditions[0];

      return { [conj]: conditions };
    }

    function getRuleRowLogic(row) {
      const field = row.querySelector(".field-select").value;
      const op = row.querySelector(".operator-select").value;
      const fieldDef = schema[field];

      let value;

      if (op === "is_null" || op === "is_not_null") {
        return { [op]: [{ var: field }] };
      }

      if (op === "between") {
        const minValStr = row.querySelector(".val-input-min").value;
        const maxValStr = row.querySelector(".val-input-max").value;
        const minVal = fieldDef.type === "number" ? parseFloat(minValStr) : minValStr;
        const maxVal = fieldDef.type === "number" ? parseFloat(maxValStr) : maxValStr;
        return { between: [{ var: field }, minVal, maxVal] };
      }

      if (op === "in" || op === "not_in") {
        if (fieldDef.constraints?.allowedValues) {
          const checkboxes = row.querySelectorAll(".val-input-multi:checked");
          value = Array.from(checkboxes).map(cb => cb.value);
        } else {
          const commaStr = row.querySelector(".val-input").value;
          value = commaStr.split(",").map(s => s.trim()).filter(Boolean);
        }
        return { [op]: [{ var: field }, value] };
      }

      // Basic operators
      if (fieldDef.config?.component === "switch") {
        value = row.querySelector(".val-input-boolean").checked;
      } else {
        const valStr = row.querySelector(".val-input").value;
        value = fieldDef.type === "number" ? parseFloat(valStr) : valStr;
      }

      return { [op]: [{ var: field }, value] };
    }

    // Gửi yêu cầu chạy truy vấn lên Backend
    async function runQuery() {
      const alert = mockDocument.getElementById("error-alert");
      alert.style.display = "none";

      const logic = buildJsonLogic();
      if (!logic) {
        alert.innerText = "Vui lòng thêm ít nhất một điều kiện bộ lọc.";
        alert.style.display = "block";
        return;
      }

      try {
        const response = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filter: logic })
        });

        const json = await response.json();

        if (json.success) {
          // Hiển thị SQL sinh ra và các tham số
          mockDocument.getElementById("sql-output").innerText = json.data.sql;
          mockDocument.getElementById("params-output").innerText = JSON.stringify(json.data.params, null, 2);

          // Render bảng kết quả truy vấn
          const tbody = mockDocument.getElementById("results-body");
          mockDocument.getElementById("results-count").innerText = json.data.rows.length;
          
          if (json.data.rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="no-data">Không tìm thấy kết quả nào khớp với bộ lọc.</td></tr>`;
            return;
          }

          let rowsHtml = "";
          json.data.rows.forEach(user => {
            const statusBadge = user.status === "active" 
              ? `<span class="badge badge-active">Hoạt động</span>` 
              : user.status === "pending"
                ? `<span class="badge badge-pending">Đang chờ</span>`
                : `<span class="badge badge-inactive">Tạm khoá</span>`;

            const vipBadge = user.vip === 1 
              ? `<span class="badge badge-active">VIP</span>`
              : `<span class="badge badge-inactive">Thường</span>`;

            // Parse metadata JSON
            let city = "-";
            let rating = "-";
            if (user.metadata) {
              try {
                const meta = JSON.parse(user.metadata);
                city = meta.profile?.city ?? "-";
                rating = meta.profile?.rating !== undefined ? `${"⭐".repeat(meta.profile.rating)}` : "-";
              } catch (e) {}
            }

            rowsHtml += `
              <tr>
                <td>${user.id}</td>
                <td style="font-weight: 500;">${user.name}</td>
                <td>${user.age}</td>
                <td>${statusBadge}</td>
                <td>${vipBadge}</td>
                <td>${city}</td>
                <td style="color: #fbbf24; font-weight: 600;">${rating}</td>
              </tr>
            `;
          });
          tbody.innerHTML = rowsHtml;
        } else {
          // Hiển thị lỗi kiểm tra
          let errorText = "Lỗi validation:\n";
          json.errors.forEach(err => {
            errorText += `- [${err.code}] Cột "${err.field || ""}": ${err.message}\n`;
          });
          alert.innerText = errorText;
          alert.style.display = "block";
        }
      } catch (err) {
        alert.innerText = "Lỗi kết nối tới server: " + err.message;
        alert.style.display = "block";
      }
    }

    mockDocument.getElementById("run-query-btn").addEventListener("click", runQuery);

    // Bắt đầu tải schema khi trang web được tải
    window.addEventListener("load", loadSchema);
  
  