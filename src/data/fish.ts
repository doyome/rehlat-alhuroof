// Content for «الصيّاد». Letters on the fish are drawn as text, never baked into images.

import { LETTER_SLUG } from './race';

export const LETTER_NAME: Record<string, string> = { ب: 'باء', ت: 'تاء', ث: 'ثاء', م: 'ميم', ن: 'نون', س: 'سين' };

export interface FishStage {
  id: string;
  title: string;
  letters: string[];
  /** how many fish swim at once */
  fish: number;
  /** stage 1 shows the letter on the target card; later stages are by ear only */
  showCard: boolean;
  rounds: number;
}

export const FISH_STAGES: FishStage[] = [
  { id: 'f-bms', title: 'ب م س', letters: ['ب', 'م', 'س'], fish: 3, showCard: true, rounds: 5 },
  { id: 'f-btmn', title: 'ب ت م ن', letters: ['ب', 'ت', 'م', 'ن'], fish: 4, showCard: false, rounds: 5 },
  { id: 'f-btth', title: 'ب ت ث', letters: ['ب', 'ت', 'ث'], fish: 4, showCard: false, rounds: 5 },
  { id: 'f-all', title: 'مراجعة: ب ت ث م ن س', letters: ['ب', 'ت', 'ث', 'م', 'ن', 'س'], fish: 6, showCard: false, rounds: 5 },
];

export const letterNameAudio = (l: string) => `fish/name-${LETTER_SLUG[l]}`;

export const FISH_AUDIO = [
  'fish/intro', 'fish/find', 'fish/this-is', 'fish/try-again', 'fish/hint', 'fish/done',
  'fish/cheer1', 'fish/cheer2', 'fish/cheer3', 'fish/cheer4', 'fish/cheer5',
  'race/combo3', 'race/combo5', 'music/fish',
  'sfx/correct', 'sfx/star', 'sfx/fanfare', 'sfx/applause', 'sfx/yay', 'sfx/fireworks', 'sfx/combo',
  'sfx/splash', 'sfx/reel', 'sfx/fish-jump', 'sfx/ocean', 'sfx/bubbles', 'sfx/escape', 'sfx/cast', 'sfx/plop',
  ...Object.keys(LETTER_NAME).map(letterNameAudio),
];
