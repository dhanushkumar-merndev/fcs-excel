import { describe, expect, it } from "vitest";
import type { RawCell, RawRow } from "@/lib/import/cells";
import { parseCreatedTime, parseEventDate, resolveAmbiguous, resolveYearless } from "@/lib/import/dates";
import { reviewDuplicates, type ExistingLead } from "@/lib/import/duplicates";
import { normalizeId } from "@/lib/import/ids";
import { normalizeRow, parseBoolean } from "@/lib/import/normalize";
import { normalizePhone } from "@/lib/import/phone";
import { autoMapHeaders, TEMPLATE_COLUMNS } from "@/lib/import/template";
import { guestRangeLabel, humanizeCode, platformLabel } from "@/lib/domain/labels";

const s = (v: string): RawCell => ({ t: "s", v });
const n = (v: number, w?: string): RawCell => ({ t: "n", v, w });

describe("phone", () => {
  it("normalizes Meta p: values and keeps the original", () => {
    expect(normalizePhone(s("p:+919991999189"))).toEqual({ status: "valid", e164: "+919991999189", raw: "p:+919991999189", country: "IN" });
  });
  it("defaults local numbers to India", () => {
    expect(normalizePhone(s("99919 99189"))).toMatchObject({ status: "valid", e164: "+919991999189" });
    expect(normalizePhone(s("09991999189"))).toMatchObject({ status: "valid", e164: "+919991999189" });
    expect(normalizePhone(s("919991999189"))).toMatchObject({ status: "valid", e164: "+919991999189" });
    expect(normalizePhone(n(9991999189))).toMatchObject({ status: "valid", e164: "+919991999189" });
  });
  it("keeps international numbers", () => {
    expect(normalizePhone(s("+44 20 7946 0958"))).toMatchObject({ status: "valid", e164: "+442079460958" });
    expect(normalizePhone(s("0044 20 7946 0958"))).toMatchObject({ status: "valid", e164: "+442079460958" });
  });
  it("flags invalid, ambiguous, damaged and missing values", () => {
    expect(normalizePhone(s(""))).toMatchObject({ status: "missing" });
    expect(normalizePhone(s("12345"))).toMatchObject({ status: "invalid" });
    expect(normalizePhone(s("call me"))).toMatchObject({ status: "invalid" });
    // Excel keeps the full number even when it shows 9.19992E+11; text in that form has lost digits.
    expect(normalizePhone(n(919991999189, "9.19992E+11"))).toMatchObject({ status: "valid", e164: "+919991999189", raw: "9.19992E+11" });
    expect(normalizePhone(n(9845738576, "9845738576"))).toMatchObject({ status: "valid", e164: "+919845738576" });
    expect(normalizePhone(s("9.19992E+11"))).toMatchObject({ status: "invalid" });
    // "+" typed before a 10-digit Indian mobile: invalid as written, so the last 10 digits are used.
    expect(normalizePhone(s("p:+8527607478"))).toMatchObject({ status: "valid", e164: "+918527607478", note: expect.stringContaining("Indian mobile") });
    expect(normalizePhone(s("p:+9819115971"))).toMatchObject({ status: "valid", e164: "+919819115971" });
    expect(normalizePhone(s("+91 0 98457 38576"))).toMatchObject({ status: "valid", e164: "+919845738576" });
    expect(normalizePhone(s("+6591234567"))).toMatchObject({ status: "valid", e164: "+6591234567" }); // valid Singapore number is kept
    expect(normalizePhone(s("p:+9845738576"))).toMatchObject({ status: "valid", e164: "+919845738576" });
    expect("note" in normalizePhone(s("+919845738576"))).toBe(false); // valid as written: no note
    expect(normalizePhone(s("+1234567890"))).toMatchObject({ status: "invalid" }); // not an Indian mobile either
    // Stray text around a full number is dropped (with a note); too few digits stay invalid.
    expect(normalizePhone(s("p:+919845738576 in"))).toMatchObject({ status: "valid", e164: "+919845738576", note: expect.stringContaining("extra characters") });
    expect(normalizePhone(s("l9845738576"))).toMatchObject({ status: "valid", e164: "+919845738576" });
    expect(normalizePhone(s("phone"))).toMatchObject({ status: "invalid" });
    expect(normalizePhone(s("call 98457"))).toMatchObject({ status: "invalid" });
    expect(normalizePhone(n(9.19992e15, "9.19992E+15"))).toMatchObject({ status: "invalid" });
    expect(normalizePhone(s("+91 99919"))).toMatchObject({ status: "invalid" });
  });
});

