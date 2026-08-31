import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./app";

vi.mock("./terminal-view", () => ({
  default: () => <section aria-label="Interactive terminal" />,
}));

describe("cockpit demo", () => {
  it("renders both seats and submits a valid assisted response", async () => {
    history.replaceState({}, "", "/#/sessions/test/solo");
    render(<App />);
    expect(await screen.findByTestId("terminal")).toBeTruthy();
    expect(screen.getByTestId("pending-request")).toBeTruthy();
    expect(screen.getByTestId("validation-errors").textContent).toContain("Contract valid");
    fireEvent.click(screen.getByTestId("response-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("response-submit").textContent).toContain("TRANSMITTED"),
    );
  });
});
