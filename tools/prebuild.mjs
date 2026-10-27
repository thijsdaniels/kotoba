// Stamp the service worker so every deploy gets its own cache.
import { readFileSync, writeFileSync } from "node:fs";
const stamp = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? String(Date.now());
writeFileSync("public/sw.js", readFileSync("public/sw.template.js", "utf8").replace("__BUILD__", stamp));
console.log(`service worker build ${stamp}`);