describe("ids", () => {
  it("preserves prefixes and long text IDs exactly", () => {
    expect(normalizeId(s("l:1234567890123456789"))).toEqual({ value: "l:1234567890123456789", raw: "l:1234567890123456789", damaged: false });
    for (const id of ["ag:120211234567890123", "as:120211234567890124", "c:120211234567890125", "f:987654321098765"]) {
      expect(normalizeId(s(id)).value).toBe(id);
    }
    expect(normalizeId(s("1234567890123456789")).value).toBe("1234567890123456789");
  });
  it("flags IDs rounded by Excel without inventing digits", () => {
    expect(normalizeId(n(1234567890123456800, "1.23457E+18"))).toMatchObject({ value: null, raw: "1.23457E+18", damaged: true });
    expect(normalizeId(s("1.23457E+18"))).toMatchObject({ value: null, damaged: true });
    expect(normalizeId(s("1234567890123450000"))).toMatchObject({ value: null, damaged: true });
    expect(normalizeId(n(123456789012345))).toMatchObject({ value: "123456789012345", damaged: false });
  });
});

describe("dates", () => {
  it("returns yearless dates for explicit resolution", () => {
    expect(parseEventDate(s("29 October"))).toEqual({ kind: "yearless", day: 29, month: 10, raw: "29 October" });
    expect(parseEventDate(s("25 nov"))).toEqual({ kind: "yearless", day: 25, month: 11, raw: "25 nov" });
    expect(parseEventDate(s("31 oct"))).toEqual({ kind: "yearless", day: 31, month: 10, raw: "31 oct" });
    expect(parseEventDate(s("October 29"))).toMatchObject({ kind: "yearless", day: 29, month: 10 });
  });
  it("never assumes a year silently", () => {
    expect(resolveYearless(29, 10, { mode: "unresolved" }, null)).toBeNull();
    expect(resolveYearless(29, 10, { mode: "fixed", year: 2026 }, null)).toEqual({ date: "2026-10-29" });
    expect(resolveYearless(5, 1, { mode: "after_created" }, "2026-10-20T10:00:00+05:30")).toEqual({ date: "2027-01-05" });
    expect(resolveYearless(29, 2, { mode: "fixed", year: 2027 }, null)).toMatchObject({ error: expect.any(String) });
  });
  it("reads full dates and Excel date cells", () => {
    expect(parseEventDate(s("2026-11-25"))).toMatchObject({ kind: "date", date: "2026-11-25" });
    expect(parseEventDate(s("25/11/2026"))).toMatchObject({ kind: "date", date: "2026-11-25" });
    expect(parseEventDate(s("31 oct 2026"))).toMatchObject({ kind: "date", date: "2026-10-31" });
    expect(parseEventDate({ t: "d", v: 46324, w: "10/29/26" })).toMatchObject({ kind: "date", date: "2026-10-29" });
  });
  it("flags ambiguous and impossible dates", () => {
    expect(parseEventDate(s("05/10/2025"))).toEqual({ kind: "ambiguous", raw: "05/10/2025", options: ["2025-10-05", "2025-05-10"] });
    expect(parseEventDate(s("31 nov"))).toMatchObject({ kind: "invalid" });
    expect(parseEventDate(s("30/02/2026"))).toMatchObject({ kind: "invalid" });
    expect(parseEventDate(s("next sunday"))).toMatchObject({ kind: "invalid" });
  });
  it("keeps original creation time with its offset", () => {
    expect(parseCreatedTime(s("2025-10-27T18:31:36+05:30"))).toEqual({ iso: "2025-10-27T13:01:36.000Z", raw: "2025-10-27T18:31:36+05:30" });
    expect(parseCreatedTime(s("2025-10-27 18:31"))).toMatchObject({ iso: "2025-10-27T13:01:00.000Z" });
    expect(parseCreatedTime(s("yesterday"))).toMatchObject({ iso: null, error: expect.any(String) });
  });
});

