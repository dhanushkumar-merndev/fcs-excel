import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

function readEnv(file: string) {
  const path = resolve(import.meta.dirname, "../..", file);
  if (!existsSync(path)) return {} as Record<string, string>;
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => [m[1], m[2]]),
  );
}

export const demo = readEnv(".env.demo.local");
export const hasDemo = Boolean(demo.DEMO_ADMIN_EMAIL);

export async function signIn(page: Page, who: "ADMIN" | "MANAGER" | "SALES_A" | "SALES_B") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(demo[`DEMO_${who}_EMAIL`]);
  await page.getByLabel("Password").fill(demo[`DEMO_${who}_PASSWORD`]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export const fixture = (name: string) => resolve(import.meta.dirname, "../fixtures", name);
