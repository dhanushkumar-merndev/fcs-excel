import { describe, expect, it } from "vitest";
import { nextPhase, stagesForPhase } from "@/lib/domain/stages";
import { DEFAULT_PLAN, SCENARIOS, deskKpis, prorate, rating, scorecard, targetFunnel, type DeskMetricRow } from "@/lib/domain/targets";

describe("target funnel", () => {
  it("matches the planning document's three scenarios exactly", () => {
    const rows = SCENARIOS.map((s) => targetFunnel({ ...DEFAULT_PLAN, leadsPerDay: s.leadsPerDay }));
    expect(rows.map((f) => [f.leads, f.qualified, f.bookings, f.chefBookings, f.cateringBookings])).toEqual([
      [780, 546, 218, 174, 44],
      [1040, 728, 291, 233, 58],
      [1300, 910, 364, 291, 73],
    ]);
    expect(rows.map((f) => [f.chefRevenue, f.cateringRevenue, f.revenue])).toEqual([
      [435_000, 1_760_000, 2_195_000],
      [582_500, 2_320_000, 2_902_500],
      [727_500, 2_920_000, 3_647_500],
    ]);
  });

  it("applies BDE 1's push rate before qualification", () => {
    const f = targetFunnel({ ...DEFAULT_PLAN, pushRate: 50 });
    expect([f.leads, f.pushed, f.qualified, f.bookings]).toEqual([1040, 520, 364, 146]);
  });

  it("prorates to part of the month", () => {
    expect(prorate(targetFunnel(DEFAULT_PLAN), 13 / 26)).toMatchObject({ leads: 520, qualified: 364, bookings: 146 });
    expect(prorate(targetFunnel(DEFAULT_PLAN), 2).leads).toBe(1040);
  });
});

describe("desk KPIs and scorecard", () => {
  const rows: DeskMetricRow[] = [
    { desk: "lead_desk", metric: "received", leads: 100 },
    { desk: "lead_desk", metric: "attended", leads: 95 },
    { desk: "lead_desk", metric: "pushed", leads: 60 },
    { desk: "qualification", metric: "received", leads: 60 },
    { desk: "qualification", metric: "pushed", leads: 42 },
    { desk: "closing", metric: "received", leads: 40 },
    { desk: "closing", metric: "pushed", leads: 12 },
    { desk: "operations", metric: "received", leads: 12 },
    { desk: "operations", metric: "acknowledged", leads: 12 },
  ];

  it("computes each desk's rate against its target", () => {
    const k = deskKpis(rows, DEFAULT_PLAN);
    expect(k.map((d) => [d.desk, d.rate, d.target])).toEqual([
      ["lead_desk", 95, 100],
      ["qualification", 70, 70],
      ["closing", 30, 40],
      ["operations", 100, 100],
    ]);
  });

  it("scores 25 / 25 / 30 / 20, capped at each weight, with the rating band", () => {
    const s = scorecard(deskKpis(rows, DEFAULT_PLAN));
    expect(s.desks.map((d) => d.score)).toEqual([23.8, 25, 22.5, 20]);
    expect(s.total).toBe(91.3);
    expect(s.rating?.label).toBe("Excellent");
    expect(s.partial).toBe(false);
  });

  it("scales to 100 when a desk had nothing to work on, and is empty with no data", () => {
    const s = scorecard(deskKpis(rows.filter((r) => r.desk !== "operations"), DEFAULT_PLAN));
    expect(s.partial).toBe(true);
    expect(s.total).toBe(89.1); // 71.3 of 80
    expect(scorecard(deskKpis([], DEFAULT_PLAN))).toMatchObject({ total: null, rating: null });
  });

  it("uses the document's rating bands", () => {
    expect([95, 85, 75, 65, 59.9].map((n) => rating(n).label)).toEqual([
      "Excellent",
      "Very Good",
      "Satisfactory",
      "Needs Improvement",
      "Performance Improvement Plan",
    ]);
  });
});

describe("desks", () => {
  it("knows each desk's own stages and the next desk", () => {
    expect(stagesForPhase("lead_desk")).toEqual(["new", "contact_attempted", "contacted", "lost", "unqualified"]);
    expect(stagesForPhase("operations")).toEqual(["lost", "unqualified"]);
    expect([nextPhase("lead_desk"), nextPhase("closing"), nextPhase("operations")]).toEqual(["qualification", "operations", null]);
  });
});
