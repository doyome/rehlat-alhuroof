// Shared Arabic content for every game: the 28 letters and a bank of picture words.
// Text is always rendered by the app (never baked into images) so shaping, dots and harakat stay correct.

import type { Haraka } from './race';

export interface Letter {
  char: string;
  name: string;
  slug: string; // latin id for file names
  /** false for the six letters that never join the next letter: ا د ذ ر ز و */
  joins: boolean;
  /** letters that look alike (same skeleton, different dots) share a group */
  group: string;
}

export const LETTERS: Letter[] = [
  { char: 'ا', name: 'ألف', slug: 'alif', joins: false, group: 'alif' },
  { char: 'ب', name: 'باء', slug: 'ba', joins: true, group: 'ba' },
  { char: 'ت', name: 'تاء', slug: 'ta', joins: true, group: 'ba' },
  { char: 'ث', name: 'ثاء', slug: 'tha', joins: true, group: 'ba' },
  { char: 'ج', name: 'جيم', slug: 'jim', joins: true, group: 'jim' },
  { char: 'ح', name: 'حاء', slug: 'hha', joins: true, group: 'jim' },
  { char: 'خ', name: 'خاء', slug: 'kha', joins: true, group: 'jim' },
  { char: 'د', name: 'دال', slug: 'dal', joins: false, group: 'dal' },
  { char: 'ذ', name: 'ذال', slug: 'dhal', joins: false, group: 'dal' },
  { char: 'ر', name: 'راء', slug: 'ra', joins: false, group: 'ra' },
  { char: 'ز', name: 'زاي', slug: 'zay', joins: false, group: 'ra' },
  { char: 'س', name: 'سين', slug: 'sin', joins: true, group: 'sin' },
  { char: 'ش', name: 'شين', slug: 'shin', joins: true, group: 'sin' },
  { char: 'ص', name: 'صاد', slug: 'sad', joins: true, group: 'sad' },
  { char: 'ض', name: 'ضاد', slug: 'dad', joins: true, group: 'sad' },
  { char: 'ط', name: 'طاء', slug: 'tta', joins: true, group: 'tta' },
  { char: 'ظ', name: 'ظاء', slug: 'zha', joins: true, group: 'tta' },
  { char: 'ع', name: 'عين', slug: 'ain', joins: true, group: 'ain' },
  { char: 'غ', name: 'غين', slug: 'ghain', joins: true, group: 'ain' },
  { char: 'ف', name: 'فاء', slug: 'fa', joins: true, group: 'fa' },
  { char: 'ق', name: 'قاف', slug: 'qaf', joins: true, group: 'fa' },
  { char: 'ك', name: 'كاف', slug: 'kaf', joins: true, group: 'kaf' },
  { char: 'ل', name: 'لام', slug: 'lam', joins: true, group: 'lam' },
  { char: 'م', name: 'ميم', slug: 'mim', joins: true, group: 'mim' },
  { char: 'ن', name: 'نون', slug: 'nun', joins: true, group: 'ba' },
  { char: 'ه', name: 'هاء', slug: 'ha', joins: true, group: 'ha' },
  { char: 'و', name: 'واو', slug: 'waw', joins: false, group: 'waw' },
  { char: 'ي', name: 'ياء', slug: 'ya', joins: true, group: 'ba' },
];

export const LETTER = new Map(LETTERS.map((l) => [l.char, l]));

/** Lessons of four letters in teaching order, used to build stations on the map. */
export const LETTER_SETS: string[][] = [
  ['ا', 'ب', 'ت', 'ث'],
  ['ج', 'ح', 'خ', 'د'],
  ['ذ', 'ر', 'ز', 'س'],
  ['ش', 'ص', 'ض', 'ط'],
  ['ظ', 'ع', 'غ', 'ف'],
  ['ق', 'ك', 'ل', 'م'],
  ['ن', 'ه', 'و', 'ي'],
];

/** Look-alike families for focused practice (spec: «التمييز بين المتشابهات»). */
export const LOOKALIKES: string[][] = [
  ['ب', 'ت', 'ث', 'ن'],
  ['ج', 'ح', 'خ'],
  ['د', 'ذ', 'ر', 'ز'],
  ['س', 'ش', 'ص', 'ض'],
  ['ط', 'ظ', 'ع', 'غ'],
  ['ف', 'ق', 'ك', 'ل'],
];

const MARK: Record<Haraka, string> = { fatha: 'َ', damma: 'ُ', kasra: 'ِ' };

/** A letter with a short vowel, as a child should read it (alif carries a hamza). */
export function syllable(char: string, h: Haraka) {
  if (char === 'ا') return (h === 'kasra' ? 'إ' : 'أ') + MARK[h];
  return char + MARK[h];
}

export const letterNameAudio = (char: string) => `abc/name-${LETTER.get(char)!.slug}`;
export const syllableAudioKey = (char: string, h: Haraka) => `abc/${LETTER.get(char)!.slug}-${h}`;

