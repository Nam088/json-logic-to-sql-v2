import type { AstNode, Query, Primitive, SortRule, FieldSchema, PaginationRule, FieldType, OrderField } from "../types.js"
import type { Dialect, CompileContext } from "../dialects/interface.js"
import type { OperatorRegistry } from "../registry/index.js"

export function compile(
  ast: AstNode,
  dialect: Dialect,
  sort?: SortRule[],
  schema?: FieldSchema,
  prefix = "WHERE ",
  pagination?: PaginationRule,
  registry?: OperatorRegistry
): Query {
  const params: Primitive[] = []
  const namedParams: Record<string, Primitive> = {}
  const paramIndex = { current: 1 }

  const addParam = (value: Primitive, nameHint?: string, fieldType?: FieldType): string => {
    const transformed = dialect.transformParam ? dialect.transformParam(value, fieldType) : value
    params.push(transformed)
    const placeholder = dialect.formatParam(paramIndex.current, nameHint)
    if (dialect.paramStyle === "named") {
      const key = placeholder.startsWith(":") || placeholder.startsWith("@") ? placeholder.substring(1) : placeholder
      namedParams[key] = transformed
    }
    paramIndex.current++
    return placeholder
  }


  const ctx: CompileContext = {
    node: ast,
    paramIndex,
    params,
    dialect,
    addParam,
    compileNode: (node: AstNode) => dialect.compileNode(node, ctx),
    registry,
  }

  const filterSql = `${prefix}${dialect.compileNode(ast, ctx)}`

  let sortSql = ""
  const orderFields: OrderField[] = []

  if (sort && sort.length > 0 && schema) {
    const orderCols = sort.map(({ field, direction }) => {
      const def = schema[field]
      const colName = def?.internal?.column ?? def?.columnName ?? field
      const tablePrefix = def?.internal?.alias ?? def?.internal?.table
      const dir = direction.toUpperCase() as "ASC" | "DESC"
      orderFields.push({ column: colName, direction: dir })
      const quotedCol = tablePrefix
        ? `${dialect.quoteIdentifier(tablePrefix)}.${dialect.quoteIdentifier(colName)}`
        : dialect.quoteIdentifier(colName)
      return `${quotedCol} ${dir}`
    })
    sortSql = `ORDER BY ${orderCols.join(", ")}`
  }

  // Capture parameters used for filters before adding pagination limit/offset
  const filterParams = [...params]
  const filterNamedParams = dialect.paramStyle === "named" ? { ...namedParams } : undefined

  let limitSql = ""
  let offsetSql = ""
  let paginationSql = ""

  if (pagination) {
    if (dialect.compilePagination) {
      const pagResult = dialect.compilePagination(pagination.limit, pagination.offset, addParam, !!sortSql)
      paginationSql = pagResult.sql
      limitSql = pagResult.limitSql || ""
      offsetSql = pagResult.offsetSql || ""
    } else {
      let pLimit: string | undefined = undefined
      let pOffset: string | undefined = undefined

      if (typeof pagination.limit === "number") {
        pLimit = addParam(pagination.limit, "limit")
      }
      if (typeof pagination.offset === "number") {
        pOffset = addParam(pagination.offset, "offset")
      }

      const parts: string[] = []
      if (pLimit) {
        limitSql = `LIMIT ${pLimit}`
        parts.push(limitSql)
      }
      if (pOffset) {
        offsetSql = `OFFSET ${pOffset}`
        parts.push(offsetSql)
      }
      paginationSql = parts.join(" ")
    }
  }

  const sql = [filterSql, sortSql, paginationSql].filter(Boolean).join(" ")

  const result: Query = {
    sql,
    filterSql,
    sortSql: sortSql || undefined,
    orderFields: orderFields.length > 0 ? orderFields : undefined,
    limitSql: limitSql || undefined,
    offsetSql: offsetSql || undefined,
    params,
    filterParams,
    filterNamedParams,
  }

  if (dialect.paramStyle === "named") {
    result.namedParams = namedParams
  }

  return result
}
