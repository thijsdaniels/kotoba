import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorized } from "./_auth.js";
import { update } from "./_store.js";

// Body: { newPerDay?, stage? }
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!authorized(request, response)) return;
  if (request.method !== "POST") return response.status(405).end();
  const { newPerDay, stage } = request.body ?? {};
  const state = await update(current => {
    if (typeof newPerDay === "number") current.settings.newPerDay = Math.max(0, Math.min(100, Math.round(newPerDay)));
    if (typeof stage === "string") current.settings.stage = stage;
  });
  response.json({ version: state.version, settings: state.settings });
}
