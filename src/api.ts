import type { Schedule } from "./srs";

export type Side = "r" | "p";
export interface Settings { newPerDay: number; stage: string; produce: string[]; playerName?: string; rivalName?: string }
export interface State { version: number; settings: Settings; srs: Record<string, Partial<Record<Side, Schedule>>> }

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

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-kotoba-key": readKey(), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  state: () => call<State>("/api/state"),
  answer: (id: string, side: Side, schedule: Schedule) => call<{ version: number }>("/api/answer", { id, side, schedule }),
  settings: (patch: Partial<Settings>) => call<{ version: number; settings: Settings }>("/api/settings", patch),
};
