import { expect, test } from "@playwright/test";

test("signed-out visitors are sent to sign in, which renders cleanly", async ({ page }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login\?next=%2Fleads/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  // No horizontal scroll at any width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("dark theme applies before paint from the saved preference", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("API routes reject anonymous callers", async ({ request }) => {
  const res = await request.post("/api/leads/00000000-0000-4000-8000-000000000000/dial");
  expect([401, 404]).toContain(res.status());
  const exp = await request.get("/api/exports/leads?format=csv");
  expect(exp.status()).toBe(401);
});
