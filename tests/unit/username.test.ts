import { describe, expect, it } from "vitest";
import { generatePassword, isValidUsername, loginEmailFor, normalizeUsername, suggestUsername } from "@/lib/auth/username";

describe("usernames", () => {
  it("normalizes what people type", () => {
    expect(normalizeUsername("  Gayathri ")).toBe("gayathri");
  });

  it("accepts only the documented format", () => {
    for (const ok of ["gayathri", "anil.k", "sales_2", "a-b", "abc", "x".repeat(32)]) expect(isValidUsername(ok)).toBe(true);
    for (const bad of ["ab", "x".repeat(33), "has space", "Upper", ".lead", "-lead", "a@b", ""]) expect(isValidUsername(bad)).toBe(false);
  });

  it("suggests a username from the full name", () => {
    expect(suggestUsername("Sakthi Gayathri")).toBe("sakthi");
    expect(suggestUsername("Al Ravi")).toBe("alravi");
    expect(suggestUsername("  Divya  ")).toBe("divya");
    expect(isValidUsername(suggestUsername("Sakthi Gayathri"))).toBe(true);
  });

  it("maps usernames to an internal address that can never receive mail", () => {
    expect(loginEmailFor("gayathri")).toBe("gayathri@fcs-staff.invalid");
  });

  it("generates readable random passwords", () => {
    const passwords = Array.from({ length: 50 }, () => generatePassword());
    for (const p of passwords) expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{10}$/);
    expect(new Set(passwords).size).toBe(50);
    expect(generatePassword(16)).toHaveLength(16);
  });
});