describe("labels and booleans", () => {
  it("formats source codes", () => {
    expect(platformLabel("ig")).toBe("Instagram");
    expect(platformLabel("fb")).toBe("Facebook");
    expect(humanizeCode("house_party")).toBe("House Party");
    expect(humanizeCode("veg_menu")).toBe("Veg Menu");
    expect(guestRangeLabel("1_-_10")).toBe("1–10");
    expect(guestRangeLabel("more_than_30")).toBe("More than 30");
    expect(guestRangeLabel("11-20")).toBe("11–20");
  });
  it("parses the string false as false", () => {
    expect(parseBoolean(s("false"))).toEqual({ value: false, unreadable: false });
    expect(parseBoolean(s("TRUE"))).toEqual({ value: true, unreadable: false });
    expect(parseBoolean({ t: "b", v: false })).toEqual({ value: false, unreadable: false });
    expect(parseBoolean(s("maybe"))).toEqual({ value: null, unreadable: true });
  });
});

describe("header mapping", () => {
  it("maps the exact template and tolerates case and trailing spaces", () => {
    const headers = TEMPLATE_COLUMNS.map((c) => c.header);
    const mapping = autoMapHeaders(headers);
    for (const col of TEMPLATE_COLUMNS) expect(mapping[col.key]).toBe(col.header);

    const messy = autoMapHeaders(["ID ", " Full_Name", "PHONE", "crm update ", "What’s_the_occasion_for_your_event?", "No_Of_Guests_ "]);
    expect(messy).toMatchObject({ id: "ID ", full_name: " Full_Name", phone: "PHONE", crm_update: "crm update ", occasion: "What’s_the_occasion_for_your_event?", guests: "No_Of_Guests_ " });
  });
});

function templateRow(rowNumber: number, values: Partial<Record<string, RawCell>>): RawRow {
  const cells: Record<string, RawCell> = {};
  for (const col of TEMPLATE_COLUMNS) cells[col.header] = values[col.header] ?? { t: "z", v: null };
  return { rowNumber, cells };
}
const mapping = autoMapHeaders(TEMPLATE_COLUMNS.map((c) => c.header));

