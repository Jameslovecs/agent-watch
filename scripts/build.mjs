import { cpSync, rmSync, mkdirSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("web", "dist", { recursive: true });
console.log("Built static dashboard in dist/");
