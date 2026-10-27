import type { CardInput, Deck, ImportResponse, Schedule, Settings, Side, StateResponse } from "../api/_contract";

const KEY_STORAGE = "kotoba-key";

export function readKey(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get("key");
    if (fromUrl) {
      localStorage.setItem(KEY_STORAGE, fromUrl);
      history.replaceState(null, "", location.pathname);
    }
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch { return ""; }
}

export function writeKey(key: string) {
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* private mode */ }
}

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "x-kotoba-key": readKey(), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.json().then((json: { error?: string }) => json.error, () => undefined);
    throw new Error(detail ?? `${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const deckPath = (deck: string) => `/api/decks/${encodeURIComponent(deck)}`;
type DeckPatch = Partial<Pick<Deck, "title" | "description" | "enabled" | "production" | "introduce">>;

export const api = {
  state: () => call<StateResponse>("GET", "/api/state"),
  review: (card: string, side: Side, schedule: Schedule) => call<{ ok: true }>("POST", "/api/review", { card, side, schedule }),
  settings: (settings: Partial<Settings>) => call<{ settings: Settings }>("POST", "/api/settings", settings),
  putDeck: (deck: string, patch: DeckPatch) => call<Deck>("PUT", deckPath(deck), patch),
  deleteDeck: (deck: string) => call<{ deleted: string }>("DELETE", deckPath(deck)),
  resetDeck: (deck: string) => call<{ reset: string }>("POST", `${deckPath(deck)}/reset`),
  addCards: (deck: string, cards: CardInput[]) => call<ImportResponse>("POST", `${deckPath(deck)}/cards`, { cards }),
  removeCards: (deck: string, sources: string[]) => call<{ removed: string[] }>("DELETE", `${deckPath(deck)}/cards`, { sources }),
};
