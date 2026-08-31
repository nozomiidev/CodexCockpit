import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import type { CockpitTransport, TerminalConnection } from "./transport";

interface TerminalViewProps {
  readonly transport: CockpitTransport;
}

export default function TerminalView({ transport }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const connection = useRef<TerminalConnection | undefined>(undefined);

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
      fontSize: 12,
      theme: {
        background: "#08100e",
        foreground: "#b8cbc2",
        cursor: "#6ef5bd",
        selectionBackground: "#214438",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    fit.fit();
    const session = transport.openTerminal(
      (data) => terminal.write(data),
      (status) => {
        terminal.options.disableStdin = status === "closed" || status === "error";
      },
    );
    connection.current = session;
    const input = terminal.onData((data) => session.write(data));
    const resize = new ResizeObserver(() => {
      fit.fit();
      session.resize(terminal.cols, terminal.rows);
    });
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      input.dispose();
      session.dispose();
      terminal.dispose();
      connection.current = undefined;
    };
  }, [transport]);

  return <section className="xterm-host" ref={host} aria-label="Interactive terminal" />;
}