export interface Word {
  id: string; // file id for picture and audio
  text: string; // fully vowelled, as shown to the child
  /** the letters a child builds it from, in reading order (ة and hamza seats kept as written) */
  spell: string[];
  meaning: string; // English, for picture generation only
}

const w = (id: string, text: string, spell: string, meaning: string): Word => ({ id, text, spell: [...spell], meaning });

/** Two clear, picturable words per letter; the first letter of each word is the letter it teaches. */
export const WORDS: Word[] = [
  w('asad', 'أَسَد', 'أسد', 'lion'),
  w('arnab', 'أَرْنَب', 'أرنب', 'rabbit'),
  w('bab', 'بَاب', 'باب', 'wooden door'),
  w('batta', 'بَطَّة', 'بطة', 'duck'),
  w('tuffaha', 'تُفَّاحَة', 'تفاحة', 'red apple'),
  w('tamr', 'تَمْر', 'تمر', 'dates fruit'),
  w('thalab', 'ثَعْلَب', 'ثعلب', 'fox'),
  w('thawb', 'ثَوْب', 'ثوب', 'traditional long dress garment'),
  w('jamal', 'جَمَل', 'جمل', 'camel'),
  w('jazar', 'جَزَر', 'جزر', 'carrots'),
  w('hisan', 'حِصَان', 'حصان', 'horse'),
  w('hut', 'حُوت', 'حوت', 'whale'),
  w('kharuf', 'خَرُوف', 'خروف', 'sheep'),
  w('khubz', 'خُبْز', 'خبز', 'round bread'),
  w('dubb', 'دُبّ', 'دب', 'brown bear'),
  w('dajaja', 'دَجَاجَة', 'دجاجة', 'hen'),
  w('dhib', 'ذِئْب', 'ذئب', 'wolf'),
  w('dhura', 'ذُرَة', 'ذرة', 'corn cob'),
  w('rumman', 'رُمَّان', 'رمان', 'pomegranate'),
  w('risha', 'رِيشَة', 'ريشة', 'feather'),
  w('zarafa', 'زَرَافَة', 'زرافة', 'giraffe'),
  w('zahra', 'زَهْرَة', 'زهرة', 'flower'),
  w('samaka', 'سَمَكَة', 'سمكة', 'fish'),
  w('sayyara', 'سَيَّارَة', 'سيارة', 'car'),
  w('shams', 'شَمْس', 'شمس', 'sun'),
  w('shajara', 'شَجَرَة', 'شجرة', 'tree'),
  w('saqr', 'صَقْر', 'صقر', 'falcon'),
  w('sunduq', 'صُنْدُوق', 'صندوق', 'treasure box'),
  w('difda', 'ضِفْدَع', 'ضفدع', 'frog'),
  w('dirs', 'ضِرْس', 'ضرس', 'tooth'),
  w('taira', 'طَائِرَة', 'طائرة', 'airplane'),
  w('tamatim', 'طَمَاطِم', 'طماطم', 'tomatoes'),
  w('zarf', 'ظَرْف', 'ظرف', 'envelope'),
  w('zaby', 'ظَبْي', 'ظبي', 'baby deer fawn with white spots'),
  w('ayn', 'عَيْن', 'عين', 'eye'),
  w('inab', 'عِنَب', 'عنب', 'grapes'),
  w('ghayma', 'غَيْمَة', 'غيمة', 'cloud'),
  w('ghazal', 'غَزَال', 'غزال', 'gazelle'),
  w('fil', 'فِيل', 'فيل', 'elephant'),
  w('farasha', 'فَرَاشَة', 'فراشة', 'butterfly'),
  w('qamar', 'قَمَر', 'قمر', 'full moon'),
  w('qitta', 'قِطَّة', 'قطة', 'cat'),
  w('kitab', 'كِتَاب', 'كتاب', 'book'),
  w('kura', 'كُرَة', 'كرة', 'football'),
  w('laymun', 'لَيْمُون', 'ليمون', 'lemon'),
  w('lawz', 'لَوْز', 'لوز', 'almonds'),
  w('mawz', 'مَوْز', 'موز', 'bananas'),
  w('miftah', 'مِفْتَاح', 'مفتاح', 'key'),
  w('najma', 'نَجْمَة', 'نجمة', 'star'),
  w('nakhla', 'نَخْلَة', 'نخلة', 'palm tree'),
  w('hilal', 'هِلَال', 'هلال', 'crescent moon'),
  w('hadiyya', 'هَدِيَّة', 'هدية', 'gift box'),
  w('warda', 'وَرْدَة', 'وردة', 'red rose'),
  w('wisada', 'وِسَادَة', 'وسادة', 'pillow'),
  w('yad', 'يَد', 'يد', 'hand'),
  w('yaqtin', 'يَقْطِين', 'يقطين', 'pumpkin'),
];

export const wordAudio = (wd: Word) => `words/${wd.id}`;
export const wordImage = (wd: Word) => `words/${wd.id}.png`;
/** The letter a word starts with, as taught (hamza on alif counts as alif). */
export const firstLetter = (wd: Word) => (/[أإآ]/.test(wd.spell[0]) ? 'ا' : wd.spell[0]);
