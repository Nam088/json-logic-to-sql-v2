import { describe, it, expect } from "vitest"
import { createConverter } from "../src/index.js"
import { postgresDialect } from "../src/dialects/postgres.js"
import { sqliteDialect } from "../src/dialects/sqlite.js"
import type { FieldSchema } from "../src/types.js"
import { normalizeDateForDB } from "../src/utils/date.js"

const schema: FieldSchema = {
  created_at: {
    type: "date",
    operators: ["==", ">", "<", "between", "in"],
  },
}

describe("DateTime Normalization TDD", () => {
  describe("MySQL Dialect Normalization", () => {
    const converter = createConverter(schema, { dialect: "mysql" })

    it("normalizes ISO string to MySQL DATETIME format (YYYY-MM-DD HH:mm:ss)", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "2026-01-01T00:00:00.000Z"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-01-01 00:00:00"])
    })

    it("normalizes Date object to MySQL DATETIME format (YYYY-MM-DD HH:mm:ss)", () => {
      const date = new Date("2026-06-15T12:34:56.789Z")
      const result = converter.toSQL({ "==": [{ var: "created_at" }, date as any] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-06-15 12:34:56"])
    })

    it("normalizes min/max in BETWEEN operator", () => {
      const result = converter.toSQL({
        between: [{ var: "created_at" }, "2026-01-01T00:00:00.000Z", "2026-01-02T23:59:59.999Z"],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-01-01 00:00:00", "2026-01-02 23:59:59"])
    })

    it("normalizes array of dates in IN operator", () => {
      const result = converter.toSQL({
        in: [{ var: "created_at" }, ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"]],
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-01-01 00:00:00", "2026-01-02 00:00:00"])
    })
  })

  describe("MSSQL Dialect Normalization", () => {
    const converter = createConverter(schema, { dialect: "mssql" })

    it("normalizes ISO string to MSSQL format by removing Z (YYYY-MM-DDTHH:mm:ss.sss)", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "2026-01-01T00:00:00.000Z"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-01-01T00:00:00.000"])
    })

    it("normalizes Date object to MSSQL format (YYYY-MM-DDTHH:mm:ss.sss)", () => {
      const date = new Date("2026-06-15T12:34:56.789Z")
      const result = converter.toSQL({ "==": [{ var: "created_at" }, date as any] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-06-15T12:34:56.789"])
    })
  })

  describe("PostgreSQL Dialect Normalization", () => {
    const converter = createConverter(schema, { dialect: "postgres" })

    it("keeps ISO string unchanged", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "2026-01-01T00:00:00.000Z"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-01-01T00:00:00.000Z"])
    })

    it("converts Date object to standard ISO string", () => {
      const date = new Date("2026-06-15T12:34:56.789Z")
      const result = converter.toSQL({ "==": [{ var: "created_at" }, date as any] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-06-15T12:34:56.789Z"])
    })
  })

  describe("SQLite Dialect Normalization", () => {
    const converter = createConverter(schema, { dialect: "sqlite" })

    it("keeps ISO string unchanged for text storage comparison", () => {
      const result = converter.toSQL({ "==": [{ var: "created_at" }, "2026-01-01T00:00:00.000Z"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-01-01T00:00:00.000Z"])
    })

    it("converts Date object to standard ISO string", () => {
      const date = new Date("2026-06-15T12:34:56.789Z")
      const result = converter.toSQL({ "==": [{ var: "created_at" }, date as any] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.params).toEqual(["2026-06-15T12:34:56.789Z"])
    })
  })

  describe("transformParam - only date fields should be normalized", () => {
    it("postgres: passes through Date object unchanged when fieldType is not 'date'", () => {
      const date = new Date("2026-01-01T00:00:00.000Z")
      const result = postgresDialect.transformParam!(date as any, "string")
      expect(result).toBe(date)
    })

    it("sqlite: passes through Date object unchanged when fieldType is not 'date'", () => {
      const date = new Date("2026-01-01T00:00:00.000Z")
      const result = sqliteDialect.transformParam!(date as any, "string")
      expect(result).toBe(date)
    })
  })

  describe("Bug 2 — invalid date handling", () => {
    it("returns null for invalid date strings", () => {
      expect(normalizeDateForDB("not-a-date", "mysql")).toBeNull()
      expect(normalizeDateForDB("not-a-date", "iso")).toBeNull()
    })
  })
})
