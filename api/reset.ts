import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorized } from "./_auth.js";
import { update } from "./_store.js";

// Wipes all scheduling state; settings stay. Body: { confirm: "reset" }
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!authorized(request, response)) return;
  if (request.method !== "POST" || request.body?.confirm !== "reset") return response.status(400).json({ error: "send { confirm: 'reset' }" });
  const state = await update(current => { current.srs = {}; });
  response.json({ version: state.version });
}
