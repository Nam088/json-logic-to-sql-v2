
/**
 * Normalizes a date value (either an ISO 8601 string or a Date object)
 * into the format required by the target database dialect.
 */
export function normalizeDateForDB(
  value: unknown,
  format: "mysql" | "mssql" | "iso" | "unix"
): string | number | null {
  if (value == null) return null

  // If it's a string, try to parse it. If it's a Date, use it. Otherwise, pass it through.
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null
  }

  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) {
    return typeof value === "string" ? value : null // Pass-through invalid strings (validator will catch them)
  }

  switch (format) {
    case "mysql":
      // Convert "2026-01-01T00:00:00.000Z" -> "2026-01-01 00:00:00"
      return d.toISOString().slice(0, 19).replace("T", " ")

    case "mssql":
      // Convert "2026-01-01T00:00:00.000Z" -> "2026-01-01T00:00:00.000" (no Z suffix)
      return d.toISOString().slice(0, 23)

    case "unix":
      return Math.floor(d.getTime() / 1000)

    case "iso":
    default:
      return d.toISOString()
  }
}
