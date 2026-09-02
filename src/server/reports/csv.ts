import "server-only";

/**
 * Hand-rolled CSV generation (RFC 4180) for the Reports screens' export —
 * no new dependency needed for something this simple. A field is wrapped
 * in double quotes (with any embedded quote doubled) whenever it contains
 * a comma, quote, or newline; every other field is written as-is.
 */
function escapeCsvField(value: string): string {
  if (/["\n\r,]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a full CSV document from an Arabic header row + data rows,
 * prefixed with a UTF-8 BOM — without it, Excel guesses the wrong
 * encoding for Arabic text and shows mojibake instead of the real
 * characters. `\r\n` line endings, per RFC 4180.
 */
export function buildCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(
      row
        .map((v) => escapeCsvField(v === null || v === undefined ? "" : String(v)))
        .join(","),
    );
  }
  const UTF8_BOM = "﻿";
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

/** Shared Content-Type/Content-Disposition headers for a CSV download. */
export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}
