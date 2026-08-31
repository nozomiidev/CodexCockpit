/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CODEX_COCKPIT_TRANSPORT?: "demo" | "companion";
  readonly VITE_CODEX_COCKPIT_COMPANION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
