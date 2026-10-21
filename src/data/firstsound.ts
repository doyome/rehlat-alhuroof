// Content for «مكتب البريد — أول حرف». The child hears and sees a picture word and posts it into the
// mailbox of its first letter. Stages follow the teaching order of LETTER_SETS, then two look-alike reviews.

import { LETTERS, LETTER_SETS, LOOKALIKES, WORDS, firstLetter, letterNameAudio, wordAudio, type Word } from './arabic';

export interface FirstSoundStage {
  id: string;
  title: string;
  /** first letters of this stage; every round's word starts with one of them */
  letters: string[];
  /** mailboxes shown each round: the right one plus other letters of the stage */
  boxes: 2 | 3 | 4;
  rounds: number;
}

/** Words whose first letter is one of `letters`. */
export const wordsFor = (letters: string[]): Word[] => WORDS.filter((wd) => letters.includes(firstLetter(wd)));

const hasWords = (l: string) => WORDS.some((wd) => firstLetter(wd) === l);

/** Never more boxes than letters the stage can put on them. */
const fit = (letters: string[], boxes: 2 | 3 | 4) => Math.max(2, Math.min(boxes, letters.length)) as 2 | 3 | 4;

// two boxes while the game is new, then three, then four
const LESSON_BOXES: (2 | 3 | 4)[] = [2, 2, 3, 3, 4, 4, 4];

const lessons = LETTER_SETS.map((set) => set.filter(hasWords)).filter((set) => set.length >= 2);

// look-alike reviews: the same skeleton with different dots, heard as different first sounds
const reviews: { letters: string[]; boxes: 3 | 4 }[] = [
  { letters: LOOKALIKES[1].filter(hasWords), boxes: 3 }, // ج ح خ
  { letters: LOOKALIKES[0].filter(hasWords), boxes: 4 }, // ب ت ث ن
];

export const FIRSTSOUND_STAGES: FirstSoundStage[] = [
  ...lessons.map((letters, i) => ({
    title: letters.join(' '),
    letters,
    boxes: fit(letters, LESSON_BOXES[Math.min(i, LESSON_BOXES.length - 1)]),
  })),
  ...reviews
    .filter((r) => r.letters.length >= 2)
    .map((r) => ({ title: `متشابهات: ${r.letters.join(' ')}`, letters: r.letters, boxes: fit(r.letters, r.boxes) })),
].map((s, i) => ({ id: `first-${i + 1}`, ...s, rounds: 5 }));

export const FIRSTSOUND_AUDIO = [
  'first/intro', 'first/wrong',
  'race/cheer1', 'race/cheer2', 'race/cheer3', 'race/cheer4', 'race/cheer5',
  'race/combo3', 'race/combo5', 'race/stage-done',
  'sfx/correct', 'sfx/star', 'sfx/combo', 'sfx/fanfare', 'sfx/applause', 'sfx/yay', 'sfx/fireworks',
  'sfx/bump', 'sfx/plop', 'sfx/whoosh',
  ...WORDS.map(wordAudio),
  ...LETTERS.map((l) => letterNameAudio(l.char)),
];
