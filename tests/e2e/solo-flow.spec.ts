import { expect, openCockpit, selectResponseMode, test } from "./cockpit.fixture";

test.describe("solo learning loop", () => {
  test("inspects a model request and submits a valid text response", async ({
    page,
    sessionId,
  }) => {
    await openCockpit(page, sessionId, "right");

    await expect(page.getByRole("region", { name: /pending request/i })).toContainText(/gpt-5\.5/i);
    await selectResponseMode(page, "text");
    await page
      .getByRole("textbox", { name: /model response/i })
      .fill("READMEを確認して、最初の未完了項目から着手します。");

    await expect(page.getByTestId("validation-errors")).toContainText(/contract valid/i);
    const submit = page.getByRole("button", { name: /submit response/i });
    await submit.click();

    await expect(submit).toBeDisabled();
    await expect(submit).toContainText(/transmitted/i);
    await expect(page.getByRole("textbox", { name: /model response/i })).toBeDisabled();
  });

  test("blocks malformed tool arguments and accepts a valid offered tool", async ({
    page,
    sessionId,
  }) => {
    await openCockpit(page, sessionId, "right");
    await selectResponseMode(page, "tool");
    await page.getByRole("combobox", { name: /tool/i }).selectOption("shell");
    await page.getByRole("textbox", { name: /tool arguments/i }).fill("{not-json");

    await expect(page.getByTestId("validation-errors")).toContainText(/JSON/i);
    await expect(page.getByRole("button", { name: /submit response/i })).toBeDisabled();

    await page.getByRole("textbox", { name: /tool arguments/i }).fill("{}");
    await expect(page.getByTestId("validation-errors")).toContainText(/command|required|必須/i);
    await expect(page.getByRole("button", { name: /submit response/i })).toBeDisabled();

    await page.getByRole("textbox", { name: /tool arguments/i }).fill('{"command":"pwd"}');
    await expect(page.getByTestId("validation-errors")).toContainText(/contract valid/i);
    await expect(page.getByRole("button", { name: /submit response/i })).toBeEnabled();
    await page.getByRole("button", { name: /submit response/i }).click();
    await expect(page.getByRole("button", { name: /submit response/i })).toContainText(
      /transmitted/i,
    );
    await expect(page.getByRole("textbox", { name: /tool arguments/i })).toBeDisabled();
  });
});
