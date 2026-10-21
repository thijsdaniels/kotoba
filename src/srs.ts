// FSRS-4.5 with the default parameters, target retention 90%.
export const DAY = 86400000;

export interface Schedule {
  reps: number;
  lapses: number;
  first?: string; // the day the card was introduced, yyyy-m-d with the day rolling at 4:00
  last?: number;
  S?: number; // stability in days
  D?: number; // difficulty 1..10
  ivl: number; // interval in days, 0 while still in the learning steps
  due: number;
}

export type Grade = 0 | 1 | 2 | 3; // Forgot, Barely, Got It, Instant → FSRS grades 1..4

const WEIGHTS = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const RETENTION = 0.9;
const DECAY = -0.5;
const FACTOR = 19 / 81;

const clampDifficulty = (difficulty: number) => Math.min(10, Math.max(1, difficulty));
export const retrievability = (daysElapsed: number, stability: number) => Math.pow(1 + FACTOR * daysElapsed / stability, DECAY);
const intervalFor = (stability: number) => Math.max(1, Math.round(stability / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1)));

// Days roll over at 4:00 so a late-night session still counts as the same day.
export function dayOf(time = Date.now()): string {
  const shifted = new Date(time - 4 * 3600000);
  return `${shifted.getFullYear()}-${shifted.getMonth() + 1}-${shifted.getDate()}`;
}

export function schedule(previous: Schedule | null, grade: Grade, now = Date.now()): Schedule {
  const fsrsGrade = grade + 1;
  const before: Schedule = { reps: 0, lapses: 0, ivl: 0, due: 0, ...(previous ?? {}) };
  const next: Schedule = { ...before, reps: before.reps + 1, last: now, first: before.first ?? dayOf(now) };
  const inDays = (days: number) => { const morning = new Date(now); morning.setHours(4, 0, 0, 0); return morning.getTime() + days * DAY; };
  const stability = before.S;
  const difficulty = before.D ?? 5;
  if (stability == null) {
    next.S = WEIGHTS[fsrsGrade - 1];
    next.D = clampDifficulty(WEIGHTS[4] - (fsrsGrade - 3) * WEIGHTS[5]);
  } else {
    const daysElapsed = Math.max(0, (now - (before.last ?? now)) / DAY);
    const recall = retrievability(daysElapsed, stability);
    const meanDifficulty = WEIGHTS[4] - WEIGHTS[5];
    next.D = clampDifficulty(WEIGHTS[7] * meanDifficulty + (1 - WEIGHTS[7]) * (difficulty - WEIGHTS[6] * (fsrsGrade - 3)));
    if (fsrsGrade === 1) {
      next.S = WEIGHTS[11] * Math.pow(difficulty, -WEIGHTS[12]) * (Math.pow(stability + 1, WEIGHTS[13]) - 1) * Math.exp(WEIGHTS[14] * (1 - recall));
    } else {
      next.S = stability * (Math.exp(WEIGHTS[8]) * (11 - difficulty) * Math.pow(stability, -WEIGHTS[9]) * (Math.exp(WEIGHTS[10] * (1 - recall)) - 1)
        * (fsrsGrade === 2 ? WEIGHTS[15] : 1) * (fsrsGrade === 4 ? WEIGHTS[16] : 1) + 1);
    }
  }
  next.S = Math.round(next.S * 1000) / 1000;
  // learning steps inside the session, then FSRS intervals
  if (fsrsGrade === 1) { next.lapses = before.lapses + 1; next.ivl = 0; next.due = now + 60000; }
  else if (fsrsGrade === 2 && stability == null) { next.ivl = 0; next.due = now + 6 * 60000; }
  else { next.ivl = intervalFor(next.S); next.due = inDays(next.ivl); }
  return next;
}

// How likely the card is still remembered right now; 0 for unseen cards.
export function currentRecall(state: Schedule | null, now = Date.now()): number {
  if (!state || state.S == null) return 0;
  return retrievability(Math.max(0, (now - (state.last ?? now)) / DAY), state.S);
}

export function formatInterval(milliseconds: number): string {
  const minutes = milliseconds / 60000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 20) return `${Math.round(hours)}h`;
  const days = milliseconds / DAY;
  if (days < 1.5) return "1d";
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
