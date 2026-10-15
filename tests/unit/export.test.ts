import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { buildCsv, buildWorkbook, sanitize } = await import("@/lib/export/sheet");

const sheet = {
  name: "Leads",
  columns: [
    { header: "Phone", type: "text" as const },
    { header: "Source lead ID", type: "text" as const },
    { header: "Event date", type: "date" as const },
    { header: "Created", type: "datetime" as const },
    { header: "Name", type: "text" as const },
    { header: "Amount", type: "number" as const },
  ],
  rows: [
    ["+919991999189", "l:1234567890123456789", "2026-10-29", "2026-10-27T13:01:36.000Z", "=HYPERLINK(\"http://evil\")", 45000],
    ["+919812345678", "1234567890123456789", null, null, "@SUM(A1)", null],
  ],
};

describe("exports", () => {
  it("xlsx keeps phones and IDs as text, dates as real date cells, and neutralizes formulas", () => {
    const wb = XLSX.read(buildWorkbook([sheet]), { type: "buffer", cellNF: true });
    const ws = wb.Sheets.Leads;
    expect(ws.A2).toMatchObject({ t: "s", v: "+919991999189" });
    expect(ws.B2).toMatchObject({ t: "s", v: "l:1234567890123456789" });
    expect(ws.B3).toMatchObject({ t: "s", v: "1234567890123456789" });
    expect(ws.C2.t).toBe("n");
    expect(ws.C2.z).toBe("dd mmm yyyy");
    expect(XLSX.SSF.format("yyyy-mm-dd", ws.C2.v)).toBe("2026-10-29");
    expect(ws.D2.t).toBe("n");
    expect(XLSX.SSF.format("yyyy-mm-dd hh:mm", ws.D2.v)).toBe("2026-10-27 18:31"); // shown in IST
    expect(ws.E2).toMatchObject({ t: "s", v: "'=HYPERLINK(\"http://evil\")" });
    expect(ws.E3).toMatchObject({ t: "s", v: "'@SUM(A1)" });
    expect(ws.F2).toMatchObject({ t: "n", v: 45000 });
    expect(Object.values(ws).some((c) => typeof c === "object" && c !== null && "f" in c)).toBe(false);
  });

  it("csv is UTF-8 with BOM and guards every formula prefix", () => {
    const csv = buildCsv(sheet);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Phone,Source lead ID,Event date,Created,Name,Amount");
    expect(lines[1]).toBe(`'+919991999189,l:1234567890123456789,2026-10-29,2026-10-27 18:31,"'=HYPERLINK(""http://evil"")",45000`);
    expect(lines[2]).toBe("'+919812345678,1234567890123456789,,,'@SUM(A1),");
  });

  it("sanitize covers the OWASP prefixes for CSV", () => {
    for (const v of ["=1+1", "+1", "-1", "@x", "\tx", "\rx"]) expect(sanitize(v, "csv").startsWith("'")).toBe(true);
    expect(sanitize("Ravi", "csv")).toBe("Ravi");
    expect(sanitize("+919991999189", "xlsx")).toBe("+919991999189");
  });
});
