// Local-first progress store. Every attempt is kept so the parent report can tell
// independent answers from answers after a hint, as the platform spec requires.

export interface Attempt {
  child: string;
  activity: string;
  stage: string;
  item: string;
  answer: string;
  correct: boolean;
  /** 0 = no help, 1 = audio replayed, 2 = correct gate highlighted */
  help: number;
  tries: number;
  ms: number;
  at: string;
  contentVersion: string;
}

export interface StageResult {
  completed: boolean;
  firstTry: number;
  rounds: number;
  bestFirstTry: number;
}

const KEY = 'rehla.v1';
const CONTENT_VERSION = 'race-0.1';

interface Store {
  attempts: Attempt[];
  stages: Record<string, Record<string, StageResult>>;
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* storage unavailable: play still works, progress is not kept */
  }
  return { attempts: [], stages: {} };
}

const store = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function logAttempt(a: Omit<Attempt, 'at' | 'contentVersion'>) {
  store.attempts.push({ ...a, at: new Date().toISOString(), contentVersion: CONTENT_VERSION });
  persist();
}

export function saveStage(child: string, stage: string, firstTry: number, rounds: number) {
  const byChild = (store.stages[child] ??= {});
  const prev = byChild[stage];
  byChild[stage] = {
    completed: true,
    firstTry,
    rounds,
    bestFirstTry: Math.max(firstTry, prev?.bestFirstTry ?? 0),
  };
  persist();
}

export function stageResult(child: string, stage: string): StageResult | undefined {
  return store.stages[child]?.[stage];
}

/** Haraka pairs the child confused, most frequent first (for the parent report). */
export function confusions(child: string) {
  const counts = new Map<string, number>();
  for (const a of store.attempts) {
    if (a.child !== child || a.correct) continue;
    const k = `${a.item} ← ${a.answer}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
