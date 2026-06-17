
function formatUTC(d: Date, withMs = false): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0")
  const year = d.getUTCFullYear()
  const yearStr = year < 0 ? `-${pad(Math.abs(year), 4)}` : pad(year, 4)
  const month = pad(d.getUTCMonth() + 1)
  const day = pad(d.getUTCDate())
  const hours = pad(d.getUTCHours())
  const minutes = pad(d.getUTCMinutes())
  const seconds = pad(d.getUTCSeconds())
  const base = `${yearStr}-${month}-${day}T${hours}:${minutes}:${seconds}`
  if (withMs) {
    return `${base}.${pad(d.getUTCMilliseconds(), 3)}`
  }
  return base
}

/**
 * Normalizes a date value (either an ISO 8601 string or a Date object)
 * into the format required by the target database dialect.
 */
export function normalizeDateForDB(
  value: unknown,
  format: "mysql" | "mssql" | "iso" | "unix"
): string | number | null {
  if (value == null) return null

  // If it's a string or number, try to parse it. If it's a Date, use it. Otherwise, return null.
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return null
  }

  if (typeof value === "string") {
    const hasTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)
    const hasTimezone = /(Z|[+-]\d{2}(:?\d{2})?)$/.test(value)
    if (hasTime && !hasTimezone) {
      return null
    }
  }

  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) {
    return null
  }

  switch (format) {
    case "mysql":
      return formatUTC(d).replace("T", " ")

    case "mssql":
      return formatUTC(d, true)

    case "unix":
      return Math.floor(d.getTime() / 1000)

    case "iso":
      return d.toISOString()
  }
}
