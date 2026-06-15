import fs from "node:fs";

// ryugraph's CSV reader treats an empty field as NULL by default
// (DEFAULT_CSV_NULL_STRINGS = {""}), so a quoted empty string round-trips to
// null rather than "". Every column the graph loader emits is a real
// string/number/bool produced by asString/asNumber/asBoolean — never null —
// so we override NULL_STRINGS with a sentinel that cannot occur in any cell.
// A NUL byte qualifies: ingest's binary-file filter rejects any source file
// containing one, and filesystem paths and computed ids cannot contain NUL
// either. This keeps empty strings as "" and matches the prepared-statement
// loader byte-for-byte.
export const CSV_NULL_SENTINEL = String.fromCharCode(0);

// PARALLEL=false is required: ryugraph's parallel CSV reader rejects quoted
// newlines, and chunk/rule/ADR bodies routinely contain them. ESCAPE='"'
// plus QUOTE='"' is RFC 4180 style (a literal quote is written as "").
export const CSV_COPY_OPTIONS = `(HEADER=true, DELIM=",", QUOTE='"', ESCAPE='"', PARALLEL=false, NULL_STRINGS=['${CSV_NULL_SENTINEL}'])`;

export type CsvValue = string | number | boolean | null | undefined;

// Every cell is quoted unconditionally and internal quotes are doubled. The
// reader coerces quoted "true"/"123" back to BOOL/INT64 columns, so a single
// uniform escaping path covers strings, numbers, and booleans.
export function toCsvCell(value: CsvValue): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "boolean"
        ? value
          ? "true"
          : "false"
        : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsvRow(values: CsvValue[]): string {
  return values.map(toCsvCell).join(",");
}

export function writeCsv(filePath: string, header: string[], rows: CsvValue[][]): void {
  const lines = [toCsvRow(header)];
  for (const row of rows) {
    lines.push(toCsvRow(row));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}
