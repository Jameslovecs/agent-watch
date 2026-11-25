import fs from "node:fs";
import { verify } from "../server/core.mjs";
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/verify-audit.mjs /path/to/export.json");
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.mode === "demo") {
  console.error("Demo exports are not hash-linked.");
  process.exit(2);
}
if (!Array.isArray(data.events) || !verify(data.events)) {
  console.error("Audit verification failed.");
  process.exit(1);
}
console.log(
  `Verified ${data.events.length} events. Final checkpoint: ${data.events.at(-1)?.hash || "genesis"}`,
);
