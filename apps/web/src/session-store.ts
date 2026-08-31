import { create } from "zustand";
import type { Lens, ResponseDraft, SessionSnapshot } from "./domain";
import { type CockpitTransport, createCockpitTransport } from "./transport";

interface SessionStore {
  snapshot: SessionSnapshot | undefined;
  lens: Lens;
  transport: CockpitTransport | undefined;
  error: string | undefined;
  connect: (sessionId: string, search: URLSearchParams) => Promise<void>;
  setLens: (lens: Lens) => void;
  setDraft: (draft: ResponseDraft) => void;
  submit: () => Promise<void>;
  submitPrompt: (prompt: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  snapshot: undefined,
  transport: undefined,
  error: undefined,
  lens: "structured",
  async connect(sessionId, search) {
    get().transport?.dispose();
    const transport = createCockpitTransport(search);
    set({ transport, snapshot: undefined, error: undefined });
    transport.subscribe((snapshot) => set({ snapshot }));
    const controller = new AbortController();
    try {
      const snapshot = await transport.connect(sessionId, controller.signal);
      if (get().transport === transport) set({ snapshot });
    } catch (error) {
      if (get().transport === transport)
        set({ error: error instanceof Error ? error.message : "Connection failed" });
    }
  },
  setLens(lens) {
    set({ lens });
  },
  setDraft(draft) {
    const { snapshot, transport } = get();
    if (!snapshot || snapshot.requestState === "submitted") return;
    const updated = { ...snapshot, draft, requestState: "drafting" as const };
    set({ snapshot: updated });
    transport?.update(updated);
  },
  async submit() {
    const { snapshot, transport } = get();
    if (!snapshot || !transport) return;
    const controller = new AbortController();
    try {
      set({ snapshot: await transport.submit(snapshot, controller.signal), error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Submission failed" });
    }
  },
  async submitPrompt(prompt) {
    const { transport } = get();
    if (!transport) return;
    const controller = new AbortController();
    try {
      set({ snapshot: await transport.submitPrompt(prompt, controller.signal), error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Prompt submission failed" });
    }
  },
}));
