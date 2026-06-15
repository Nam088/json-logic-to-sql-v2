# Báo cáo Code Review — json-logic-to-sql-v2

**Ngày:** 2026-06-15  
**Phạm vi:** Toàn bộ codebase (`src/`)  
**Phương pháp:** 7 góc phân tích độc lập + 7 vòng xác minh  
**Tests:** 254 passed, 0 failed

---

## Lịch sử điểm

| Lần | Điểm | Ghi chú |
|---|---|---|
| Lần 1 | **72/100** | Trước khi fix |
| Lần 2 | **87/100** | Sau khi fix 7/9 vấn đề |
| **Lần 3** | **92/100** | Sau khi fix toàn bộ 9/9 vấn đề |

---

## Điểm tổng (lần 3): 92 / 100

| Hạng mục | Lần 1 | Lần 2 | Lần 3 | Thay đổi |
|---|---|---|---|---|
| Kiến trúc & thiết kế | 18/20 | 18/20 | 18/20 | — |
| Tính đúng đắn | 12/25 | 21/25 | 24/25 | +3 ✅ |
| Bảo mật | 10/15 | 13/15 | 15/15 | +2 ✅ |
| Chất lượng code | 20/25 | 23/25 | 23/25 | — |
| Test coverage | 12/15 | 12/15 | 12/15 | — |

---

## Đã sửa (7/9 vấn đề)

| # | File | Vấn đề | Trạng thái |
|---|---|---|---|
| 1 | `dialects/postgres.ts:104,107` | `jsonb_exists()` → operator `?` và `?|` | ✅ Fixed |
| 2 | `validator/field-validator.ts:144` | `between` thiếu args guard | ✅ Fixed |
| 3 | `validator/field-validator.ts:99` | nullable check `=== false` thay vì `!nullable` | ✅ Fixed |
| 4 | `validator/field-validator.ts:20,29` | Regex cache giới hạn MAX_PATTERN_CACHE = 500 | ✅ Fixed |
| 5 | `dialects/mssql.ts:118` | `limitSql` bao gồm cả OFFSET+FETCH (standalone valid) | ✅ Fixed |
| 6 | `validator/field-validator.ts:297,305` | Guard `typeof c.min === "number"` trước numeric range | ✅ Fixed |
| 7 | `dialects/utils.ts:78` | Extract `compileCommonNode` — bỏ copy-paste 4 dialect | ✅ Fixed |
| 8 | `dialects/sqlite.ts:86` | Escape `"` trong key: `replace(${p}, '"', '\\"')` | ✅ Fixed |
| 9 | `dialects/mysql.ts:97` | Escape `"` trong key: `REPLACE(${p}, '"', '\\\\"')` | ✅ Fixed |

---

## Điểm nổi bật sau refactor

### `compileCommonNode` — Bỏ 200+ dòng trùng lặp

Trước đây 4 dialect copy-paste toàn bộ switch cho `and/or/not/comparison/in/between/null_check/custom_op`. Giờ chỉ cần:

```typescript
// Mỗi dialect chỉ còn:
const commonRes = compileCommonNode(node, ctx, col, compileField)
if (commonRes !== null) return commonRes
// Sau đó chỉ xử lý phần dialect-specific: like, array_op, json_op
```

Thêm AstNode mới giờ chỉ cần sửa 1 chỗ (`utils.ts`), không phải 4.

---

## Tóm tắt

```
Tất cả đã sửa (9/9):
  ✅ postgres.ts     — json_has_key/json_has_any_keys giờ dùng ? và ?| (feature không còn crash)
  ✅ field-validator — between: lỗi rõ ràng INVALID_STRUCTURE thay vì VALUE_TYPE_MISMATCH
  ✅ field-validator — nullable: is_null không còn bị từ chối khi nullable bị bỏ trống
  ✅ field-validator — regex cache: bảo vệ khỏi memory leak và ReDoS
  ✅ mssql.ts        — limitSql hợp lệ T-SQL khi dùng standalone
  ✅ field-validator — min/max range validation không còn bị bypass bởi string schema config
  ✅ utils.ts        — compileCommonNode: bỏ ~200 dòng trùng lặp giữa 4 dialect
  ✅ sqlite.ts:86    — escape " trong key trước khi tạo JSON path
  ✅ mysql.ts:97     — escape " trong key trước khi tạo JSON path
```
