import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Explorer } from "./explorer";

afterEach(cleanup);

describe("workspace explorer", () => {
  it("opens from the rail, selects a file, and restores focus on close", () => {
    render(<Explorer />);
    const toggle = screen.getByTestId("explorer-toggle");
    expect(screen.queryByTestId("explorer-panel")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByTestId("explorer-panel")).toBeTruthy();
    const files = screen.getAllByTestId("explorer-file");
    const readme = files.find((file) => file.textContent?.includes("README.md"));
    if (!readme) throw new Error("README.md is missing from the explorer");
    fireEvent.click(readme);
    expect(screen.getByTestId("explorer-active-file").textContent).toContain("README.md");

    const closeButton = screen.getByTestId("explorer-panel").querySelector(".explorer-close");
    if (!closeButton) throw new Error("explorer close button is missing");
    fireEvent.click(closeButton);
    expect(screen.queryByTestId("explorer-panel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("explorer-toggle"));
  });

  it("supports roving tree focus and expands folders with ArrowRight", () => {
    render(<Explorer />);
    fireEvent.click(screen.getByTestId("explorer-toggle"));
    const root = screen
      .getAllByTestId("explorer-directory")
      .find((item) => item.textContent?.includes("cockpit-lab"));
    if (!root) throw new Error("workspace root is missing");
    root.focus();
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toContain("docs");
    fireEvent.keyDown(document.activeElement ?? root, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("src");
  });
});
