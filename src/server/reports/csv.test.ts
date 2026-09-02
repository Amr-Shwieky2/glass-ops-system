import { describe, it, expect } from "vitest";
import { escapeCsvField, buildCsv, csvResponseHeaders } from "@/server/reports/csv";

describe("escapeCsvField", () => {
  it("passes ordinary Arabic text through unchanged", () => {
    expect(escapeCsvField("أحمد محمد")).toBe("أحمد محمد");
    expect(escapeCsvField("شركة الزجاج الحديثة")).toBe("شركة الزجاج الحديثة");
  });

  it("passes ordinary Latin/numeric text through unchanged", () => {
    expect(escapeCsvField("Toyota Hilux")).toBe("Toyota Hilux");
    expect(escapeCsvField("1234.50")).toBe("1234.50");
    expect(escapeCsvField("")).toBe("");
  });

  // --- CSV/formula injection guard (fixed in Phase 10b) ---

  it("prefixes a field starting with = with a leading apostrophe", () => {
    expect(escapeCsvField("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
  });

  it("prefixes a field starting with + with a leading apostrophe", () => {
    expect(escapeCsvField("+1+1")).toBe("'+1+1");
  });

  it("prefixes a field starting with - with a leading apostrophe", () => {
    expect(escapeCsvField("-2+3")).toBe("'-2+3");
  });

  it("prefixes a field starting with @ with a leading apostrophe", () => {
    expect(escapeCsvField("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
  });

  it("does not touch a legitimate negative number-looking field beyond the guard", () => {
    // The mitigation is deliberately blunt (any leading -/+/=/@) — this
    // documents that a customer-entered negative number gets the same
    // apostrophe prefix, which is the accepted tradeoff per the file's
    // own comment (a real negative number never appears in a raw text
    // export column here; numbers are formatted through money.ts first).
    expect(escapeCsvField("-50.00")).toBe("'-50.00");
  });

  it("only guards a LEADING special character, not one in the middle", () => {
    expect(escapeCsvField("A=B")).toBe("A=B");
    expect(escapeCsvField("total-cost")).toBe("total-cost");
  });

  // --- RFC 4180 quoting ---

  it("quotes a field containing a comma", () => {
    expect(escapeCsvField("Haifa, Israel")).toBe('"Haifa, Israel"');
  });

  it("quotes and doubles an embedded double quote", () => {
    expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("applies formula-injection neutralization BEFORE RFC 4180 quoting", () => {
    // A field that is both dangerous (leading =) and needs quoting
    // (contains a comma) must get both: the apostrophe prefix, then the
    // whole thing quoted.
    expect(escapeCsvField("=1+2,3")).toBe('"\'=1+2,3"');
  });
});

describe("buildCsv", () => {
  it("starts with a UTF-8 BOM", () => {
    const csv = buildCsv(["a"], [["1"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("joins the header row and data rows with \\r\\n", () => {
    const csv = buildCsv(
      ["الاسم", "المبلغ"],
      [
        ["أحمد", "100.00"],
        ["سامر", "200.00"],
      ],
    );
    const withoutBom = csv.slice(1);
    expect(withoutBom).toBe(
      "الاسم,المبلغ\r\nأحمد,100.00\r\nسامر,200.00\r\n",
    );
  });

  it("renders null/undefined data cells as empty strings", () => {
    const csv = buildCsv(["a", "b"], [["x", null], ["y", undefined]]);
    expect(csv.slice(1)).toBe("a,b\r\nx,\r\ny,\r\n");
  });

  it("stringifies numeric cells", () => {
    const csv = buildCsv(["amount"], [[42]]);
    expect(csv.slice(1)).toBe("amount\r\n42\r\n");
  });

  it("neutralizes formula-injection in a data cell end-to-end", () => {
    const csv = buildCsv(["name"], [["=cmd|'/c calc'!A1"]]);
    expect(csv.slice(1)).toBe("name\r\n'=cmd|'/c calc'!A1\r\n");
  });

  it("produces an empty-but-valid document for zero rows", () => {
    const csv = buildCsv(["a", "b"], []);
    expect(csv.slice(1)).toBe("a,b\r\n");
  });
});

describe("csvResponseHeaders", () => {
  it("sets a CSV content type with UTF-8 charset", () => {
    const headers = csvResponseHeaders("report.csv") as Record<string, string>;
    expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8");
  });

  it("sets a Content-Disposition attachment header with the given filename", () => {
    const headers = csvResponseHeaders("جدول.csv") as Record<string, string>;
    expect(headers["Content-Disposition"]).toBe('attachment; filename="جدول.csv"');
  });
});
