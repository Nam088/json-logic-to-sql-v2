# json-logic-to-sql

A secure, type-safe, **zero-trust** compiler that translates JSON Logic rules into parameterized SQL queries. Designed to support multiple database dialects, sorting, pagination, field-to-field comparison, and strict schema-based input validation to eliminate SQL injection risks.

---

## Key Features

- **Zero-Trust Security**: Validates all JSON Logic objects against a strict, predefined schema before compilation. All values are automatically parameterized.
- **Multi-Dialect Support**:
  - **PostgreSQL**: Positional (`$1`, `$2`), anonymous (`?`), and named (`:param`) parameter bindings.
  - **MySQL**: Positional (`?`) and named (`:param`) parameter bindings with JSON array capabilities (`JSON_OVERLAPS`, `JSON_CONTAINS`).
  - **SQLite**: Clean standard SQL bindings with safeguards against unsupported array operations.
- **Rich Schema Constraints**:
  - Built-in types: `string`, `number`, `boolean`, `date`, `uuid`, and `array`.
  - Boundary checks: `min`/`max` ranges for numbers and ISO/Timestamp date structures.
  - Format checks: `email`, `uuid`, `url`, `ip`, `alphanumeric`, and custom Regex `pattern`.
  - Array validations: `arrayOf` type validation, `minItems`, and `maxItems`.
- **Custom Validations**: Support for custom JS/TS validation functions (`validate: (val) => boolean | string`).
- **Field-to-Field Comparison**: Compare table columns directly (e.g., `updated_at > created_at`, `age >= id`) with type compatibility verification.
- **Safe Pagination & Counting**: Separate `params` (full list query parameters) and `filterParams` (filter-only parameters) to prevent binding count mismatches on `COUNT(*)` queries.
- **Public Schema Serialization**: Proactively strip backend-specific column names and validation logic (`toPublicSchema`) before sending schemas to the frontend.
- **Custom Operators Registry**: Extend the library with custom operators.

---

## Installation

```bash
pnpm add @nam088/json-logic-sql
# or using npm
npm install @nam088/json-logic-sql
# or using yarn
yarn add @nam088/json-logic-sql
```

---

## Quick Start

```typescript
import { createConverter } from "@nam088/json-logic-sql"
import type { FieldSchema } from "@nam088/json-logic-sql"

// 1. Define your field schema
const schema: FieldSchema = {
  age: {
    type: "number",
    operators: [">=", "<=", "=="],
    constraints: { min: 18, max: 120 },
  },
  status: {
    type: "string",
    operators: ["==", "in"],
    constraints: { allowedValues: ["active", "pending"] },
  },
}

// 2. Initialize the converter with preferred dialect
const converter = createConverter(schema, { dialect: "postgres" })

// 3. Compile a JSON Logic rule
const jsonLogic = {
  and: [{ ">=": [{ var: "age" }, 18] }, { "==": [{ var: "status" }, "active"] }],
}

const result = converter.toSQL(jsonLogic)

if (result.ok) {
  const { sql, params } = result.value
  console.log("SQL Fragment:", sql)
  // Output: WHERE ("age" >= $1 AND "status" = $2)
  console.log("Parameters:", params)
  // Output: [18, "active"]
} else {
  console.error("Validation failed:", result.errors)
}
```

---

## Schema Configuration Reference

Define constraints and operators for each field:

```typescript
const schema: FieldSchema = {
  // UUID field with automatic UUID format check
  userId: {
    type: "uuid",
    operators: ["==", "!="],
  },
  // Number with bounds & custom column map
  salary: {
    type: "number",
    operators: [">", "<"],
    columnName: "monthly_salary", // Map logical field to custom DB column name
    sortable: true,
  },
  // Date validation with constraints
  createdAt: {
    type: "date",
    operators: ["between", ">", "<"],
    constraints: {
      min: "2026-01-01T00:00:00.000Z",
      max: "2026-12-31T23:59:59.999Z",
    },
  },
  // String validation with Regex patterns and custom validations
  username: {
    type: "string",
    operators: ["=="],
    constraints: {
      minLength: 3,
      maxLength: 15,
      pattern: "^[a-z0-9_]+$", // Regex validation
    },
  },
  // Custom validate logic
  evenNumber: {
    type: "number",
    operators: ["=="],
    validate: (val) => {
      if (typeof val !== "number" || val % 2 !== 0) {
        return "Value must be an even number"
      }
      return true
    },
  },
  // Array types
  tags: {
    type: "array",
    operators: ["has_any", "has_all"],
    constraints: {
      arrayOf: "string",
      minItems: 1,
      maxItems: 5,
    },
  },
}
```

