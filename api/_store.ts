// Where the learner's state lives: scheduling per card and the settings.
//
// Vercel Blob, with one immutable snapshot per write. Overwritten blobs are served
// from a cache for up to a minute, which would make read-modify-write lose answers,
// so every save is a new file named by a counter and the newest one is found by
// listing, which is never cached. Old snapshots are pruned as we go.
import { list, put, del } from "@vercel/blob";

export type Side = "r" | "p";
export type Schedule = Record<string, unknown>;
export type CardState = Partial<Record<Side, Schedule>>;
export interface State {
  version: number;
  settings: { newPerDay: number; stage: string; produce: string[]; playerName?: string; rivalName?: string };
  srs: Record<string, CardState>;
}

const PREFIX = "kotoba/state/";
const KEEP = 5;
const DEFAULTS: State = { version: 0, settings: { newPerDay: 12, stage: "viridian", produce: ["word"] }, srs: {} };

function nameOf(version: number) {
  return `${PREFIX}${String(version).padStart(9, "0")}.json`;
}

async function snapshots() {
  const found = await list({ prefix: PREFIX, limit: 1000 });
  return found.blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)); // newest first
}

export async function load(): Promise<State> {
  const all = await snapshots();
  if (!all.length) return structuredClone(DEFAULTS);
  const response = await fetch(all[0].url, { cache: "no-store" });
  if (!response.ok) throw new Error(`could not read state: ${response.status}`);
  const stored = (await response.json()) as State;
  return { ...stored, settings: { ...DEFAULTS.settings, ...stored.settings } }; // a setting added since the snapshot was written gets its default
}

export async function save(state: State): Promise<State> {
  const next: State = { ...state, version: state.version + 1 };
  await put(nameOf(next.version), JSON.stringify(next), { access: "public", addRandomSuffix: false, contentType: "application/json" });
  const all = await snapshots();
  const stale = all.slice(KEEP).map(blob => blob.url);
  if (stale.length) await del(stale);
  return next;
}

export async function update(change: (state: State) => void): Promise<State> {
  const state = await load();
  change(state);
  return save(state);
}
