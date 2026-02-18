// chit-dumps/print-active.js
import { pathToFileURL } from "url";
import { readRepoStateSync } from "./changelog.js";

const ROOT = process.cwd();

export function printActive() {
  const state = readRepoStateSync(ROOT);
  if (!state.active) {
    console.log("No active dump.");
    return;
  }
  console.log("Active dump:", state.active);
  console.log("History:", Array.isArray(state.history) ? state.history.length : 0, "entries");
}

const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_MAIN) printActive();
