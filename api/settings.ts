import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorized } from "./_auth.js";
import { update } from "./_store.js";

const PRODUCIBLE = new Set(["word", "form", "ending", "pokemon", "move", "item", "term"]);

// Body: { newPerDay?, stage?, produce?, playerName?, rivalName? }
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!authorized(request, response)) return;
  if (request.method !== "POST") return response.status(405).end();
  const { newPerDay, stage, produce, playerName, rivalName } = request.body ?? {};
  const state = await update(current => {
    if (typeof newPerDay === "number") current.settings.newPerDay = Math.max(0, Math.min(100, Math.round(newPerDay)));
    if (typeof stage === "string") current.settings.stage = stage;
    if (Array.isArray(produce)) current.settings.produce = produce.filter((kind): kind is string => PRODUCIBLE.has(kind));
    if (typeof playerName === "string") current.settings.playerName = playerName.slice(0, 10);
    if (typeof rivalName === "string") current.settings.rivalName = rivalName.slice(0, 10);
  });
  response.json({ version: state.version, settings: state.settings });
}
