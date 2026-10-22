// The built deck and the stage list are static assets of the app; copy them in before every build.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("deck/cards.json", "public/cards.json");
const stages = JSON.parse(readFileSync("corpus/stages.json", "utf8")).stages.map(stage => ({ id: stage.id, name: stage.name }));
writeFileSync("public/stages.json", JSON.stringify(stages));
// stamp the service worker so every deploy gets its own cache
const stamp = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? String(Date.now());
writeFileSync("public/sw.js", readFileSync("public/sw.template.js", "utf8").replace("__BUILD__", stamp));
console.log(`copied the deck and ${stages.length} stages into public/, service worker build ${stamp}`);
