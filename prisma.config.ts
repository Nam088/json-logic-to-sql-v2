import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "orm-tests/schema.prisma",
  datasource: {
    url: "postgresql://postgres:postgres@localhost:5432/postgres",
  },
})
