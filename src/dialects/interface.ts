import type { AstNode, Primitive, FieldType } from "../types.js"
import type { OperatorRegistry } from "../registry/index.js"

export type ParamStyle = "positional" | "anonymous" | "named"

export type SqlFragment = {
  sql: string
  params: Primitive[]
}

export type CompileContext = {
  node: AstNode
  paramIndex: { current: number }
  params: Primitive[]
  dialect: Dialect
  compileNode: (node: AstNode) => string
  addParam: (value: Primitive, nameHint?: string, fieldType?: FieldType) => string
  registry?: OperatorRegistry | undefined
}

export interface Dialect {
  name: string
  paramStyle: ParamStyle
  /**
   * Declares whether the dialect supports array-operator AST nodes (like has_any, has_all, contained_by).
   * If false, validator blocks these operators for this dialect. Defaults to true (undefined = true).
   */
  supportsArrayOps?: boolean
  /**
   * Explicitly declares which JSON path syntax this dialect uses.
   * When set, `compileField` uses this value instead of inferring from `dialect.name`.
   * Custom dialects should set this to avoid relying on name-prefix conventions.
   */
  jsonPathDialect?: "postgres" | "mysql" | "sqlite" | "mssql"
  formatParam: (index: number, name?: string) => string
  quoteIdentifier: (name: string) => string
  compileNode: (node: AstNode, ctx: CompileContext) => string
  transformParam?: (value: Primitive, fieldType?: FieldType) => Primitive
  compilePagination?: (
    limit: number | undefined,
    offset: number | undefined,
    addParam: (value: Primitive, nameHint?: string) => string,
    hasOrderBy: boolean
  ) => {
    sql: string
    limitSql?: string | undefined
    offsetSql?: string | undefined
  }
}

