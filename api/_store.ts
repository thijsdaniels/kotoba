// Where everything lives: two series of snapshots in Vercel Blob, the library (settings, decks, cards)
// and the progress (schedules), so an answer never rewrites the cards.
//
// Every save is a new, immutable file named by a counter; the newest is found by listing, which is never cached.
// Writing a name that already exists fails, so two writers that loaded the same version can't both win:
// the loser reloads, applies its change again and writes the next number. Old snapshots are pruned as we go.
import { list, put, del } from "@vercel/blob";
import type { Library, Progress } from "./_contract.js";

interface Series<T> { prefix: string; empty: () => T }

export const library: Series<Library> = {
  prefix: "kotoba/v3/library/",
  empty: () => ({ settings: { newPerDay: 20 }, decks: {}, cards: {} }),
};
export const progress: Series<Progress> = {
  prefix: "kotoba/v3/progress/",
  empty: () => ({ cards: {} }),
};

const KEEP = 5;
// A snapshot is pruned only once it is a minute old, so its name can never be written again by a writer
// that loaded before it; no request lives that long.
const PRUNE_AFTER = 60_000;
const ATTEMPTS = 10;

const nameOf = (series: Series<unknown>, version: number) => `${series.prefix}${String(version).padStart(9, "0")}.json`;
const versionOf = (pathname: string) => Number(pathname.slice(pathname.lastIndexOf("/") + 1, -".json".length));

async function snapshots(series: Series<unknown>) {
  const found = await list({ prefix: series.prefix, limit: 1000 });
  return found.blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)); // newest first
}

export async function load<T>(series: Series<T>): Promise<{ version: number; data: T }> {
  const [newest] = await snapshots(series);
  if (!newest) return { version: 0, data: series.empty() };
  const response = await fetch(newest.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`could not read ${newest.pathname}: ${response.status}`);
  return { version: versionOf(newest.pathname), data: { ...series.empty(), ...(await response.json()) } };
}

// Applies a change to the newest snapshot and saves it as the next one. `change` may run more than once,
// when another write got in first, so it must only depend on the data it is given.
export async function update<T, R>(series: Series<T>, change: (data: T) => R): Promise<R> {
  for (let attempt = 1; ; attempt++) {
    const { version, data } = await load(series);
    const result = change(data);
    const name = nameOf(series, version + 1);
    try {
      await put(name, JSON.stringify(data), { access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
    } catch (error) {
      const taken = (await snapshots(series)).some(blob => blob.pathname === name);
      if (taken && attempt < ATTEMPTS) continue;
      throw error;
    }
    const stale = (await snapshots(series)).slice(KEEP).filter(blob => Date.now() - new Date(blob.uploadedAt).getTime() > PRUNE_AFTER).map(blob => blob.url);
    if (stale.length) await del(stale);
    return result;
  }
}
