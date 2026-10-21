// Content for «مصنع الكلمات». Words come from the shared bank in arabic.ts; letters on the tiles and
// the word in the machine are always rendered as text, never baked into images.

import { LETTER, LETTERS, LOOKALIKES, WORDS, letterNameAudio, wordAudio } from './arabic';

export type FactoryMode = 'model' | 'missing' | 'build' | 'build-hard';

export interface FactoryStage {
  id: string;
  title: string;
  /**
   * model: the whole word is shown faintly in the slots, the child copies it;
   * missing: every letter is in place but one; build: picture + sound only, just the word's letters;
   * build-hard: as build, plus three look-alike distractor tiles
   */
  mode: FactoryMode;
  /** WORD ids drawn from for the rounds (more than `rounds`, so replays differ) */
  words: string[];
  rounds: number;
}

export const FACTORY_WORD = new Map(WORDS.map((wd) => [wd.id, wd]));

/** Every word in the bank appears in at least one stage; short words first, look-alikes last. */
const PLAN: FactoryStage[] = [
  { id: 'factory-1', title: 'انسخ الكلمة: 3 حروف', mode: 'model', words: ['bab', 'asad', 'tamr', 'jamal', 'hut', 'shams', 'fil', 'mawz'], rounds: 5 },
  { id: 'factory-2', title: 'الحرف الناقص: 3 حروف', mode: 'missing', words: ['thawb', 'jazar', 'khubz', 'saqr', 'ayn', 'qamar', 'lawz', 'inab'], rounds: 5 },
  { id: 'factory-3', title: 'ركّب الكلمة: 3 حروف', mode: 'build', words: ['yad', 'dubb', 'zaby', 'dirs', 'dhib', 'zarf', 'kura', 'qitta', 'batta', 'dhura'], rounds: 5 },
  { id: 'factory-4', title: 'انتبه للمتشابهات: 3 حروف', mode: 'build-hard', words: ['thawb', 'jazar', 'khubz', 'dhib', 'zarf', 'qamar', 'inab', 'saqr'], rounds: 5 },
  { id: 'factory-5', title: 'الحرف الناقص: 4 حروف', mode: 'missing', words: ['arnab', 'thalab', 'hisan', 'kharuf', 'rumman', 'risha', 'zahra', 'samaka', 'shajara', 'difda'], rounds: 5 },
  { id: 'factory-6', title: 'ركّب الكلمة: 4 حروف', mode: 'build', words: ['ghayma', 'ghazal', 'kitab', 'najma', 'nakhla', 'hilal', 'hadiyya', 'warda'], rounds: 5 },
  { id: 'factory-7', title: 'ركّب الكلمة: 5 حروف', mode: 'build', words: ['tuffaha', 'dajaja', 'zarafa', 'sayyara', 'sunduq', 'taira', 'tamatim', 'farasha', 'laymun', 'miftah', 'wisada', 'yaqtin'], rounds: 5 },
  { id: 'factory-8', title: 'انتبه للمتشابهات: 4 و 5 حروف', mode: 'build-hard', words: ['thalab', 'kharuf', 'shajara', 'ghazal', 'najma', 'tuffaha', 'sayyara', 'farasha', 'miftah', 'yaqtin'], rounds: 5 },
];

// stay whole if the word bank changes: unknown ids drop out, words no stage names join the last stage
const named = new Set(PLAN.flatMap((st) => st.words));
const unnamed = WORDS.filter((wd) => !named.has(wd.id)).map((wd) => wd.id);
export const FACTORY_STAGES: FactoryStage[] = PLAN.map((st, i) => ({
  ...st,
  words: [...st.words.filter((id) => FACTORY_WORD.has(id)), ...(i === PLAN.length - 1 ? unnamed : [])],
}));

/** Letters a word is spelt with that are not among the 28 (hamza seats, ta marbuta): name and audio. */
const EXTRA_LETTER: Record<string, { name: string; key: string; looks: string[] }> = {
  أ: { name: 'ألف عليها همزة', key: 'factory/name-alif-hamza', looks: ['ا', 'ل'] },
  ة: { name: 'تاء مربوطة', key: 'factory/name-ta-marbuta', looks: ['ه', 'ت'] },
  ئ: { name: 'همزة على نبرة', key: 'factory/name-ya-hamza', looks: ['ي', 'ن', 'ب'] },
};

/** Look-alikes the families in arabic.ts do not cover. */
const MORE_LOOKS: Record<string, string[]> = { ا: ['أ', 'ل'], و: ['ر', 'ز'] };

export const tileName = (ch: string) => EXTRA_LETTER[ch]?.name ?? LETTER.get(ch)?.name ?? ch;
export const tileAudio = (ch: string) => EXTRA_LETTER[ch]?.key ?? letterNameAudio(ch);

/** Letters a child could mistake for `ch`: same skeleton (group or look-alike family), different dots. */
export function lookAlikes(ch: string): string[] {
  if (EXTRA_LETTER[ch]) return EXTRA_LETTER[ch].looks;
  const group = LETTER.get(ch)?.group;
  const same = LETTERS.filter((l) => l.group === group).map((l) => l.char);
  const family = LOOKALIKES.find((f) => f.includes(ch)) ?? [];
  return [...new Set([...same, ...family, ...(MORE_LOOKS[ch] ?? [])])].filter((c) => c !== ch);
}

export const FACTORY_AUDIO = [
  'factory/intro', 'factory/wrong', 'factory/made',
  'race/cheer1', 'race/cheer2', 'race/cheer3', 'race/cheer4', 'race/cheer5',
  'race/combo3', 'race/combo5', 'race/stage-done', 'music/fish',
  'sfx/correct', 'sfx/star', 'sfx/combo', 'sfx/fanfare', 'sfx/applause', 'sfx/yay', 'sfx/fireworks',
  'sfx/bump', 'sfx/plop', 'sfx/reel', 'sfx/whoosh',
  ...WORDS.map(wordAudio),
  ...LETTERS.map((l) => letterNameAudio(l.char)),
  ...Object.values(EXTRA_LETTER).map((x) => x.key),
];