describe("row normalization", () => {
  const base = {
    id: s("l:1234567890123456"),
    created_time: s("2025-10-27T18:31:36+05:30"),
    is_organic: s("false"),
    platform: s("ig"),
    "what's_the_occasion_for_your_event?": s("house_party"),
    no_of_guests_: s("1_-_10"),
    "which_menu_needed?": s("veg_menu"),
    event_date: s("29 October"),
    event_address: s("  Koramangala,   Bengaluru "),
    full_name: s("  Ravi   Kumar "),
    phone: s("p:+919991999189"),
    lead_status: s("CREATED"),
    "CRM UPDATE": s("YES"),
  };

  it("cleans values, keeps originals and flags the yearless date", () => {
    const row = normalizeRow(templateRow(2, base), mapping, { mode: "unresolved" });
    expect(row.valid).toBe(true);
    expect(row.lead).toMatchObject({
      customer_name: "Ravi Kumar",
      phone_e164: "+919991999189",
      phone_raw: "p:+919991999189",
      external_lead_id: "l:1234567890123456",
      source_created_at: "2025-10-27T13:01:36.000Z",
      is_organic: false,
      platform: "ig",
      occasion_code: "house_party",
      menu_code: "veg_menu",
      guest_range: "1_-_10",
      event_date: null,
      event_date_raw: "29 October",
      event_date_status: "needs_review",
      event_address: "Koramangala, Bengaluru",
      source_status: "CREATED",
      legacy_crm_update: "YES",
    });
    expect(row.lead.review_flags).toContain("date_needs_review");
    expect(row.original.phone).toBe("p:+919991999189");
  });

  it("applies an explicit year choice", () => {
    const row = normalizeRow(templateRow(2, base), mapping, { mode: "fixed", year: 2026 });
    expect(row.lead).toMatchObject({ event_date: "2026-10-29", event_date_status: "confirmed" });
    expect(row.lead.review_flags).not.toContain("date_needs_review");
  });

  it("blanks Meta's no-permission placeholders in ad and campaign columns", () => {
    const r = normalizeRow(
      templateRow(6, {
        ...base,
        campaign_name: s("You don't have enough permissions. Please refer to this help page: https://www.facebook.com/business/help/1"),
        ad_id: s("ag:You don't have enough permission. Please refer to this help: https://www.facebook.com/business/help/1"),
      }),
      mapping,
      { mode: "unresolved" },
    );
    expect(r.valid).toBe(true);
    expect(r.lead.campaign_name).toBeNull();
    expect(r.lead.ad_id).toBeNull();
    expect(r.issues.find((i) => i.code === "meta_no_permission")?.message).toMatch(/campaign name.*left blank|ad id.*left blank/);
    expect(r.original.campaign_name).toMatch(/^You don't have enough permissions/);
  });

  it("rejects rows only for a missing or wrong phone; a missing name is imported and flagged", () => {
    const nameless = normalizeRow(templateRow(3, { ...base, full_name: s(" ") }), mapping, { mode: "unresolved" });
    expect(nameless.valid).toBe(true);
    expect(nameless.lead.customer_name).toBe("Name not given");
    expect(nameless.lead.review_flags).toContain("name_missing");
    expect(normalizeRow(templateRow(4, { ...base, phone: s("12") }), mapping, { mode: "unresolved" }).valid).toBe(false);
    expect(normalizeRow(templateRow(5, { ...base, phone: s("") }), mapping, { mode: "unresolved" }).valid).toBe(false);
  });
});

describe("duplicates", () => {
  const norm = (rowNumber: number, values: Partial<Record<string, RawCell>>) =>
    normalizeRow(templateRow(rowNumber, { full_name: s("Asha"), phone: s("9991999189"), ...values }), mapping, { mode: "unresolved" });
  const existing: ExistingLead = {
    lead_id: "11111111-1111-4111-8111-111111111111", lead_number: 1001, customer_name: "Asha", phone_e164: "+919991999189",
    source_system: "meta_lead_ads", external_lead_id: "l:1", external_lead_id_raw: "l:1", event_date: "2026-11-02",
    event_date_status: "confirmed", occasion_code: "birthday", menu_code: null, guest_range: null, event_address: null,
    stage: "contacted", owner_id: null, owner_name: "Anil",
  };

  it("skips exact source duplicates and repeats within the file", () => {
    const rows = [norm(2, { id: s("l:1") }), norm(3, { id: s("l:2") }), norm(4, { id: s("l:2") })];
    const review = reviewDuplicates(rows, [existing]);
    expect(review.get(2)).toMatchObject({ forcedSkip: "exact_duplicate", defaultDecision: "skip" });
    expect(review.get(4)).toMatchObject({ forcedSkip: "duplicate_in_file" });
  });

  it("warns on repeat customers and escalates same-date events", () => {
    const rows = [
      norm(2, { id: s("l:5"), event_date: s("2026-12-20"), "what's_the_occasion_for_your_event?": s("anniversary") }),
      norm(3, { id: s("l:6"), event_date: s("2026-11-02"), "what's_the_occasion_for_your_event?": s("birthday") }),
    ];
    const review = reviewDuplicates(rows, [existing]);
    expect(review.get(2)).toMatchObject({ needsDecision: false, defaultDecision: "import" });
    expect(review.get(2)!.warnings[0].kind).toBe("repeat_customer");
    expect(review.get(3)!.needsDecision).toBe(true);
    expect(review.get(3)!.warnings.some((w) => w.kind === "possible_duplicate_event")).toBe(true);
  });

  it("never matches on blank or invalid phones", () => {
    const rows = [norm(2, { id: s("l:7"), phone: s("") }), norm(3, { id: s("l:8"), phone: s("") })];
    const review = reviewDuplicates(rows, []);
    expect(review.get(3)!.warnings).toHaveLength(0);
  });
});

describe("messy event dates from real lead forms", () => {
  const d = (v: string) => parseEventDate(s(v));
  it("reads ordinals with spaces, typos and glued text", () => {
    expect(d("11 th November")).toMatchObject({ kind: "yearless", day: 11, month: 11 });
    expect(d("October 21 st")).toMatchObject({ kind: "yearless", day: 21, month: 10 });
    expect(d("9 th sep 2026")).toMatchObject({ kind: "date", date: "2026-09-09" });
    expect(d("7septmber")).toMatchObject({ kind: "yearless", day: 7, month: 9 });
    expect(d("Desember 24")).toMatchObject({ kind: "yearless", day: 24, month: 12 });
    expect(d("17 /10/26")).toMatchObject({ kind: "date", date: "2026-10-17" });
    expect(d("26.0ct 2026")).toMatchObject({ kind: "date", date: "2026-10-26" });
    expect(d("22/9")).toMatchObject({ kind: "yearless", day: 22, month: 9 });
    expect(d("5/10").kind).toBe("invalid"); // 5 Oct or 10 May, and no year
  });

  it("finds the date written inside other text, keeping the original", () => {
    expect(d("6th Nov - approximately 30 people")).toMatchObject({ kind: "yearless", day: 6, month: 11, raw: "6th Nov - approximately 30 people" });
    expect(d("17to20 Oct")).toMatchObject({ kind: "yearless", day: 17, month: 10 });
    expect(d("Oct 16th and 17th")).toMatchObject({ kind: "yearless", day: 16, month: 10 });
    expect(d("October 10 dinner")).toMatchObject({ kind: "yearless", day: 10, month: 10 });
    expect(d("Jain food only \nBut different cuisines \n23/24 September")).toMatchObject({ kind: "yearless", day: 23, month: 9 });
    expect(d("Still to be finalized  app    27 sep")).toMatchObject({ kind: "yearless", day: 27, month: 9 });
    expect(d("Ganpati mai 15 to 18 September aa sakte ho")).toMatchObject({ kind: "yearless", day: 15, month: 9 });
  });

  it("leaves text without a clear day and month for review", () => {
    for (const v of ["Not decided", "next week", "21", "In mid nov", "Diwali", "Approx 26-30 Pax both Veg and Non veg menu", "Wednesday 16th dept", "1 niv 26", "Marriage 5"]) {
      expect(d(v).kind, v).toBe("invalid");
    }
  });

  it("settles DD/MM ambiguity only when one reading is in the year after the enquiry", () => {
    expect(resolveAmbiguous(["2026-11-04", "2026-04-11"], "2026-09-10T10:00:00Z")).toBe("2026-11-04");
    expect(resolveAmbiguous(["2026-09-12", "2026-12-09"], "2026-08-01T10:00:00Z")).toBeNull(); // both upcoming
    expect(resolveAmbiguous(["2026-11-04", "2026-04-11"], null)).toBeNull();
  });
});
