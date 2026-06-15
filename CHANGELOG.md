# [1.2.0](https://github.com/Nam088/json-logic-to-sql-v2/compare/v1.1.0...v1.2.0) (2026-06-15)


### Bug Fixes

* remove duplicate OPERATOR_LABELS declaration to resolve HTML script syntax error ([68bf050](https://github.com/Nam088/json-logic-to-sql-v2/commit/68bf0507909035c606070d97e0874eb4f75ad90c))


### Features

* implement nested recursive query builder supporting AND/OR groups in UI ([f89eb8c](https://github.com/Nam088/json-logic-to-sql-v2/commit/f89eb8ca3163f4ccd603e20bb0a58a115488fbdc))

# [1.1.0](https://github.com/Nam088/json-logic-to-sql-v2/compare/v1.0.1...v1.1.0) (2026-06-15)


### Bug Fixes

* resolve typescript type errors in sqlite tests and css warning in index.html ([a02a8a3](https://github.com/Nam088/json-logic-to-sql-v2/commit/a02a8a3dde41a6c804e19990b3b08afe331bc92d))


### Features

* add express API demo and frontend query builder interface ([e5a2c9e](https://github.com/Nam088/json-logic-to-sql-v2/commit/e5a2c9e183a751d7c517552bcf763a4059a444c0))
* add support for strict comparison operators === and !== ([37c8649](https://github.com/Nam088/json-logic-to-sql-v2/commit/37c864991581fd12a0c8885094510190ef6bd5cd))
* add transformParam to Dialect and support native boolean-to-integer conversion for SQLite ([f0ce2cb](https://github.com/Nam088/json-logic-to-sql-v2/commit/f0ce2cb369a564d1a42974d1fca562e04a3a52e9))
* expand express schema with JSON metadata fields and update UI results table columns ([1b3bace](https://github.com/Nam088/json-logic-to-sql-v2/commit/1b3bace8c8a16b540f8ec0645ae96c2d05e9ef53))

## [1.0.1](https://github.com/Nam088/json-logic-to-sql-v2/compare/v1.0.0...v1.0.1) (2026-06-15)


### Bug Fixes

* add repository configuration to package.json for provenance validation ([de8b85a](https://github.com/Nam088/json-logic-to-sql-v2/commit/de8b85a59b5bf678b9e0a92f285387c67f8c736a))

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
