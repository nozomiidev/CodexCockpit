import { expect, openCockpit, test } from "./cockpit.fixture";

/**
 * The Explorer is intentionally exercised through semantic roles and the
 * small `data-testid` contract documented by the web app. This keeps the
 * acceptance suite independent from the visual treatment of the workbench.
 */
function explorer(page: import("@playwright/test").Page) {
  return page.getByTestId("explorer-panel");
}

function explorerToggle(page: import("@playwright/test").Page) {
  return page.getByTestId("explorer-toggle");
}

test.describe("left-seat workspace explorer", () => {
  test("opens from the far-left ribbon and exposes the seeded workspace", async ({
    page,
    sessionId,
  }) => {
    await openCockpit(page, sessionId, "left");

    // The control mirrors RealtimeMarkdownEditor's stable ribbon affordance.
    await expect(explorerToggle(page)).toHaveAttribute("title", /file explorer/i);
    await expect(explorerToggle(page)).toHaveAttribute("aria-expanded", "false");
    await explorerToggle(page).click();

    await expect(explorer(page)).toBeVisible();
    await expect(explorerToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(explorer(page).getByRole("tree")).toBeVisible();
    await expect(explorer(page).getByRole("treeitem", { name: /README\.md/i })).toBeVisible();
    await expect(explorer(page).getByRole("treeitem", { name: /package\.json/i })).toBeVisible();
  });

  test("expands a directory and selects a file without leaving the terminal seat", async ({
    page,
    sessionId,
  }) => {
    await openCockpit(page, sessionId, "left");
    await explorerToggle(page).click();

    const tree = explorer(page).getByRole("tree");
    const sourceDirectory = tree.getByRole("treeitem", { name: /^src$/i });
    await expect(sourceDirectory).toBeVisible();
    await expect(sourceDirectory).toHaveAttribute("aria-expanded", "false");
    await sourceDirectory.click();
    await expect(sourceDirectory).toHaveAttribute("aria-expanded", "true");

    const file = tree.getByRole("treeitem", { name: /index\.(ts|tsx|js)$/i });
    await expect(file).toBeVisible();
    await file.click();
    await expect(file).toHaveAttribute("aria-selected", "true");
    await expect(file).toContainText(/index\.(ts|tsx|js)/i);

    // Selection is an explorer concern; the left prompt and right-hand seat
    // navigation remain available after the tree changes.
    await expect(page.getByRole("textbox", { name: /codex prompt/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /model.*right seat/i })).toBeVisible();
  });

  test("supports tree keyboard navigation and activation", async ({ page, sessionId }) => {
    await openCockpit(page, sessionId, "left");
    await explorerToggle(page).click();

    const tree = explorer(page).getByRole("tree");
    await tree.focus();
    await expect(tree).toBeFocused();
    await tree.press("Home");
    await tree.press("ArrowDown");
    await tree.press("Enter");

    await expect(tree.locator('[aria-selected="true"]')).toHaveCount(1);
    await expect(page.getByTestId("explorer-file")).toBeVisible();
  });

  test("remains usable on mobile and closes with Escape", async ({ page, sessionId }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCockpit(page, sessionId, "left");
    await expect(explorerToggle(page)).toBeVisible();
    await explorerToggle(page).click();
    await expect(explorer(page)).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

    await page.keyboard.press("Escape");
    await expect(explorer(page)).toBeHidden();
    await expect(page.getByRole("textbox", { name: /codex prompt/i })).toBeVisible();
  });

  test("keeps the left prompt-to-right pending-request loop intact", async ({
    browser,
    sessionId,
  }) => {
    const context = await browser.newContext();
    const left = await context.newPage();
    const right = await context.newPage();

    try {
      await Promise.all([
        openCockpit(left, sessionId, "left"),
        openCockpit(right, sessionId, "right"),
      ]);
      await explorerToggle(left).click();
      await expect(explorer(left)).toBeVisible();

      const prompt = "Open the selected workspace file and explain its purpose.";
      await left.getByRole("textbox", { name: /codex prompt/i }).fill(prompt);
      await left.getByRole("button", { name: /send prompt/i }).click();
      await expect(right.getByRole("region", { name: /pending request/i })).toContainText(prompt);
    } finally {
      await context.close();
    }
  });
});