### Hierarchical / Nested Schema Support

You can define hierarchical schema fields using the `properties` block. Nested properties automatically inherit the parent's database `columnName` (or use parent key) and accumulate JSON paths.

```typescript
const schema: FieldSchema = {
  user: {
    columnName: "user_data",
    properties: {
      profile: {
        properties: {
          age: {
            type: "number",
            operators: [">="],
          }
        }
      }
    }
  }
}

// Logical field name for querying: "user.profile.age"
// Maps to DB column: user_data
// Maps to JSON path: ["profile", "age"]
```

### Search Pattern Length Limit

For database query performance and DoS protection, all string search operators (`contains`, `not_contains`, `startsWith`, `endsWith`, `like`, `ilike`) enforce limits on search pattern lengths:
- If `constraints.maxLength` is defined in the schema, it is used as the length limit.
- Otherwise, it falls back to a safe default maximum of `512` characters.
Patterns exceeding this limit return a `VALUE_LENGTH_INVALID` validation error.

### Custom Operator Arity Verification

Custom operators can specify explicit constraints on the number of arguments they receive using `minArity` and `maxArity` parameters in `OperatorDef`:

```typescript
const converter = createConverter(schema, {
  operators: {
    match_custom: {
      allowedTypes: ["string"],
      arity: "binary",
      minArity: 2,
      maxArity: 3,
      compile: (ctx, node) => ...
    }
  }
})
```

---

## Dialects & Parameter Styles

The library provides built-in dialects, selected using the `dialect` option in `ConverterOptions`:

| Dialect name           | Quoting Style  | Parameter Style           | Notes / Features                                |
| :--------------------- | :------------- | :------------------------ | :---------------------------------------------- |
| `"postgres"` (default) | `"column"`     | Positional (`$1`, `$2`)   | Native arrays, JSON query support               |
| `"postgres-named"`     | `"column"`     | Named (`:age`, `:status`) | Returns `namedParams` key-value pairs           |
| `"postgres-anonymous"` | `"column"`     | Anonymous (`?`)           | For drivers requiring anonymous placeholders    |
| `"mysql"`              | `` `column` `` | Positional (`?`)          | Emulates `ILIKE`, implements JSON array helpers (Note: `has_any` requires MySQL 8.0.17+ due to `JSON_OVERLAPS`) |
| `"mysql-named"`        | `` `column` `` | Named (`:param`)          | Return `namedParams` key-value pairs            |
| `"sqlite"`             | `"column"`     | Positional (`?`)          | Safe standard SQL dialect                       |
| `"sqlite-named"`       | `"column"`     | Named (`:param`)          | Returns `namedParams` key-value pairs           |

You can also pass a custom object conforming to the `Dialect` interface.

---

## Advanced Usage

### 1. Field-to-Field Comparison

To compare a column with another column instead of a static value, pass a `{ var: "other_field" }` object on the right side of the logic comparison:

```typescript
// Compare if updated_at is greater than created_at
const query = { ">": [{ var: "updated_at" }, { var: "created_at" }] }

const result = converter.toSQL(query)
// Output SQL: WHERE "updated_at" > "created_at"
// Output Params: []
```

_Verification_: Both fields must exist in the schema and must be of compatible data types (e.g. comparing `number` with `string` will fail validation).

### 2. Sorting & Safe Pagination (List & Count Queries)

When performing pagination, you need to execute two separate queries:

1. The **List Query** to get the paginated records (with `LIMIT` & `OFFSET`).
2. The **Count Query** to get the total number of items matching the filter (ignoring limit & offset).

Using the same parameter array for both can trigger a driver parameter mismatch (e.g., PostgreSQL throwing `bind message supplies 11 parameters, but prepared statement requires 9`). This library resolves this by providing **separate** parameter arrays in the returned `Query` object:

```typescript
const sortRules = [{ field: "salary", direction: "desc" as const }]
const pagination = { limit: 10, offset: 0 }

// You can pass sort and pagination as individual positional arguments:
const result = converter.toSQL(jsonLogic, sortRules, pagination)

// OR pass them using a clean options object (perfect if you want pagination without sort):
const result = converter.toSQL(jsonLogic, {
  sort: sortRules,
  pagination: pagination,
})

// Or pagination-only without having to pass 'undefined' for sorting:
const result = converter.toSQL(jsonLogic, { pagination: { limit: 10 } })

// OR pass a single options object containing the rule/logic, sort, and pagination:
const result = converter.toSQL({
  rule: jsonLogic, // can also use key 'logic'
  sort: sortRules,
  pagination: pagination,
})

if (result.ok) {
  const { sql, filterSql, params, filterParams } = result.value

  // 1. Fetch Paginated Records (Passes 11 parameters)
  const listQuery = `SELECT * FROM users ${sql}`
  const users = await db.query(listQuery, params)
  // params contains: [...filterValues, 10 (limit), 0 (offset)]

  // 2. Fetch Total Count (Passes only 9 parameters)
  const countQuery = `SELECT COUNT(*)::int AS total FROM users ${filterSql}`
  const totalCount = await db.query(countQuery, filterParams)
  // filterParams contains ONLY the filter values, avoiding driver binding errors
}
```

