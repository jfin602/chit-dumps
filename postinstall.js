#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const pkgPath = path.join(__dirname, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const version = pkg.version || "unknown";

  console.log(
    `Thanks for downloading chit-dumps v${version}. ` +
    `You're almost ready to roll, refer to: ` +
    `https://github.com/jfin602/chit-dumps for the final installation steps.`
  );
} catch (err) {
  console.log(
    "Thanks for downloading chit-dumps. " +
    "Refer to: https://github.com/jfin602/chit-dumps"
  );
}
