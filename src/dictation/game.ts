// «تحدّي الإملاء» — the child hears a word and writes it on a golden notebook line with an
// on-screen Arabic keyboard. The word is shown as one connected, vowel-free string. A check colours
// each position: right letters stay, wrong or missing ones turn orange, extra ones red; after two
// misses the word appears faintly under the line to copy. Never timed: speed is not judged.

import './style.css';
import { play, preloadAudio, say, sfx } from '../audio';
import { logAttempt } from '../progress';
import { GameShell } from '../core/shell';
import { LETTER, LETTERS, WORDS, letterNameAudio, wordAudio, wordImage, type Word } from '../data/arabic';
import { DICTATION_AUDIO, G4_DICTATION_AUDIO, type DictationStage } from '../data/dictation';
import { SPELL_WORDS, spellAudio } from '../data/g4';

const BASE = import.meta.env.BASE_URL;

export interface DictationOptions {
  child: string;
  stage: DictationStage;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

const WORD = new Map(WORDS.map((w) => [w.id, w]));
/** grade-4 spelling words in the picture-word shape (no pictures; their audio lives under g4w/) */
const G4_WORD = new Map(SPELL_WORDS.map((w) => [w.id, { id: w.id, text: w.text, spell: w.spell, meaning: '' } as Word]));
const G4_IDS = new Set(G4_WORD.keys());
const audioOf = (w: Word) => (G4_IDS.has(w.id) && !WORD.has(w.id) ? spellAudio(SPELL_WORDS.find((s) => s.id === w.id)!) : wordAudio(w));
/** hamza seats, taa marbuta and alif maqsura: the letters a word is written with beyond the 28 */
const EXTRA = ['ة', 'أ', 'إ', 'ئ', 'ؤ', 'ء', 'ى'];
const KEYS = new Set([...LETTERS.map((l) => l.char), ...EXTRA]);
/** letters that connect to the letter after them (dual-joining) */
const JOINS_NEXT = new Set([...LETTERS.filter((l) => l.joins).map((l) => l.char), 'ئ', 'ى']);
const ZWJ = '‍';
const MAX_LETTERS = 10;

const images = new Map<string, HTMLImageElement>();

function loadImg(id: string) {
  return new Promise<void>((res) => {
    if (images.has(id)) return res();
    const im = new Image();
    im.onload = () => res();
    im.onerror = () => res();
    im.src = `${BASE}assets/${wordImage(WORD.get(id)!)}`;
    images.set(id, im);
  });
}

const imageOk = (id: string) => {
  const im = images.get(id);
  return !!im?.complete && im.naturalWidth > 0;
};

export function preloadDictation(stage?: DictationStage) {
  return Promise.all([
    preloadAudio(stage?.bank === 'g4' ? [...DICTATION_AUDIO, ...G4_DICTATION_AUDIO] : DICTATION_AUDIO),
    document.fonts.load('700 80px "Noto Naskh Arabic"', 'أبجد'),
    document.fonts.load('800 24px "Baloo Bhaijaan 2"', 'تحقق'),
    ...WORDS.map((w) => loadImg(w.id)),
  ]);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** ok = right letter, wrong = another letter in its place, miss = an empty place, extra = beyond the word */
type Mark = 'ok' | 'wrong' | 'miss' | 'extra' | null;

const TROPHY = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="dict-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.45" stop-color="#f4c542"/><stop offset="1" stop-color="#b8790a"/></linearGradient></defs>
  <path d="M18 8h28v14c0 9-6 16-14 16s-14-7-14-16z" fill="url(#dict-gold)" stroke="#8a5a00" stroke-width="2"/>
  <path d="M18 13H9c0 9 4 14 10 15M46 13h9c0 9-4 14-10 15" fill="none" stroke="#c98c12" stroke-width="3.5" stroke-linecap="round"/>
  <rect x="28" y="37" width="8" height="10" fill="url(#dict-gold)" stroke="#8a5a00" stroke-width="2"/>
  <rect x="19" y="47" width="26" height="8" rx="2" fill="url(#dict-gold)" stroke="#8a5a00" stroke-width="2"/>
  <path d="M32 14l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fffbe6"/>
</svg>`;

const SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

export class DictationGame {
  private o: DictationOptions;
  private shell: GameShell;
  private el: Record<string, HTMLElement> = {};
  private words: Word[];
  private word!: Word;
  // what the child has written: '' is an empty place left by a check
  private letters: string[] = [];
  private marks: Mark[] = [];
  /** keys typed since the last check, so ⌫ undoes them in order */
  private history: { i: number; filled: boolean }[] = [];
  private tries = 0;
  private help = 0;
  private roundStart = 0;
  private busy = true;
  private dead = false;
  private talking = false;
  private talkId = 0;
  private introDone = false;

  constructor(root: HTMLElement, opts: DictationOptions) {
    this.o = opts;
    const st = opts.stage;
    this.words = this.pickWords(st);
    this.shell = new GameShell({
      root,
      kind: 'dictation',
      child: opts.child,
      stageId: st.id,
      rounds: st.rounds,
      doneTitle: 'بطل الإملاء!',
      onExit: opts.onExit,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
      onReplay: () => this.replay(),
      onPause: (p) => {
        if (p) {
          // a stopped voice may never report its end; never let that silence the keyboard
          this.talkId++;
          this.talking = false;
        }
      },
    });
    this.build();
    this.shell.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    if (import.meta.env.DEV) (window as unknown as { __dict: DictationGame }).__dict = this;
    void this.newRound();
  }

  destroy() {
    this.dead = true;
    this.shell.destroy();
  }

  private pickWords(st: DictationStage) {
    const pool = st.words.map((id) => (st.bank === 'g4' ? G4_WORD : WORD).get(id)).filter((w): w is Word => !!w);
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return Array.from({ length: st.rounds }, (_, i) => shuffled[i % shuffled.length]);
  }

  // ---------- scene ----------

  private build() {
    const st = this.o.stage;
    const s = this.shell.stage;
    const row = (chars: string[], cls = '') => chars.map((c) => `<button class="dict-key ${cls}" data-c="${c}">${c}</button>`).join('');
    s.innerHTML = `
      <div class="dict-scene" dir="rtl">
        <section class="dict-paper">
          <div class="dict-ribbon"><span>تحدّي الإملاء</span><b>${st.title}</b></div>
          <div class="dict-top">
            <figure class="dict-pic" hidden><img alt=""></figure>
            <button class="dict-say" aria-label="أعد الكلمة">${SPEAKER}</button>
          </div>
          <div class="dict-line"><span class="dict-word"></span></div>
          <div class="dict-copy" hidden></div>
          <div class="dict-boxes" ${st.showLength ? '' : 'hidden'}></div>
          <div class="dict-trophy">${TROPHY}</div>
        </section>
        <section class="dict-keys">
          <div class="dict-grid">${row(LETTERS.map((l) => l.char))}${row(EXTRA, 'extra')}</div>
          <div class="dict-actions">
            <button class="dict-key erase" aria-label="مسح">⌫ مسح</button>
            <button class="dict-key check">تحقّق</button>
          </div>
        </section>
      </div>`;
    const q = (sel: string) => s.querySelector(sel) as HTMLElement;
    this.el = {
      paper: q('.dict-paper'),
      pic: q('.dict-pic'),
      img: q('.dict-pic img'),
      line: q('.dict-line'),
      word: q('.dict-word'),
      copy: q('.dict-copy'),
      boxes: q('.dict-boxes'),
      trophy: q('.dict-trophy'),
      check: q('.check'),
    };
    s.querySelectorAll<HTMLElement>('.dict-key[data-c]').forEach((b) => this.shell.press(b, () => this.type(b.dataset.c!, b)));
    this.shell.press(q('.erase'), (b) => this.erase(b));
    this.shell.press(this.el.check, () => void this.check());
    this.shell.press(q('.dict-say'), () => this.replay());
  }

  private hit(b?: HTMLElement) {
    if (!b) return;
    b.classList.remove('hit');
    void b.offsetWidth;
    b.classList.add('hit');
  }

  /** Where the writing line sits, in the celebration layer's coordinates. */
  private lineCenter() {
    const r = this.el.line.getBoundingClientRect();
    const root = this.shell.root.getBoundingClientRect();
    return { x: r.left + r.width / 2 - root.left, y: r.top + r.height / 2 - root.top };
  }

  private render() {
    const L = this.letters;
    const fixing = this.marks.some((m) => m === 'wrong' || m === 'miss');
    // one span per letter keeps colours per position; zero-width joiners keep the word connected
    // even where the browser shapes each span on its own
    const joinNext = (i: number) => !!L[i] && !!L[i + 1] && JOINS_NEXT.has(L[i]) && L[i + 1] !== 'ء';
    const html = L.map((c, i) => {
      const m = this.marks[i] ?? '';
      if (!c) return `<span class="slot ${m}"></span>`;
      const text = (joinNext(i - 1) ? ZWJ : '') + c + (joinNext(i) ? ZWJ : '');
      return `<span class="ch ${m}">${text}</span>`;
    }).join('');
    this.el.word.innerHTML = html + (fixing || this.busy ? '' : '<span class="caret"></span>');
    this.el.line.classList.toggle('long', L.length > 6);
    if (this.o.stage.showLength) {
      const n = Math.max(this.word.spell.length, L.length);
      this.el.boxes.innerHTML = Array.from({ length: n }, (_, i) => {
        const over = i >= this.word.spell.length ? 'over' : '';
        return `<i class="${over} ${this.marks[i] ?? ''} ${L[i] ? 'full' : ''}">${L[i] ?? ''}</i>`;
      }).join('');
    }
    this.el.check.classList.toggle('ready', L.some(Boolean));
  }

  // ---------- voice ----------

  /** Speak a line the child should hear in full; key taps stay silent meanwhile. */
  private async talk(key: string, text: string) {
    const id = ++this.talkId;
    this.talking = true;
    await Promise.race([say(key, text), wait(9000)]);
    if (id === this.talkId) this.talking = false;
  }

  private replay() {
    if (this.dead || this.shell.done || !this.word) return;
    this.help = Math.max(this.help, 1);
    this.shell.pulseCard();
    void this.talk(audioOf(this.word), this.word.text);
  }

  // ---------- input ----------

  private onKey(e: KeyboardEvent) {
    if (this.shell.paused || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') this.erase();
    else if (e.key === 'Enter') void this.check();
    else if (e.key === 'لا') {
      this.type('ل');
      this.type('ا');
    } else if (KEYS.has(e.key)) this.type(e.key);
    else return;
    e.preventDefault();
  }

  private type(c: string, b?: HTMLElement) {
    this.hit(b);
    if (this.busy) return;
    const slot = this.marks.findIndex((m) => m === 'wrong' || m === 'miss');
    if (slot >= 0) {
      // fixing after a check: the new letter goes into the first coloured place
      this.letters[slot] = c;
      this.marks[slot] = null;
      this.history.push({ i: slot, filled: true });
    } else {
      if (this.letters.length >= MAX_LETTERS) {
        sfx.bump();
        return;
      }
      this.letters.push(c);
      this.marks.push(null);
      this.history.push({ i: this.letters.length - 1, filled: false });
    }
    sfx.tap();
    const l = LETTER.get(c);
    if (l && !this.talking) void say(letterNameAudio(c), l.name);
    this.render();
  }

  private erase(b?: HTMLElement) {
    this.hit(b);
    if (this.busy || !this.letters.length) return;
    const h = this.history.pop();
    if (h?.filled) {
      // undo a fix: the place is empty and orange again
      this.letters[h.i] = '';
      this.marks[h.i] = 'miss';
    } else {
      this.letters.pop();
      this.marks.pop();
    }
    sfx.tap();
    this.render();
  }

  // ---------- rounds ----------

  private async newRound() {
    if (this.dead || this.shell.done) return;
    this.word = this.words[this.shell.round];
    this.letters = [];
    this.marks = [];
    this.history = [];
    this.tries = 0;
    this.help = 0;
    this.roundStart = performance.now();
    this.busy = false;
    const st = this.o.stage;
    const pic = st.showPicture && imageOk(this.word.id);
    this.el.pic.hidden = !pic;
    if (pic) (this.el.img as HTMLImageElement).src = images.get(this.word.id)!.src;
    this.el.copy.hidden = true;
    this.el.copy.textContent = this.word.spell.join('');
    this.el.trophy.classList.remove('show');
    this.el.paper.classList.remove('won');
    this.shell.setTarget('؟', true);
    this.render();
    if (!this.introDone) {
      this.introDone = true;
      this.shell.bubble('تحدّي الإملاء! استمع إلى الكلمة واكتبها', 4200);
      await (this.o.stage.bank === 'g4'
        ? this.talk('g4/spell-intro', 'استمع إلى الكلمة واكتبها بإملاء صحيح')
        : this.talk('dict/intro', 'تحدّي الإملاء! استمع إلى الكلمة واكتبها'));
      if (this.dead) return;
      await wait(250);
    }
    if (this.dead || this.shell.done) return;
    this.shell.pulseCard();
    await this.talk(audioOf(this.word), this.word.text);
  }

  private async check() {
    if (this.busy || this.dead) return;
    this.hit(this.el.check);
    if (!this.letters.some(Boolean)) {
      // nothing written yet: say the word again rather than judge an empty line
      this.shell.bubble('استمع واكتب الكلمة', 2200);
      void this.talk(audioOf(this.word), this.word.text);
      return;
    }
    const spell = this.word.spell;
    this.tries++;
    const correct = this.letters.length === spell.length && spell.every((c, i) => this.letters[i] === c);
    logAttempt({
      child: this.o.child,
      activity: 'dictation',
      stage: this.o.stage.id,
      item: this.word.id,
      answer: this.letters.join(''),
      correct,
      help: this.help,
      tries: this.tries,
      ms: Math.round(performance.now() - this.roundStart),
    });
    if (correct) await this.win();
    else await this.fix();
  }

  private async fix() {
    const spell = this.word.spell;
    this.shell.wrong();
    // align by position; empty places stand for missing letters, anything past the word is extra
    while (this.letters.length < spell.length) this.letters.push('');
    this.marks = this.letters.map((c, i) => (i >= spell.length ? 'extra' : c === spell[i] ? 'ok' : c ? 'wrong' : 'miss'));
    this.history = [];
    if (this.tries >= 2) {
      this.help = 2;
      this.el.copy.hidden = false;
    }
    this.render();
    this.el.line.classList.remove('shake');
    void this.el.line.offsetWidth;
    this.el.line.classList.add('shake');
    this.shell.bubble('اقتربت! انظر إلى الحروف الملوّنة وصحّحها', 3800);
    await this.talk('dict/fix', 'اقتربت! انظر إلى الحروف الملوّنة وصحّحها');
  }

  private async win() {
    this.busy = true;
    this.marks = this.letters.map(() => null);
    this.render();
    const chars = [...this.el.word.querySelectorAll('.ch')];
    const boxes = [...this.el.boxes.querySelectorAll('i')];
    // the letters light up green one by one, each with a rising chime
    for (let i = 0; i < chars.length; i++) {
      if (this.dead) return;
      chars[i].classList.add('ok', 'glow');
      boxes[i]?.classList.add('ok');
      if (!play('sfx/coin', 0.45, 1 + i * 0.08)) sfx.tap();
      await wait(170);
    }
    if (this.dead) return;
    const { x, y } = this.lineCenter();
    this.el.paper.classList.add('won');
    this.el.trophy.classList.add('show');
    this.shell.burst(x, y, 90);
    this.shell.setTarget(this.word.text);
    this.el.copy.hidden = true;
    await this.talk(audioOf(this.word), this.word.text);
    if (this.dead) return;
    const firstTry = this.tries === 1;
    // hearing the word again is part of dictation, so a replay still counts as independent
    const over = await this.shell.correct(firstTry && this.help < 2, firstTry, x, y);
    if (this.dead) return;
    if (over) this.finish();
    else setTimeout(() => void this.newRound(), 600);
  }

  private finish() {
    const n = this.o.stage.rounds;
    const perfect = this.shell.firstTry === n;
    this.shell.finish(`كتبت ${n} كلمات إملاءً${perfect ? ' — إملاء ممتاز!' : ''}`);
    const panel = this.shell.el.end.querySelector('.panel');
    if (panel && !panel.querySelector('.dict-end-trophy')) {
      const t = document.createElement('div');
      t.className = 'dict-end-trophy';
      t.innerHTML = TROPHY;
      panel.insertBefore(t, this.shell.el.endTitle);
    }
    if (perfect)
      setTimeout(() => {
        if (!this.dead) void say('dict/perfect', 'إملاء ممتاز! كتبت كل الكلمات صحيحة من أول مرة');
      }, 3400);
  }
}
