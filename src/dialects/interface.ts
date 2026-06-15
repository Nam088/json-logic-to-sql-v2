import type { AstNode, Primitive } from "../types.js"
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
  addParam: (value: Primitive, nameHint?: string) => string
  registry?: OperatorRegistry | undefined
}

export interface Dialect {
  name: string
  paramStyle: ParamStyle
  formatParam: (index: number, name?: string) => string
  quoteIdentifier: (name: string) => string
  compileNode: (node: AstNode, ctx: CompileContext) => string
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
