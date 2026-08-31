import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { Cockpit } from "./cockpit";
import type { Seat } from "./domain";
import { useSessionStore } from "./session-store";

function SessionRoute({ seat, dual = false }: { readonly seat?: Seat; readonly dual?: boolean }) {
  const { id = "demo-flight" } = useParams();
  const [search] = useSearchParams();
  const role = search.get("role");
  const searchValue = search.toString();
  const resolvedSeat = seat ?? (role === "right" ? "model" : "terminal");
  const connect = useSessionStore((state) => state.connect);

  useEffect(() => {
    void connect(id, new URLSearchParams(searchValue));
  }, [connect, id, searchValue]);

  return <Cockpit sessionId={id} seat={resolvedSeat} dual={dual} />;
}

function QueryAlias() {
  const [search] = useSearchParams();
  const source = search.toString() ? search : new URLSearchParams(window.location.search);
  const session = source.get("session") ?? "demo-flight";
  const role = source.get("role") === "right" ? "model" : "terminal";
  const suffix = source.toString() ? `?${source.toString()}` : "";
  return <Navigate replace to={`/sessions/${encodeURIComponent(session)}/${role}${suffix}`} />;
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<QueryAlias />} />
        <Route path="/sessions/:id/terminal" element={<SessionRoute seat="terminal" />} />
        <Route path="/sessions/:id/model" element={<SessionRoute seat="model" />} />
        <Route path="/sessions/:id/solo" element={<SessionRoute dual />} />
        <Route path="/sessions/:id/dev/dual" element={<SessionRoute dual />} />
        <Route path="*" element={<Navigate replace to="/sessions/demo-flight/solo" />} />
      </Routes>
    </HashRouter>
  );
}
