import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("apps/web/dist");
const destination = resolve("dist");
const entrypoint = resolve(source, "index.html");

if (!existsSync(entrypoint)) {
  throw new Error(`Web build output is missing: ${entrypoint}`);
}

// The root dist directory is an ignored, generated staging area for Sites.
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true, dereference: false });

process.stdout.write(`Staged static site build at ${destination}\n`);
