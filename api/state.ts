import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { StateResponse } from "./_contract.js";
import { admit } from "./_http.js";
import { library, load, progress } from "./_store.js";

// Everything the app needs at start: settings, decks, cards and progress.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!admit(request, response, ["GET"])) return;
  const [{ data: stored }, { data: schedules }] = await Promise.all([load(library), load(progress)]);
  const state: StateResponse = { settings: stored.settings, decks: Object.values(stored.decks), cards: Object.values(stored.cards), progress: schedules.cards };
  response.json(state);
}
