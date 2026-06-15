import { describe, it, expect } from "vitest"
import { normalize } from "../src/normalizer/index.js"
import { compile } from "../src/compiler/index.js"
import { postgresDialect } from "../src/dialects/postgres.js"
import { mysqlDialect } from "../src/dialects/mysql.js"
import type { FieldSchema } from "../src/types.js"

const schema: FieldSchema = {
  age: { type: "number", operators: ["==", ">"] },
  name: { type: "string", operators: ["=="] },
}

describe("Core Functions — normalize() & compile() direct coverage", () => {
  describe("normalize()", () => {
    it("correctly normalizes a simple comparison rule into AST comparison node", () => {
      const rule = { "==": [{ var: "age" }, 25] }
      const ast = normalize(rule, schema)
      expect(ast).toEqual({
        type: "comparison",
        operator: "==",
        field: "age",
        columnName: "age",
        value: 25,
        fieldType: "number",
      })
    })

    it("correctly normalizes nested logical rule", () => {
      const rule = {
        and: [
          { ">": [{ var: "age" }, 18] },
          { "==": [{ var: "name" }, "Alice"] },
        ],
      }
      const ast = normalize(rule, schema)
      expect(ast.type).toBe("and")
      if (ast.type !== "and") return
      expect(ast.children).toHaveLength(2)
      expect(ast.children[0]).toMatchObject({
        type: "comparison",
        operator: ">",
        field: "age",
      })
    })
  })

  describe("compile()", () => {
    it("compiles AST node using postgresDialect", () => {
      const ast = {
        type: "comparison" as const,
        operator: "==" as const,
        field: "age",
        columnName: "age",
        value: 25,
        fieldType: "number" as const,
      }
      const query = compile(ast, postgresDialect, undefined, schema)
      expect(query.sql).toBe("WHERE \"age\" = $1")
      expect(query.params).toEqual([25])
    })

    it("compiles AST node using mysqlDialect", () => {
      const ast = {
        type: "comparison" as const,
        operator: ">" as const,
        field: "age",
        columnName: "age",
        value: 30,
        fieldType: "number" as const,
      }
      const query = compile(ast, mysqlDialect, undefined, schema)
      expect(query.sql).toBe("WHERE `age` > ?")
      expect(query.params).toEqual([30])
    })
  })
})
