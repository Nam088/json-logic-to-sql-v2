import { describe, it, expect } from "vitest"
import { createConverter, toPublicSchema } from "../src/index.js"
import type { FieldSchema } from "../src/types.js"

describe("Hierarchical / Nested Schema Support", () => {
  const schema: FieldSchema = {
    user: {
      columnName: "user_data",
      properties: {
        profile: {
          properties: {
            age: {
              type: "number",
              operators: [">=", "=="],
              constraints: { min: 0, max: 150 },
              sortable: true,
            },
            name: {
              type: "string",
              operators: ["=="],
            }
          }
        },
        active: {
          type: "boolean",
          operators: ["=="],
        }
      }
    },
    direct_field: {
      type: "string",
      operators: ["=="],
    }
  }

  it("successfully flattens the hierarchical schema inside createConverter", () => {
    const converter = createConverter(schema, { dialect: "postgres" })
    const result = converter.toSQL({
      and: [
        { ">=": [{ var: "user.profile.age" }, 18] },
        { "==": [{ var: "user.active" }, true] },
        { "==": [{ var: "direct_field" }, "hello"] }
      ]
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.sql).toBe(
      `WHERE (CAST("user_data"->'profile'->>'age' AS numeric) >= $1 AND CAST("user_data"->>'active' AS boolean) = $2 AND "direct_field" = $3)`
    )
    expect(result.value.params).toEqual([18, true, "hello"])
  })

  it("cleanly strips internal details in nested schemas via toPublicSchema", () => {
    const customSchema: FieldSchema = {
      user: {
        columnName: "user_data",
        internal: { table: "users", column: "user_data" },
        properties: {
          profile: {
            properties: {
              secret: {
                type: "string",
                operators: ["=="],
                columnName: "secret_col",
                validate: (v) => v !== "admin",
              }
            }
          }
        }
      }
    }

    const publicSchema = toPublicSchema(customSchema)

    // Verify root user properties are cleaned
    expect(publicSchema.user).not.toHaveProperty("columnName")
    expect(publicSchema.user).not.toHaveProperty("internal")
    expect(publicSchema.user).toHaveProperty("properties")

    // Verify nested secret properties are cleaned
    const profile = (publicSchema.user as any).properties.profile
    const secret = profile.properties.secret
    expect(secret).not.toHaveProperty("columnName")
    expect(secret).not.toHaveProperty("validate")
    expect(secret.type).toBe("string")
    expect(secret.operators).toEqual(["=="])
  })

  it("compiles ORDER BY correctly for nested JSON fields", () => {
    const converter = createConverter(schema, { dialect: "postgres", sort: true })
    const result = converter.toSQL(
      { "==": [{ var: "direct_field" }, "hello"] },
      [{ field: "user.profile.age", direction: "desc" }]
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.sql).toBe(
      `WHERE "direct_field" = $1 ORDER BY CAST("user_data"->'profile'->>'age' AS numeric) DESC`
    )
  })
})
