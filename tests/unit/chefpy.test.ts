import { describe, expect, it } from "vitest";
import { countByStatus, directorySchema, matchesQuery, sortChefs, type Chef } from "@/lib/chefpy/directory";

const base = {
  phone: "+919876543210",
  email: "",
  chef_type: "caterer",
  cuisine: "North Indian",
  experience: 5,
  region: "Delhi",
  location: "NCR",
  online: true,
  approval_status: "approved",
  registered_at: null,
  current: null,
  open_bids: 0,
} as const;

const chef = (id: string, name: string, status: Chef["status"], extra: Partial<Chef> = {}): Chef => ({ ...base, id, name, status, ...extra });

describe("chefpy directory", () => {
  it("parses the contract and tolerates missing optional fields", () => {
    const parsed = directorySchema.parse({
      generated_at: "2026-11-07T10:00:00Z",
      chefs: [
        {
          id: "a",
          name: "Asha",
          approval_status: "approved",
          status: "booked",
          current: {
            kind: "awarded_bid",
            code: "OR-1001",
            service: "Birthday dinner",
            customer: "Rao",
            scheduled_start: "2026-11-08T12:00:00Z",
            scheduled_end: "2026-11-08T16:00:00Z",
            amount: 4500,
          },
        },
      ],
    });
    expect(parsed.chefs[0]).toMatchObject({ phone: "", online: false, open_bids: 0, current: { code: "OR-1001", amount: 4500 } });
  });

  it("rejects an unknown status", () => {
    expect(directorySchema.safeParse({ generated_at: "x", chefs: [{ ...base, id: "a", name: "A", status: "busy" }] }).success).toBe(false);
  });

  it("counts and sorts booked chefs first", () => {
    const list = [chef("1", "Zed", "available"), chef("2", "Mina", "booked"), chef("3", "Abe", "pending"), chef("4", "Ben", "available")];
    expect(countByStatus(list)).toEqual({ total: 4, available: 2, booked: 1, offline: 0, pending: 1, rejected: 0 });
    expect(sortChefs(list).map((c) => c.name)).toEqual(["Mina", "Ben", "Zed", "Abe"]);
  });

  it("searches by name, cuisine, chef type and phone digits", () => {
    const c = chef("1", "Asha Rao", "available");
    expect(matchesQuery(c, "asha")).toBe(true);
    expect(matchesQuery(c, "north")).toBe(true);
    expect(matchesQuery(c, "Caterer")).toBe(true);
    expect(matchesQuery(c, "98765 43")).toBe(true);
    expect(matchesQuery(c, "biryani")).toBe(false);
  });
});
