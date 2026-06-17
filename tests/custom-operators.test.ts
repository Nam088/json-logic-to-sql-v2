import { describe, it, expect } from "vitest"
import { createConverter, defineOperator } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Custom Operators Support", () => {
  const schema: FieldSchema = {
    email: {
      type: "string",
      operators: ["==", "fulltext", "regex"],
    },
    age: {
      type: "number",
      operators: ["==", "mod_check"],
    },
  }

  describe("Validation", () => {
    it("fails when using unregistered operator", () => {
      const converter = createConverter(schema)
      const result = converter.toSQL({ fulltext: [{ var: "email" }, "gmail.com"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0].code).toBe("UNKNOWN_OPERATOR")
    })

    it("passes when custom operator is registered and validly used", () => {
      const converter = createConverter(schema, {
        operators: {
          fulltext: defineOperator({
            allowedTypes: ["string"],
            arity: "binary",
          }),
        },
      })
      // Should pass validation, though it will throw on compile if we don't define compile.
      // So we define compile to test validation in isolation.
      const result = converter.toSQL({ fulltext: [{ var: "email" }, "gmail"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0].message).toContain("does not have a compile function")
    })

    it("fails when custom operator does not support field type", () => {
      const converter = createConverter(schema, {
        operators: {
          fulltext: defineOperator({
            allowedTypes: ["string"],
            arity: "binary",
          }),
        },
      })
      const result = converter.toSQL({ fulltext: [{ var: "age" }, "test"] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0].code).toBe("OPERATOR_NOT_ALLOWED")
    })

    it("runs custom validate function and fails if return is false", () => {
      const converter = createConverter(schema, {
        operators: {
          mod_check: defineOperator({
            allowedTypes: ["number"],
            arity: "binary",
            validate: (args) => {
              const val = args[0]
              if (typeof val !== "number" || val <= 0) {
                return false
              }
              return true
            },
          }),
        },
      })

      const result = converter.toSQL({ mod_check: [{ var: "age" }, -5] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0].code).toBe("VALUE_FORMAT_INVALID")
      expect(result.errors[0].message).toBe('Arguments for custom operator "mod_check" failed validation')
    })

    it("runs custom validate function and fails with custom error message", () => {
      const converter = createConverter(schema, {
        operators: {
          mod_check: defineOperator({
            allowedTypes: ["number"],
            arity: "binary",
            validate: (args) => {
              const val = args[0]
              if (typeof val !== "number" || val <= 0) {
                return "Modulo divisor must be a positive number"
              }
              return true
            },
          }),
        },
      })

      const result = converter.toSQL({ mod_check: [{ var: "age" }, -5] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors[0].code).toBe("VALUE_FORMAT_INVALID")
      expect(result.errors[0].message).toBe("Modulo divisor must be a positive number")
    })

    it("allows custom operators with prototype method names (e.g. toString)", () => {
      expect(() => {
        createConverter(schema, {
          operators: {
            toString: defineOperator({
              allowedTypes: ["string"],
              arity: "unary",
            }),
          },
        })
      }).not.toThrow()
    })
  })

  describe("Compilation", () => {
    it("compiles with custom compile function using positional parameters (postgres)", () => {
      const converter = createConverter(schema, {
        dialect: "postgres",
        operators: {
          fulltext: defineOperator({
            allowedTypes: ["string"],
            arity: "binary",
            compile: (ctx, node) => {
              const col = ctx.dialect.quoteIdentifier(node.columnName)
              const p = ctx.addParam(node.values[0] as import("../src/types.js").Primitive, node.field)
              return `to_tsvector('english', ${col}) @@ plainto_tsquery('english', ${p})`
            },
          }),
        },
      })

      const result = converter.toSQL({ fulltext: [{ var: "email" }, "admin"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE to_tsvector('english', "email") @@ plainto_tsquery('english', $1)`)
      expect(result.value.params).toEqual(["admin"])
    })

    it("compiles with custom compile function using named parameters", () => {
      const converter = createConverter(schema, {
        dialect: "postgres-named",
        operators: {
          fulltext: defineOperator({
            allowedTypes: ["string"],
            arity: "binary",
            compile: (ctx, node) => {
              const col = ctx.dialect.quoteIdentifier(node.columnName)
              const p = ctx.addParam(node.values[0] as import("../src/types.js").Primitive, node.field)
              return `to_tsvector('english', ${col}) @@ plainto_tsquery('english', ${p})`
            },
          }),
        },
      })

      const result = converter.toSQL({ fulltext: [{ var: "email" }, "admin"] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.sql).toBe(`WHERE to_tsvector('english', "email") @@ plainto_tsquery('english', :email_1)`)
      expect(result.value.namedParams).toEqual({ email_1: "admin" })
    })

    it("compiles differently depending on the active dialect", () => {
      const compileFunc = (ctx: any, node: any) => {
        const col = ctx.dialect.quoteIdentifier(node.columnName)
        const p = ctx.addParam(node.values[0], node.field)
        if (ctx.dialect.name === "postgres") {
          return `${col} ~* ${p}`
        } else if (ctx.dialect.name === "mysql") {
          return `${col} REGEXP ${p}`
        } else {
          return `${col} REGEXP_LIKE ${p}`
        }
      }

      const opDef = defineOperator({
        allowedTypes: ["string"],
        arity: "binary",
        compile: compileFunc,
      })

      const pgConverter = createConverter(schema, { dialect: "postgres", operators: { regex: opDef } })
      const mysqlConverter = createConverter(schema, { dialect: "mysql", operators: { regex: opDef } })
      const sqliteConverter = createConverter(schema, { dialect: "sqlite", operators: { regex: opDef } })

      const pgRes = pgConverter.toSQL({ regex: [{ var: "email" }, "@gmail\\.com$"] })
      expect(pgRes.ok).toBe(true)
      if (pgRes.ok) {
        expect(pgRes.value.sql).toBe(`WHERE "email" ~* $1`)
        expect(pgRes.value.params).toEqual(["@gmail\\.com$"])
      }

      const mysqlRes = mysqlConverter.toSQL({ regex: [{ var: "email" }, "@gmail\\.com$"] })
      expect(mysqlRes.ok).toBe(true)
      if (mysqlRes.ok) {
        expect(mysqlRes.value.sql).toBe("WHERE `email` REGEXP ?")
        expect(mysqlRes.value.params).toEqual(["@gmail\\.com$"])
      }

      const sqliteRes = sqliteConverter.toSQL({ regex: [{ var: "email" }, "@gmail\\.com$"] })
      expect(sqliteRes.ok).toBe(true)
      if (sqliteRes.ok) {
        expect(sqliteRes.value.sql).toBe(`WHERE "email" REGEXP_LIKE ?`)
        expect(sqliteRes.value.params).toEqual(["@gmail\\.com$"])
      }
    })
  })
})
