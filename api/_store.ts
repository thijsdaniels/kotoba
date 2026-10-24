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
// Per package: whether it is in play, the position in its chapters (absent means the latest,
// so everything is open), and the values of the settings its manifest declares.
export interface PackageSettings { enabled?: boolean; position?: string; values?: Record<string, string | number> }
export interface Settings { newPerDay: number; produce: string[]; packages: Record<string, PackageSettings> }
export interface State {
  format: number; // the shape of this file; load() upgrades older snapshots
  version: number;
  settings: Settings;
  srs: Record<string, CardState>;
}

const PREFIX = "kotoba/state/";
const KEEP = 5;
const FORMAT = 2;
const DEFAULTS: State = { format: FORMAT, version: 0, settings: { newPerDay: 20, produce: ["word"], packages: {} }, srs: {} };

// Format 1 had one implicit package: the stage, the player and rival names and the card ids
// all belonged to Pokémon Green, and the kana cards were mixed in with ids k-hira-*, k-kata-*.
function upgrade(stored: Record<string, any>): State {
  if (stored.format === FORMAT) return stored as State;
  const old = stored.settings ?? {};
  const srs: Record<string, CardState> = {};
  for (const [id, entry] of Object.entries(stored.srs ?? {})) {
    const match = /^k-(hira|kata)-(.+)$/.exec(id);
    srs[match ? `kana/${match[1]}-${match[2]}` : `pokemon-green/${id}`] = entry as CardState;
  }
  const values: Record<string, string> = {};
  if (old.playerName) values.player = old.playerName;
  if (old.rivalName) values.rival = old.rivalName;
  const game: PackageSettings = { position: old.stage ?? "viridian", ...(Object.keys(values).length ? { values } : {}) };
  return { format: FORMAT, version: stored.version ?? 0, settings: { newPerDay: old.newPerDay ?? 12, produce: old.produce ?? ["word"], packages: { "pokemon-green": game } }, srs };
}

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
  const stored = upgrade(await response.json());
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
