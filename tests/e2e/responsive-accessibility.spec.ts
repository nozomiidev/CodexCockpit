import AxeBuilder from "@axe-core/playwright";
import { expect, openCockpit, test } from "./cockpit.fixture";

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`${viewport.name} layout has no horizontal document overflow`, async ({
    page,
    sessionId,
  }) => {
    await page.setViewportSize(viewport);
    await openCockpit(page, sessionId, "right");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    await expect(page.getByRole("button", { name: /submit response/i })).toBeVisible();
  });
}

test("primary cockpit has no automatically detectable WCAG A/AA violations", async ({
  page,
  sessionId,
}) => {
  await openCockpit(page, sessionId, "right");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("reduced motion disables non-essential transitions and animations", async ({
  page,
  sessionId,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openCockpit(page, sessionId, "right");
  const animatedElements = await page.locator("*").evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const style = getComputedStyle(element);
        return (
          Number.parseFloat(style.animationDuration) > 0.01 ||
          Number.parseFloat(style.transitionDuration) > 0.01
        );
      }).length,
  );
  expect(animatedElements).toBe(0);
});
