// Content for «مشغل الحروف». The letter on the slate is always rendered from the font, never an image,
// so the guide, the judging mask and the coloured reward are the very same shape.

import { LETTERS, LETTER_SETS, LOOKALIKES, letterNameAudio } from './arabic';

/** How much of the letter the slate shows, from most guide to none. */
export type TraceHelp = 'full' | 'light' | 'dots' | 'free';

export interface TraceStage {
  id: string;
  title: string;
  letters: string[];
  /**
   * full = thick dotted outline + pale fill, light = pale fill only,
   * dots = the body without its dots (the child adds them), free = an empty slate (letter only on the HUD card)
   */
  help: TraceHelp;
  rounds: number;
}

/** Letters whose isolated form carries dots; their loose small parts are checked as dots. */
export const DOTTED = new Set([...'بتثجخذزشضظغفقني']);

// after the seven lessons, look-alike families come back with less and less guide
const HARDER: { help: TraceHelp; label: string; groups: number[] }[] = [
  { help: 'light', label: 'حرف باهت', groups: [2, 3] },
  { help: 'dots', label: 'أكمل النقاط', groups: [0, 1] },
  { help: 'free', label: 'اكتب وحدك', groups: [4, 5] },
];

export const TRACE_STAGES: TraceStage[] = [
  ...LETTER_SETS.map((letters, i) => ({ id: `trace-${i + 1}`, title: letters.join(' '), letters, help: 'full' as const, rounds: letters.length })),
  ...HARDER.map((h, i) => {
    const letters = h.groups.flatMap((g) => LOOKALIKES[g]);
    return { id: `trace-${LETTER_SETS.length + i + 1}`, title: `${h.label}: ${letters.join(' ')}`, letters, help: h.help, rounds: letters.length };
  }),
];

export const TRACE_AUDIO = [
  'trace/intro', 'trace/again', 'trace/dots', 'trace/great',
  'race/cheer1', 'race/cheer2', 'race/cheer3', 'race/cheer4', 'race/cheer5',
  'race/combo3', 'race/combo5', 'race/stage-done', 'music/race',
  'sfx/correct', 'sfx/star', 'sfx/combo', 'sfx/fanfare', 'sfx/yay', 'sfx/fireworks', 'sfx/applause', 'sfx/bump',
  ...LETTERS.map((l) => letterNameAudio(l.char)),
];
