# 1.0.0 (2026-06-15)


### Features

* implement core json-logic-to-sql compilation engine with multi-dialect support and registry system ([39b9811](https://github.com/Nam088/json-logic-to-sql-v2/commit/39b981148d7c40dc3e1e45e6c069e4cec45cf1a9))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- **Refactor:** Extracted shared `buildBaseColumn()`, `escapeLikePosix()`, and `escapeLikeMssql()` helpers from the four dialect files into a new `src/dialects/utils.ts` module, eliminating code duplication.
- **Security:** Strengthened `FORMAT_PATTERNS.ip` to validate each octet is in the 0–255 range (previously `999.999.999.999` would incorrectly pass).
- **Security:** Strengthened `FORMAT_PATTERNS.url` to require a proper hostname with at least one dot in the TLD (previously `http://a` would incorrectly pass).
- **Performance:** Custom `constraints.pattern` RegExp objects are now compiled once and cached in a module-level `Map`, preventing repeated recompilation on every `validate()` call.

### Added

- **JSDoc:** Added inline documentation to all public API exports: `createConverter`, `toPublicSchema`, `defineOperator`, `OperatorRegistry`, `OperatorDef`, `FieldDef`, `Query`, and `PaginationRule`.
- **Docs:** Added this `CHANGELOG.md`.

---

## [0.1.0] — 2026-06-12

### Added

- **Core Pipeline:** Validate → Normalize (AST) → Compile architecture.
- **Multi-Dialect Support:** PostgreSQL (positional `$N`, anonymous `?`, named `:param`), MySQL (anonymous `?`, named `:param`), SQLite (anonymous `?`, named `:param`), MSSQL (anonymous `?`, named `@param`).
- **Schema-Based Validation:** Strict zero-trust field whitelist with `FIELD_NOT_ALLOWED`, `OPERATOR_NOT_ALLOWED`, `OPERATOR_TYPE_MISMATCH`, `VALUE_TYPE_MISMATCH`, `VALUE_NOT_IN_ALLOWED_VALUES`, `VALUE_OUT_OF_RANGE`, `VALUE_FORMAT_INVALID`, `VALUE_LENGTH_INVALID` error codes.
- **Operators:** `==`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `in`, `not_in`, `contains`, `not_contains`, `startsWith`, `endsWith`, `like`, `ilike`, `is_null`, `is_not_null`, `has_any`, `has_all`, `contained_by`, `json_has_key`, `json_has_any_keys`.
- **Field Types:** `string`, `number`, `boolean`, `date`, `uuid`, `array`.
- **Schema Constraints:** `min`/`max` (number & date), `minLength`/`maxLength`, `allowedValues` (plain primitives and `{ value, label, labelKey }` objects), `format` (`email`, `uuid`, `url`, `ip`, `alphanumeric`), `pattern` (custom regex), `arrayOf`, `minItems`, `maxItems`.
- **Field-to-Field Comparison:** Compare two schema fields directly (e.g., `updated_at > created_at`), with type-compatibility validation.
- **Sorting:** `ORDER BY` generation with `sortable` field flag and per-field `internal.alias` support.
- **Pagination:** Parameterized `LIMIT`/`OFFSET` with separate `filterParams` to avoid parameter count mismatches on `COUNT(*)` queries.
- **JSON Path Querying:** Per-dialect JSON field traversal with automatic type `CAST`.
- **Table Mapping:** `internal.table`, `internal.column`, `internal.alias` for multi-table JOIN scenarios.
- **Custom Operators:** `OperatorRegistry` with `defineOperator()` helper; custom `compile` and `validate` functions per operator.
- **Public Schema Serialization:** `toPublicSchema()` strips `internal`, `columnName`, and `validate` from the schema before sending to untrusted clients.
- **DoS Protection:** `maxDepth` guard with `DEPTH_EXCEEDED` error code.
- **Result Type:** Railway-oriented `Result<T>` pattern — no exceptions for business errors.
- **ORM Integration Tests:** Verified with Sequelize, MikroORM, and TypeORM against a real PostgreSQL instance.
- **MSSQL Integration Tests:** Verified JSON path queries, `json_has_key`, and `json_has_any_keys` against a real MSSQL instance.
