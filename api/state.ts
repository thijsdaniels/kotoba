import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorized } from "./_auth.js";
import { load } from "./_store.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!authorized(request, response)) return;
  if (request.method !== "GET") return response.status(405).end();
  response.setHeader("Cache-Control", "no-store");
  response.json(await load());
}
