import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorized } from "./_auth.js";
import { update, type PackageSettings } from "./_store.js";

const PRODUCIBLE = new Set(["word", "form", "ending", "pokemon", "move", "item", "term"]);
const VALUE_LENGTH = 40;

// Body: { newPerDay?, produce?, packages?: { <id>: { enabled?, position?, values? } } }
// A package entry is merged into what is stored for that package; values are merged key by key.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!authorized(request, response)) return;
  if (request.method !== "POST") return response.status(405).end();
  const { newPerDay, produce, packages } = request.body ?? {};
  const state = await update(current => {
    if (typeof newPerDay === "number") current.settings.newPerDay = Math.max(0, Math.min(100, Math.round(newPerDay)));
    if (Array.isArray(produce)) current.settings.produce = produce.filter((kind): kind is string => PRODUCIBLE.has(kind));
    if (packages && typeof packages === "object") {
      for (const [id, patch] of Object.entries(packages as Record<string, PackageSettings>)) {
        if (!/^[a-z0-9-]{1,40}$/.test(id) || !patch || typeof patch !== "object") continue;
        const stored: PackageSettings = current.settings.packages[id] ?? {};
        if (typeof patch.enabled === "boolean") stored.enabled = patch.enabled;
        if (typeof patch.position === "string") stored.position = patch.position.slice(0, VALUE_LENGTH);
        if (patch.values && typeof patch.values === "object") {
          stored.values = { ...(stored.values ?? {}) };
          for (const [key, value] of Object.entries(patch.values)) {
            if (typeof value === "string") stored.values[key] = value.slice(0, VALUE_LENGTH);
            else if (typeof value === "number" && isFinite(value)) stored.values[key] = value;
          }
        }
        current.settings.packages[id] = stored;
      }
    }
  });
  response.json({ version: state.version, settings: state.settings });
}
