// Content for «سباق الحركات». Letters and diacritics are always rendered as text, never baked into images.

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
];

export const syllableText = (s: Syllable) => s.letter + HARAKA_MARK[s.haraka];
export const syllableKey = (s: Syllable) => `${s.letter}-${s.haraka}`;

/** Latin slugs for audio file names. */
export const LETTER_SLUG: Record<string, string> = { ب: 'ba', ت: 'ta', ث: 'tha', م: 'mim', ن: 'nun', س: 'sin' };
export const syllableAudio = (s: Syllable) => `race/${LETTER_SLUG[s.letter]}-${s.haraka}`;

export const RACE_AUDIO = [
  'race/intro', 'race/countdown', 'race/retry', 'race/choose', 'race/hint', 'race/stage-done',
  'race/cheer1', 'race/cheer2', 'race/cheer3', 'race/cheer4', 'race/cheer5',
  'sfx/countdown', 'sfx/correct', 'sfx/star', 'sfx/bump', 'sfx/screech', 'sfx/engine', 'sfx/whoosh', 'sfx/fanfare', 'sfx/applause',
  'race/combo3', 'race/combo5', 'race/beep', 'music/race',
  'sfx/engine2', 'sfx/horn', 'sfx/coin', 'sfx/boost', 'sfx/drift', 'sfx/fireworks', 'sfx/yay', 'sfx/gate-pop', 'sfx/combo', 'sfx/thump',
  ...['ba', 'ta', 'mim'].flatMap((l) => ['fatha', 'damma', 'kasra'].map((h) => `race/${l}-${h}`)),
];