### 3. Public Schemas (`toPublicSchema`)

If you want to validate rules in the browser before sending them to the backend, you can expose the schema to the frontend. However, it's unsafe to expose internal database mappings or server-side JS functions.

Use `toPublicSchema` to strip them:

```typescript
import { toPublicSchema } from "@nam088/json-logic-sql"

const publicSchema = toPublicSchema(schema)
// Strips 'columnName', 'internal', and 'validate' keys from all fields.
```

### 4. Runtime Field Mappings, OR-Expansion & SQL Expressions

You can pass a dynamic `fieldMappings` object inside the `toSQL()` options. This allows you to decouple your static JSON-serializable schema (which might be stored in a database) from your runtime physical database column mappings or raw SQL expressions (which contain server-side functions).

It supports three mapping formats:
1. **Simple columnName mapping (String)**: Quotes the identifier appropriately.
   ```typescript
   const result = converter.toSQL(logic, {
     fieldMappings: {
       verifyStatus: "status_col",
     }
   })
   // SQL: WHERE "status_col" = $1
   ```

2. **Raw SQL expression mapping (String containing spaces, parentheses, or colons)**: Bypasses identifier quoting and compiles raw SQL functions (e.g. `UPPER()`, `COALESCE()`).
   ```typescript
   const result = converter.toSQL(logic, {
     fieldMappings: {
       verifyStatus: "COALESCE(status, 'none')",
     }
   })
   // SQL: WHERE COALESCE(status, 'none') = $1
   ```

3. **OR-Expansion mapping (Object)**: Duplicates the condition across multiple columns and joins them with an `OR` gate.
   ```typescript
   const result = converter.toSQL(logic, {
     fieldMappings: {
       verifyStatus: {
         column: "status",
         orColumn: ["alt_status", "LOWER(third_status)"]
       }
     }
   })
   // SQL: WHERE ("status" = $1 OR "alt_status" = $2 OR LOWER(third_status) = $3)
   ```

### 5. Custom Operators

You can extend the default compiler by adding custom operators during initialization:

```typescript
const converter = createConverter(schema, {
  operators: {
    my_custom_op: {
      compile(node, ctx) {
        // Return custom compiled string
        return `SOME_DB_FUNC(${ctx.compileNode(node.left)})`
      },
    },
  },
})
```

---

## ORM Integration

`json-logic-to-sql` is designed to be highly compatible with modern ORMs. Simply match the dialect parameter style and feed the output into raw query executions:

### 1. Sequelize

Use a named dialect (e.g., `postgres-named`, `mysql-named`) and pass `namedParams` as replacements:

```typescript
const converter = createConverter(schema, { dialect: "postgres-named" })
const result = converter.toSQL(logic)

if (result.ok) {
  const rows = await sequelize.query(`SELECT * FROM users ${result.value.sql}`, {
    replacements: result.value.namedParams,
    type: "SELECT",
  })
}
```

### 2. Prisma Client (v7+)

Use a positional dialect (e.g., `postgres` for `$1, $2`, or `postgres-anonymous` for `?` depending on DB). Pass the `params` using the spread operator (`...params`) to `$queryRawUnsafe`:

```typescript
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"

// Prisma 7 requires driver adapters for direct connections
const pool = new pg.Pool({ connectionString: DB_CONNECTION_STRING })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const converter = createConverter(schema, { dialect: "postgres" })
const result = converter.toSQL(logic)

if (result.ok) {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM users ${result.value.sql}`, ...result.value.params)
}
```

### 3. TypeORM

Use a named dialect with prefix mapping, and query via `createQueryBuilder()` or `query()`:

```typescript
const converter = createConverter(schema, { dialect: "postgres-named", prefix: "" })
const result = converter.toSQL(logic)

if (result.ok) {
  const rows = await dataSource
    .createQueryBuilder()
    .select()
    .from("users", "user")
    .where(result.value.sql, result.value.namedParams)
    .getRawMany()
}
```

---

## Scripts & Development

Run typescript check:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Build:

```bash
pnpm build
```

---

## License

[MIT](LICENSE)
