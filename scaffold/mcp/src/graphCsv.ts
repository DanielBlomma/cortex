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

export function writeCsv(filePath: string, header: string[], rows: Iterable<CsvValue[]>): number {
  const fd = fs.openSync(filePath, "w");
  let rowCount = 0;

  try {
    fs.writeSync(fd, `${toCsvRow(header)}\n`, undefined, "utf8");
    for (const row of rows) {
      fs.writeSync(fd, `${toCsvRow(row)}\n`, undefined, "utf8");
      rowCount += 1;
    }
  } finally {
    fs.closeSync(fd);
  }

  return rowCount;
}

// Escape a filesystem path for use inside a double-quoted ryugraph COPY path
// literal. Separators are normalized to "/" (accepted on every platform,
// Windows included) and any embedded double quote is backslash-escaped, so a
// repo or cache path containing a quote does not break the COPY statement and
// silently lose the bulk-load path. Order matters: normalize separators first,
// then escape quotes, so the escaping backslash is not itself rewritten.
export function toCopyPathLiteral(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/"/g, '\\"');
}
