# json-logic-to-sql — Design Spec

**Date:** 2026-06-12  
**Status:** Approved

---

## 1. Purpose

A zero-dependency TypeScript library that converts JSON Logic expressions into
parameterized SQL WHERE clauses. Designed for backend filter engines where the
frontend sends JSON Logic from user-defined filters and the backend must enforce
a strict whitelist before touching the database.

**Security model:** Zero trust. Every JSON Logic input is treated as untrusted.
The backend defines a `FieldSchema` that whitelists exactly which fields,
operators, and values are allowed. Anything outside that schema is rejected
with a structured error list before SQL generation begins.

---

## 2. Architecture — 3-Stage Pipeline

```
JSON Logic (untrusted input)
    ↓
[Stage 1: Validator]   — schema whitelist, operator check, type check, depth guard
    ↓ ValidationResult (ok | errors[])
[Stage 2: Normalizer]  — JSON Logic → typed AST
    ↓ AST
[Stage 3: Compiler]    — AST → parameterized SQL via Dialect plugin
    ↓
Result<Query, ValidationError[]>
```

Stages are independent and separately testable. Failure in Stage 1 short-circuits;
Stages 2 and 3 never run on invalid input.

---

## 3. FieldSchema

The schema is the security contract. Define it once at startup and pass it to
`createConverter`. Every field, operator, and value that is not explicitly
listed is denied.

```ts
type FieldType = "string" | "number" | "boolean" | "date" | "uuid" | "array"

type FieldConstraints = {
  allowedValues?: Primitive[] // enum — only these values accepted
  min?: number | string // number lower bound OR ISO 8601 date (e.g. "2020-01-01")
  max?: number | string // number upper bound OR ISO 8601 date
  minLength?: number
  maxLength?: number
  format?: "email" | "uuid" | "url" | "ip" | "alphanumeric"
  arrayOf?: Exclude<FieldType, "array">
  minItems?: number
  maxItems?: number
}

type FieldDef = {
  type: FieldType
  operators: string[]
  columnName?: string
  description?: string
  nullable?: boolean
  constraints?: FieldConstraints
}

type FieldSchema = Record<string, FieldDef>
```

**Example schema:**

```ts
const schema: FieldSchema = {
  id: { type: "uuid", operators: ["==", "in"] },
  age: { type: "number", operators: [">", ">=", "<", "<=", "==", "between"], constraints: { min: 0, max: 150 } },
  name: { type: "string", operators: ["==", "contains", "startsWith", "ilike"], constraints: { maxLength: 255 } },
  email: { type: "string", operators: ["==", "contains"], columnName: "user_email", constraints: { format: "email" } },
  status: { type: "string", operators: ["==", "in"], constraints: { allowedValues: ["active", "inactive", "banned"] } },
  tags: { type: "array", operators: ["has_any", "has_all"], constraints: { arrayOf: "string", maxItems: 20 } },
  created_at: { type: "date", operators: ["<", ">", "between"] },
  deleted_at: { type: "date", operators: ["is_null", "is_not_null", "<", ">"], nullable: true },
}
```

---

## 4. Operator Registry

All operators — built-in and custom — are registered in a central registry.
The registry is the single source of truth used by both the Validator (allowed
types, arity) and the Compiler (SQL generation via dialect).

```ts
type OperatorDef = {
  allowedTypes: (FieldType | "any")[]
  arity: "unary" | "binary" | "variadic"
  compile: (ctx: CompileContext) => SqlFragment
}
```

**Built-in operators:**

| Operator       | Arity    | Allowed types             |
| -------------- | -------- | ------------------------- |
| `==`           | binary   | any                       |
| `!=`           | binary   | any                       |
| `>`            | binary   | number, date              |
| `>=`           | binary   | number, date              |
| `<`            | binary   | number, date              |
| `<=`           | binary   | number, date              |
| `between`      | binary   | number, date              |
| `in`           | variadic | any                       |
| `not_in`       | variadic | any                       |
| `contains`     | binary   | string                    |
| `not_contains` | binary   | string                    |
| `startsWith`   | binary   | string                    |
| `endsWith`     | binary   | string                    |
| `like`         | binary   | string                    |
| `ilike`        | binary   | string (case-insensitive) |
| `is_null`      | unary    | any (nullable only)       |
| `is_not_null`  | unary    | any (nullable only)       |
| `has_any`      | variadic | array                     |
| `has_all`      | variadic | array                     |
| `and`          | variadic | —                         |
| `or`           | variadic | —                         |
| `!`            | unary    | —                         |

Custom operators can be added via `registry.register(name, def)`.

---

