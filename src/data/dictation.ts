// Content for «تحدّي الإملاء». The child hears a word and writes its letters; harakat are never typed.
// Stages climb from short words with a picture and one box per letter to long words by ear alone.

import { LETTERS, WORDS, letterNameAudio, wordAudio } from './arabic';
import { SPELL_STAGES, SPELL_WORDS, spellAudio } from './g4';

export interface DictationStage {
  id: string;
  title: string;
  /** WORD ids drawn from for the rounds (a stage uses `rounds` of them, shuffled) */
  words: string[];
  /** show the word's picture above the writing line */
  showPicture: boolean;
  /** show one box per letter under the line */
  showLength: boolean;
  rounds: number;
  /** 'g4': grade-4 spelling words (data/g4.ts), heard only, no pictures */
  bank?: 'g4';
}

/** WORD ids whose spelling has min..max letters. */
const byLength = (min: number, max: number) => WORDS.filter((w) => w.spell.length >= min && w.spell.length <= max).map((w) => w.id);

export const DICTATION_STAGES: DictationStage[] = [
  { id: 'dict-1', title: 'كلمات قصيرة', words: byLength(2, 3), showPicture: true, showLength: true, rounds: 5 },
  { id: 'dict-2', title: 'كلمات من 4 حروف', words: byLength(4, 4), showPicture: true, showLength: true, rounds: 5 },
  { id: 'dict-3', title: 'كلمات طويلة', words: byLength(5, 9), showPicture: true, showLength: true, rounds: 5 },
  { id: 'dict-4', title: 'بالسمع فقط', words: byLength(3, 4), showPicture: false, showLength: true, rounds: 5 },
  { id: 'dict-5', title: 'بلا مربّعات', words: byLength(3, 4), showPicture: false, showLength: false, rounds: 5 },
  { id: 'dict-6', title: 'تحدّي الأبطال', words: WORDS.map((w) => w.id), showPicture: false, showLength: false, rounds: 5 },
];

export const DICTATION_AUDIO = [
  'dict/intro', 'dict/fix', 'dict/perfect',
  'race/cheer1', 'race/cheer2', 'race/cheer3', 'race/cheer4', 'race/cheer5',
  'race/combo3', 'race/combo5', 'race/stage-done',
  'sfx/correct', 'sfx/star', 'sfx/combo', 'sfx/fanfare', 'sfx/applause', 'sfx/yay', 'sfx/fireworks', 'sfx/bump', 'sfx/coin',
  ...WORDS.map(wordAudio),
  ...LETTERS.map((l) => letterNameAudio(l.char)),
];

/** Grade-4 spelling stations: same game, words from the grade-4 bank. */
export const G4_DICTATION_STAGES: DictationStage[] = SPELL_STAGES.map((st) => ({ ...st, showPicture: false, bank: 'g4' as const }));

export const G4_DICTATION_AUDIO = ['g4/spell-intro', ...SPELL_WORDS.map(spellAudio)];
