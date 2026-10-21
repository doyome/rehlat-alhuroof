// Content for «سباق الحركات». Letters and diacritics are always rendered as text, never baked into images.

import { LETTER, LETTER_SETS, LOOKALIKES, syllable } from './arabic';

export type Haraka = 'fatha' | 'damma' | 'kasra';

export const HARAKA_MARK: Record<Haraka, string> = {
  fatha: 'َ',
  damma: 'ُ',
  kasra: 'ِ',
};

export const HARAKA_NAME: Record<Haraka, string> = {
  fatha: 'فتحة',
  damma: 'ضمة',
  kasra: 'كسرة',
};

export interface Syllable {
  letter: string;
  haraka: Haraka;
}

export interface RaceStage {
  id: string;
  title: string;
  /** Letters drawn from for each round; one letter per round, gates differ only by haraka. */
  letters: string[];
  harakat: Haraka[];
  rounds: number;
}

export const STAGES: RaceStage[] = [
  { id: 'ba-2', title: 'بَ بُ', letters: ['ب'], harakat: ['fatha', 'damma'], rounds: 5 },
  { id: 'ba-3', title: 'بَ بُ بِ', letters: ['ب'], harakat: ['fatha', 'damma', 'kasra'], rounds: 5 },
  { id: 'ta-3', title: 'تَ تُ تِ', letters: ['ت'], harakat: ['fatha', 'damma', 'kasra'], rounds: 5 },
  { id: 'mim-3', title: 'مَ مُ مِ', letters: ['م'], harakat: ['fatha', 'damma', 'kasra'], rounds: 5 },
  { id: 'mix', title: 'مراجعة: ب ت م', letters: ['ب', 'ت', 'م'], harakat: ['fatha', 'damma', 'kasra'], rounds: 5 },
  // every letter: one stage per lesson set, then look-alike families
  ...LETTER_SETS.map((set, i) => ({
    id: `race-set${i + 1}`,
    title: set.join(' '),
    letters: set,
    harakat: ['fatha', 'damma', 'kasra'] as Haraka[],
    rounds: 6,
  })),
  ...LOOKALIKES.map((set, i) => ({
    id: `race-look${i + 1}`,
    title: `متشابهات: ${set.join(' ')}`,
    letters: set,
    harakat: ['fatha', 'damma', 'kasra'] as Haraka[],
    rounds: 6,
  })),
];

export const syllableText = (s: Syllable) => syllable(s.letter, s.haraka);
export const syllableKey = (s: Syllable) => `${s.letter}-${s.haraka}`;

/** Latin slugs for audio file names. */
export const LETTER_SLUG: Record<string, string> = Object.fromEntries([...LETTER].map(([c, l]) => [c, l.slug]));
export const syllableAudio = (s: Syllable) => `abc/${LETTER_SLUG[s.letter]}-${s.haraka}`;
/** The syllable recordings one stage needs (preloaded with the game). */
export const stageAudio = (st: RaceStage) => st.letters.flatMap((l) => st.harakat.map((h) => syllableAudio({ letter: l, haraka: h })));

export const RACE_AUDIO = [
  'race/intro', 'race/countdown', 'race/retry', 'race/choose', 'race/hint', 'race/stage-done',
  'race/cheer1', 'race/cheer2', 'race/cheer3', 'race/cheer4', 'race/cheer5',
  'sfx/countdown', 'sfx/correct', 'sfx/star', 'sfx/bump', 'sfx/screech', 'sfx/engine', 'sfx/whoosh', 'sfx/fanfare', 'sfx/applause',
  'race/combo3', 'race/combo5', 'race/beep', 'music/race',
  'sfx/engine2', 'sfx/horn', 'sfx/coin', 'sfx/boost', 'sfx/drift', 'sfx/fireworks', 'sfx/yay', 'sfx/gate-pop', 'sfx/combo', 'sfx/thump',
];