## 5. Dialect System

Each database is implemented as a `Dialect` plugin. The Compiler delegates all
SQL generation to the active dialect.

```ts
interface Dialect {
  name: string
  paramStyle: "positional" | "anonymous" | "named"
  formatParam: (index: number, name: string) => string
  quoteIdentifier: (name: string) => string
  compileOperator: (op: string, ctx: CompileContext) => SqlFragment
}
```

**Param styles:**

| Style        | Example       | Used by                       |
| ------------ | ------------- | ----------------------------- |
| `positional` | `$1, $2, $3`  | PostgreSQL                    |
| `anonymous`  | `?, ?, ?`     | MySQL, SQLite, better-sqlite3 |
| `named`      | `:name, :age` | Oracle, some ORMs             |

**v1 ships PostgreSQL only.** MySQL, SQLite, and named-param dialects are
stubbed as `Dialect` implementations added in future versions with no API
changes needed.

---

## 6. Public API

```ts
import { createConverter } from "@nam088/json-logic-sql"

const converter = createConverter(schema, {
  dialect: "postgres", // default: "postgres"
  maxDepth: 10, // default: 10, DoS guard
  allowLogicalNesting: true, // default: true
})

const result = converter.toSQL({
  and: [{ ">": [{ var: "age" }, 25] }, { "==": [{ var: "status" }, "active"] }],
})

if (result.ok) {
  const { sql, params } = result.value
  // sql    → `WHERE "age" > $1 AND "status" = $2`
  // params → [25, "active"]
  await db.query(`SELECT * FROM users ${sql}`, params)
} else {
  // result.errors → ValidationError[]
  // [{ field: "password", message: "Field 'password' is not in schema" }]
}
```

**Additional exports:**

```ts
// Create a custom dialect
import { createConverter, defineDialect, defineOperator } from "@nam088/json-logic-sql"

// Register a custom operator
const converter = createConverter(schema, {
  operators: {
    fulltext: defineOperator({
      allowedTypes: ["string"],
      arity: "binary",
      compile: (ctx) => ctx.dialect.fullTextSearch(ctx.field, ctx.value),
    }),
  },
})
```

---

## 7. Error Handling

Validation collects **all errors** before returning — no fail-fast. This lets
the frontend display the full list of invalid fields in one round-trip.

```ts
type ValidationError = {
  path: string // JSON Logic path e.g. "and[0].>"
  field?: string // field name if relevant
  operator?: string // operator name if relevant
  message: string // human-readable
  code: ValidationErrorCode
}

type ValidationErrorCode =
  | "FIELD_NOT_ALLOWED"
  | "OPERATOR_NOT_ALLOWED"
  | "OPERATOR_TYPE_MISMATCH"
  | "VALUE_TYPE_MISMATCH"
  | "VALUE_NOT_IN_ALLOWED_VALUES"
  | "VALUE_OUT_OF_RANGE"
  | "VALUE_FORMAT_INVALID"
  | "DEPTH_EXCEEDED"
  | "UNKNOWN_OPERATOR"
```

---

## 8. Build & Package

**Toolchain:**

- `vite` (library mode) — ESM + CJS + UMD output
- `vite-plugin-dts` — single bundled `.d.ts`
- `vitest` — unit and integration tests
- `typescript` — strict mode

**Output files:**

```
dist/
  index.mjs       # ESM
  index.cjs       # CommonJS
  index.umd.js    # UMD (browser CDN)
  index.d.ts      # bundled type declarations
```

**package.json exports:**

```json
{
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  }
}
```

**Zero runtime dependencies.** Only `devDependencies`.

---

## 9. Test Strategy

Each stage is unit-tested independently. Integration tests cover the full pipeline.

| File                        | What it covers                                     |
| --------------------------- | -------------------------------------------------- |
| `validator.test.ts`         | all schema rules, zero-trust enforcement           |
| `normalizer.test.ts`        | JSON Logic → AST edge cases                        |
| `compiler.test.ts`          | AST → SQL correctness per operator                 |
| `registry.test.ts`          | operator registration, custom operator override    |
| `dialects/postgres.test.ts` | param format, identifier quoting, operator SQL     |
| `integration.test.ts`       | full pipeline, real JSON Logic → parameterized SQL |
| `security.test.ts`          | injection attempts, depth bombs, unknown fields    |

---

## 10. Out of Scope (v1)

- JOIN / subquery support
- SELECT clause building (WHERE only)
- ORM adapter (Knex, Drizzle, Prisma) — planned v2
- MySQL / SQLite dialects — interface ready, not implemented
- JSON field operators (PostgreSQL `->`, `->>`)
