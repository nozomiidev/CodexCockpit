import { expect, openCockpit, selectResponseMode, test } from "./cockpit.fixture";

test("left and right windows observe one authoritative session", async ({ browser, sessionId }) => {
  const context = await browser.newContext();
  const left = await context.newPage();
  const right = await context.newPage();

  try {
    await Promise.all([
      openCockpit(left, sessionId, "left"),
      openCockpit(right, sessionId, "right"),
    ]);
    await expect(right.getByRole("region", { name: /pending request/i })).toContainText(
      "req_0198f3c7",
    );

    const prompt = "Inspect package.json and report the package name.";
    await left.getByRole("textbox", { name: /codex prompt/i }).fill(prompt);
    await left.getByRole("button", { name: /send prompt/i }).click();
    await expect(right.getByRole("region", { name: /pending request/i })).toContainText(prompt);

    await selectResponseMode(right, "text");
    await right.getByRole("textbox", { name: /model response/i }).fill("Shared-session response");
    await right.getByRole("button", { name: /submit response/i }).click();

    await expect(right.getByRole("button", { name: /submit response/i })).toContainText(
      /transmitted/i,
    );
    await expect(left.getByRole("log", { name: /activity log/i })).toContainText(
      "Shared-session response",
    );
  } finally {
    await context.close();
  }
});
