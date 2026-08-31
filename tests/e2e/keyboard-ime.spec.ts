import { expect, openCockpit, selectResponseMode, test } from "./cockpit.fixture";

test.describe("keyboard and composition input", () => {
  test("does not submit while an IME composition is active", async ({ page, sessionId }) => {
    await openCockpit(page, sessionId, "right");
    await selectResponseMode(page, "text");
    const editor = page.getByRole("textbox", { name: /model response/i });
    await editor.focus();
    await editor.dispatchEvent("compositionstart", { data: "" });
    await editor.fill("実装を確認します");
    await editor.press("Control+Enter");
    await expect(page.getByRole("button", { name: /submit response/i })).not.toContainText(
      /transmitted/i,
    );

    await editor.dispatchEvent("compositionend", { data: "実装を確認します" });
    await editor.press("Control+Enter");
    await expect(page.getByRole("button", { name: /submit response/i })).toContainText(
      /transmitted/i,
    );
  });

  test("offers a complete keyboard path between seats and the response editor", async ({
    page,
    sessionId,
  }) => {
    await openCockpit(page, sessionId, "left");
    await page.getByRole("link", { name: /model.*right seat/i }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/model(?:\?|$)/);
    const editor = page.getByRole("textbox", { name: /tool arguments/i });
    for (
      let step = 0;
      step < 12 && !(await editor.evaluate((element) => element === document.activeElement));
      step += 1
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(editor).toBeFocused();
  });
});
