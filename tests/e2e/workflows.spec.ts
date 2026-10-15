/**
 * End-to-end workflows against the staging project with demo data (pnpm seed:demo).
 * Skipped automatically when .env.demo.local is missing.
 */
import * as XLSX from "xlsx";
import { expect, test } from "@playwright/test";
import { fixture, hasDemo, signIn } from "./helpers";

test.skip(!hasDemo, "Run pnpm seed:demo against staging first.");

test.describe("salesperson", () => {
  test("home answers who to contact next; Call records a dial only; call log + follow-up + note persist", async ({ page }) => {
    await signIn(page, "SALES_A");
    await expect(page.getByText("Here's who to contact next.").or(page.getByText("You're all caught up."))).toBeVisible();

    await page.goto("/leads");
    const first = page.locator('a[href^="/leads/"]').filter({ hasNotText: "Leads" }).first();
    await first.click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);

    // Tapping Call opens tel: and must not create a call log.
    await page.evaluate(() => {
      document.querySelectorAll('a[href^="tel:"]').forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));
    });
    await page.locator('a[href^="tel:"]').filter({ hasText: "Call" }).first().click();
    await page.reload();
    await page.getByRole("tab", { name: /Activity/ }).click();
    await expect(page.getByText("Tapped Call").first()).toBeVisible();
    await expect(page.getByText("Dial attempt only — not a logged call.").first()).toBeVisible();

    // Log a call with a note and next follow-up in one flow.
    await page.getByRole("button", { name: "Log call" }).first().click();
    await page.getByRole("radio", { name: "Busy" }).click();
    await page.getByLabel("Note").fill("E2E: line busy, will retry");
    await page.getByRole("radio", { name: "Tomorrow, 10 AM" }).click();
    await page.getByRole("button", { name: "Save call" }).click();
    await expect(page.getByText("Call logged")).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: /Notes/ }).click();
    await expect(page.getByText("E2E: line busy, will retry").first()).toBeVisible();
    await page.getByRole("tab", { name: /Activity/ }).click();
    await expect(page.getByText("Logged call: Busy").first()).toBeVisible();
  });

  test("cannot open another salesperson's lead by URL or API", async ({ page, browser }) => {
    // Find a lead owned by Sales B while signed in as B.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signIn(pageB, "SALES_B");
    await pageB.goto("/leads");
    const href = await pageB.locator('a[href^="/leads/"]').filter({ hasNotText: "Leads" }).first().getAttribute("href");
    await ctxB.close();
    expect(href).toMatch(/\/leads\/[0-9a-f-]{36}/);

    await signIn(page, "SALES_A");
    await page.goto(href!);
    await expect(page.getByText("Not found or no access")).toBeVisible();
    const api = await page.request.post(`/api/leads${href!.replace("/leads", "")}/dial`, { headers: { origin: new URL(page.url()).origin } });
    expect(api.status()).toBe(404);
    const exp = await page.request.get(`/api/exports/leads?scope=selected&ids=${href!.split("/").pop()}&format=csv`);
    expect([403]).toContain(exp.status()); // exports are disabled for salespeople by default
  });
});

test.describe("manager", () => {
  test("1,001-row file gets a clear limit message", async ({ page }) => {
    await signIn(page, "MANAGER");
    await page.goto("/imports/new");
    await page.locator('input[type="file"]').setInputFiles(fixture("too-many-1001.xlsx"));
    await expect(page.getByText(/1,001 data rows.*limit is 1,000/)).toBeVisible();
  });

  test("bulk-assign from the leads list and export the filtered result", async ({ page }) => {
    test.skip(test.info().project.name === "mobile", "Bulk table selection is a desktop workflow.");
    await signIn(page, "MANAGER");
    await page.goto("/leads?view=unassigned");
    const checkboxes = page.getByRole("checkbox", { name: /^Select / });
    const n = Math.min(await checkboxes.count(), 3);
    test.skip(n === 0, "No unassigned demo leads left.");
    for (let i = 0; i < n; i++) await checkboxes.nth(i).check();
    await page.getByRole("button", { name: "Assign" }).click();
    await page.getByRole("radio", { name: /Anil/ }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).last().click();
    await expect(page.getByText(/assigned to Anil/)).toBeVisible();

    await page.goto("/leads?view=all");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export/ }).click();
    await page.getByRole("menuitem", { name: "Excel (.xlsx)" }).first().click();
    const file = await (await download).path();
    const wb = XLSX.readFile(file);
    expect(wb.SheetNames).toEqual(["Leads", "Export info"]);
    const ws = wb.Sheets.Leads;
    expect(ws.C1.v).toBe("Phone");
    expect(ws.C2.t).toBe("s");
    expect(String(ws.C2.v)).toMatch(/^\+91\d{10}$/);
    expect(String(XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Export info"], { header: 1 })[1][1])).toMatch(/Full filtered result/);
  });
});

test.describe("mobile layout", () => {
  test("bottom navigation and bottom sheets at 360px", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "Mobile only.");
    await signIn(page, "SALES_A");
    const nav = page.getByRole("navigation", { name: "Main navigation" }).last();
    for (const label of ["Home", "Leads", "Follow-ups", "More"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
    await page.goto("/leads");
    await page.getByRole("button", { name: "Log call" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save call" })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
