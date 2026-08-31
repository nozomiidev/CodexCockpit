import { test as base, expect, type Page } from "@playwright/test";

export const test = base.extend<{ sessionId: string }>({
  // Playwright requires fixture arguments to use an object destructuring pattern.
  // biome-ignore lint/correctness/noEmptyPattern: no built-in fixture is needed to derive this deterministic ID.
  sessionId: async ({}, use, testInfo) => {
    const testId = testInfo.testId.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(-80);
    await use(`e2e-${testId}-${testInfo.retry}`);
  },
});

export { expect };

export async function openCockpit(page: Page, sessionId: string, role: "left" | "right" = "left") {
  await page.goto(`/?session=${encodeURIComponent(sessionId)}&role=${role}`);
  await expect(page.getByTestId("cockpit-shell")).toBeVisible();
  await expect(page.getByRole("status", { name: /connection status/i })).toContainText(
    /local demo|connected|接続済み/i,
  );
}

export async function selectResponseMode(page: Page, mode: "text" | "tool") {
  await page
    .getByRole("tab", { name: mode === "text" ? /text response/i : /tool response/i })
    .click();
}
