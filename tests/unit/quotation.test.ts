import { describe, expect, it } from "vitest";
import { advanceFor, formatAmount, istDate, parseAmount, quotationDefaults, quotationTotals } from "@/lib/quotation/build";

const lead = {
  lead_number: 1042,
  customer_name: "Rahul Sharma",
  occasion_code: "birthday_party",
  guest_range: "25_-_50_members",
  event_date: "2026-11-22",
  event_date_raw: "22/11",
  event_address: "HSR Layout, Bengaluru",
  quoted_amount_inr: "6500.00",
};

describe("quotation amounts", () => {
  it("parses typed amounts", () => {
    expect(parseAmount("6,500")).toBe(6500);
    expect(parseAmount("₹ 6500.50")).toBe(6500.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(1200)).toBe(1200);
  });

  it("formats with Indian grouping", () => {
    expect(formatAmount(650000)).toBe("6,50,000");
  });

  it("final = package − discount, advance = 40% rounded", () => {
    expect(quotationTotals("6,500", "500")).toEqual({ final: 6000, advance: 2400 });
    expect(quotationTotals("6,500", "")).toEqual({ final: 6500, advance: 2600 });
    expect(quotationTotals("999", "0")).toEqual({ final: 999, advance: 400 });
  });

  it("never goes below zero and stays blank without a price", () => {
    expect(quotationTotals("500", "900")).toEqual({ final: 0, advance: 0 });
    expect(quotationTotals("", "100")).toEqual({ final: null, advance: null });
    expect(advanceFor(null)).toBeNull();
  });
});

describe("quotationDefaults", () => {
  // 20:00 UTC on 12 Nov is already 13 Nov in India.
  const now = new Date("2026-11-12T20:00:00Z");

  it("uses the India calendar date", () => {
    expect(istDate(now)).toBe("2026-11-13");
  });

  it("pre-fills from the lead", () => {
    expect(quotationDefaults(lead, now)).toEqual({
      quoteNo: "KB-1042-261113",
      quoteDate: "13 Nov 2026",
      validTill: "13 Nov 2026",
      customerName: "Rahul Sharma",
      eventDate: "22 Nov 2026",
      occasion: "Birthday Party",
      guests: "25–50",
      location: "HSR Layout, Bengaluru",
      packagePrice: "6,500",
    });
  });

  it("leaves unknown fields blank instead of printing a dash", () => {
    const d = quotationDefaults(
      { ...lead, occasion_code: null, guest_range: null, event_date: null, event_date_raw: null, event_address: null, quoted_amount_inr: null },
      now,
    );
    expect(d).toMatchObject({ occasion: "", guests: "", eventDate: "", location: "", packagePrice: "" });
  });

  it("falls back to the original date text when the date needs review", () => {
    expect(quotationDefaults({ ...lead, event_date: null, event_date_raw: "next month" }, now).eventDate).toBe("next month");
  });
});
