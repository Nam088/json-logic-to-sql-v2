import type { ValidationError } from "../types.js"

export function checkDepth(
  node: unknown,
  maxDepth: number,
  path: string,
  errors: ValidationError[],
  currentDepth = 0,
  visited = new Set<unknown>()
): void {
  if (currentDepth > maxDepth) {
    errors.push({ path, message: `Maximum nesting depth of ${maxDepth} exceeded`, code: "DEPTH_EXCEEDED" })
    return
  }

  if (node === null || typeof node !== "object") return

  if (visited.has(node)) {
    errors.push({ path, message: "Circular reference detected", code: "INVALID_STRUCTURE" })
    return
  }

  visited.add(node)

  if (Array.isArray(node)) {
    node.forEach((child, i) => checkDepth(child, maxDepth, `${path}[${i}]`, errors, currentDepth + 1, visited))
  } else {
    const keys = Object.keys(node as object)
    for (const key of keys) {
      const val = (node as Record<string, unknown>)[key]
      checkDepth(val, maxDepth, path ? `${path}.${key}` : key, errors, currentDepth + 1, visited)
    }
  }

  visited.delete(node)
}
