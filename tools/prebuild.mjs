// The built packages are static assets of the app; build them before every app build, and
// stamp the service worker so every deploy gets its own cache.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
execFileSync("python3", ["tools/build_packages.py"], { stdio: "inherit" });
const stamp = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? String(Date.now());
writeFileSync("public/sw.js", readFileSync("public/sw.template.js", "utf8").replace("__BUILD__", stamp));
console.log(`service worker build ${stamp}`);
