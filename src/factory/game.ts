// «مصنع الكلمات» — the child sees a picture, hears its word, and builds it from letter tiles in
// reading order; the machine then «produces» the object. One action: tap a tile (or drag it onto
// the slots) and it goes into the next slot. The word in the machine window is always one string,
// so the browser shapes it and letters join as on a page — including ا د ذ ر ز و, which never
// join forward. Only the letter order counts for learning; speed is never judged.

import { play, preloadAudio, say, sfx } from '../audio';
import { GameShell } from '../core/shell';
import { logAttempt } from '../progress';
import { LETTERS, WORDS, type Word, wordAudio, wordImage } from '../data/arabic';
import { FACTORY_AUDIO, FACTORY_WORD, type FactoryStage, lookAlikes, tileAudio, tileName } from '../data/factory';
import './style.css';

const BASE = import.meta.env.BASE_URL;

export interface FactoryOptions {
  child: string;
  stage: FactoryStage;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

const images = new Map<string, HTMLImageElement>();
const picSrc = (wd: Word) => `${BASE}assets/${wordImage(wd)}`;

function loadImg(src: string) {
  return new Promise<void>((res) => {
    if (images.has(src)) return res();
    const im = new Image();
    im.onload = () => res();
    im.onerror = () => res();
    im.src = src;
    images.set(src, im);
  });
}

/** Audio, fonts and pictures; pass the stage to fetch only its pictures. */
export function preloadFactory(stage?: FactoryStage) {
  const words = stage ? stage.words.flatMap((id) => FACTORY_WORD.get(id) ?? []) : WORDS;
  const font = (f: string) => document.fonts.load(f).catch(() => []);
  return Promise.all([
    preloadAudio(FACTORY_AUDIO),
    font('700 60px "Noto Naskh Arabic"'),
    font('800 24px "Baloo Bhaijaan 2"'),
    ...words.map((wd) => loadImg(picSrc(wd))),
  ]);
}

const INTRO = 'أهلًا في مصنع الكلمات! ركّب الكلمة من الحروف بالترتيب';
const WRONG = 'ليس هذا الحرف… استمع مرة أخرى';
const ZWJ = '‍'; // keeps the last placed letter in its joining form while the word is unfinished
const GAP = 'ـــ'; // tatweel: the missing letter's place, joined to its neighbours
const NO_JOIN = new Set(['ا', 'أ', 'إ', 'آ', 'د', 'ذ', 'ر', 'ز', 'و', 'ة', 'ء']);
const TILE_COLORS = 6;
const GEAR = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38.2" fill="none" stroke="currentColor" stroke-width="16" stroke-dasharray="12 8"/><circle cx="50" cy="50" r="31" fill="currentColor"/><circle cx="50" cy="50" r="11" fill="rgba(0,0,0,0.28)"/></svg>`;
const SPEAKER = `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
let introPlayed = false;

const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** The vowelled word cut into letters with their harakat, one piece per letter of `spell`. */
function clustersOf(wd: Word) {
  const parts = wd.text.match(/.[ً-ٰٟ]*/gu) ?? [];
  return parts.length === wd.spell.length ? parts : [...wd.spell];
}

/** A picture of the word, or a bright card with the vowelled word while its image does not exist yet. */
function picture(wd: Word, cls: string) {
  const box = document.createElement('div');
  box.className = cls;
  const fallback = () => (box.innerHTML = `<div class="fac-fallback"><span>${wd.text}</span></div>`);
  const cached = images.get(picSrc(wd));
  if (cached?.complete && !cached.naturalWidth) fallback();
  else {
    const im = new Image();
    im.alt = '';
    im.draggable = false;
    im.onerror = fallback;
    im.src = picSrc(wd);
    box.appendChild(im);
  }
  return box;
}

const LETTER_CHARS = LETTERS.map((l) => l.char);

/** Look-alike letters (not in the word) first, then any other letters, `n` in all. */
function distractors(wd: Word, n: number, around = wd.spell) {
  const inWord = new Set(wd.spell);
  const near = shuffle(around.flatMap(lookAlikes));
  const far = shuffle(LETTER_CHARS);
  return [...new Set([...near, ...far])].filter((c) => !inWord.has(c)).slice(0, n);
}

interface Tile {
  char: string;
  color: number;
  el: HTMLElement;
  used: boolean;
}

export class FactoryGame {
  private o: FactoryOptions;
  private shell: GameShell;
  private el: Record<string, HTMLElement> = {};
  private words: Word[];
  // round
  private word: Word | null = null;
  private clusters: string[] = [];
  private filled: boolean[] = [];
  private slotEls: HTMLElement[] = [];
  private tiles: Tile[] = [];
  private roundNo = 0; // bumps every round so late voice callbacks can tell they are stale
  private tries = 0; // wrong tiles offered for this word
  private help = 0;
  private wrongAt: number[] = [];
  private wrongSpoken = false;
  private roundStart = 0;
  private busy = true; // true while tiles ride in or the machine is producing
  private drag: { t: Tile; id: number; x0: number; y0: number; moved: boolean } | null = null;
  private product: HTMLElement | null = null;
  private resumers: (() => void)[] = [];

  constructor(root: HTMLElement, opts: FactoryOptions) {
    this.o = opts;
    this.shell = new GameShell({
      root,
      kind: 'factory',
      child: opts.child,
      stageId: opts.stage.id,
      rounds: opts.stage.rounds,
      music: 'music/fish',
      doneTitle: 'إنتاج رائع!',
      onExit: opts.onExit,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
      onPause: (p) => this.onPause(p),
      onReplay: () => this.replay(),
    });
    this.words = this.pickWords();
    this.build();
    if (import.meta.env.DEV) (window as unknown as { __factory: FactoryGame }).__factory = this;
    void this.start();
  }

  destroy() {
    this.resumers = [];
    this.shell.destroy();
  }

  private async start() {
    if (!introPlayed) {
      introPlayed = true;
      this.shell.bubble(INTRO, 5200);
      await say('factory/intro', INTRO);
    }
    if (this.shell.done) return;
    void this.newRound();
  }

  /** The stage's words in a fresh order, repeated if the stage has fewer words than rounds. */
  private pickWords() {
    const known = this.o.stage.words.map((id) => FACTORY_WORD.get(id)).filter((wd): wd is Word => !!wd);
    const pool = known.length ? known : WORDS;
    const out: Word[] = [];
    while (out.length < this.o.stage.rounds) out.push(...shuffle(pool));
    return out;
  }

  // ---------- scene ----------

  private build() {
    const s = this.shell.stage;
    s.innerHTML = `
      <div class="fac-scene" dir="rtl">
        <div class="fac-main">
          <div class="fac-order">
            <div class="fac-frame"></div>
            <button class="hud-btn fac-speak" aria-label="اسمع الكلمة">${SPEAKER}</button>
          </div>
          <div class="fac-machine">
            <div class="fac-chimney"><i></i><i></i><i></i></div>
            <i class="fac-pipe l"></i><i class="fac-pipe r"></i>
            <span class="fac-gear g1">${GEAR}</span><span class="fac-gear g2">${GEAR}</span>
            <div class="fac-body">
              <div class="fac-head"><span class="fac-lights"><i></i><i></i><i></i></span><b class="fac-plate">مصنع الكلمات</b><span class="fac-lights"><i></i><i></i><i></i></span></div>
              <div class="fac-window">
                <div class="fac-word"><span class="ghost"></span><span class="ink"></span></div>
                <div class="fac-slots"></div>
              </div>
            </div>
            <div class="fac-hatch"></div>
          </div>
        </div>
        <div class="fac-line"><div class="fac-tiles"></div></div>
      </div>`;
    const q = (sel: string) => s.querySelector(sel) as HTMLElement;
    this.el = {
      scene: q('.fac-scene'),
      frame: q('.fac-frame'),
      machine: q('.fac-machine'),
      window: q('.fac-window'),
      word: q('.fac-word'),
      ghost: q('.fac-word .ghost'),
      ink: q('.fac-word .ink'),
      slots: q('.fac-slots'),
      hatch: q('.fac-hatch'),
      line: q('.fac-line'),
      tiles: q('.fac-tiles'),
    };
    this.shell.press(q('.fac-speak'), () => this.replay());
    this.shell.press(this.el.frame, () => this.replay());
    // tiles are delegated: pointer capture keeps a dragged tile's events coming to this container
    const T = this.el.tiles;
    this.shell.listen(T, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.shell.listen(T, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.shell.listen(T, 'pointerup', (e) => this.onUp(e as PointerEvent, false));
    this.shell.listen(T, 'pointercancel', (e) => this.onUp(e as PointerEvent, true));
    this.shell.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
  }

  // ---------- rounds ----------

  private async newRound() {
    await this.whenRunning();
    if (this.shell.done) return;
    const wd = this.words[this.shell.round % this.words.length];
    const mode = this.o.stage.mode;
    this.roundNo++;
    this.word = wd;
    this.clusters = clustersOf(wd);
    this.tries = 0;
    this.help = 0;
    this.wrongSpoken = false;
    this.wrongAt = wd.spell.map(() => 0);
    this.filled = wd.spell.map(() => false);
    let chars = [...wd.spell];
    if (mode === 'missing') {
      const m = Math.floor(Math.random() * wd.spell.length);
      this.filled = wd.spell.map((_, i) => i !== m);
      chars = [wd.spell[m], ...distractors(wd, 2, [wd.spell[m]])];
    } else if (mode === 'build-hard') chars.push(...distractors(wd, 3));
    let order = shuffle(chars);
    // never deal the tiles already in reading order
    for (let g = 0; g < 6 && order.length > 1 && order.join('') === wd.spell.join(''); g++) order = shuffle(chars);

    this.el.frame.replaceChildren(picture(wd, 'fac-pic'));
    this.el.frame.classList.remove('in');
    void this.el.frame.offsetWidth;
    this.el.frame.classList.add('in');
    this.el.word.classList.remove('done');
    this.buildSlots();
    this.dealTiles(order);
    this.render();
    if (mode === 'model') this.shell.setTarget(wd.text);
    else this.shell.setTarget('؟', true);
    this.roundStart = performance.now();
    this.belt(900);
    play('sfx/reel', 0.45);
    setTimeout(() => (this.busy = false), 450);
    await say(wordAudio(wd), wd.text);
  }

  private buildSlots() {
    this.el.slots.innerHTML = this.word!.spell.map(() => '<div class="fac-slot"><span></span></div>').join('');
    this.slotEls = [...this.el.slots.children] as HTMLElement[];
    this.slotEls.forEach((s, i) => this.filled[i] && s.classList.add('given'));
  }

  private dealTiles(chars: string[]) {
    this.el.tiles.innerHTML = '';
    const first = Math.floor(Math.random() * TILE_COLORS);
    this.tiles = chars.map((char, i) => {
      const el = document.createElement('button');
      el.className = `fac-tile c${(first + i) % TILE_COLORS} arrive`;
      el.style.setProperty('--i', String(i));
      el.dataset.i = String(i);
      el.textContent = char;
      el.setAttribute('aria-label', tileName(char));
      el.addEventListener('animationend', () => el.classList.remove('arrive', 'shake'));
      this.el.tiles.appendChild(el);
      return { char, color: (first + i) % TILE_COLORS, el, used: false };
    });
  }

  /** Word in the window (one shaped string) and the slot row under it. */
  private render() {
    const wd = this.word!;
    const mode = this.o.stage.mode;
    const n = this.clusters.length;
    const done = this.filled.every(Boolean);
    let ink: string;
    let ghost = '';
    if (mode === 'missing' && !done) {
      ink = this.clusters.map((c, i) => (this.filled[i] ? c : GAP)).join('');
    } else {
      const k = this.filled.indexOf(false);
      const len = k === -1 ? n : k;
      ink = this.clusters.slice(0, len).join('');
      if (len > 0 && len < n && !NO_JOIN.has(wd.spell[len - 1])) ink += ZWJ;
      // the faint full word sits under the built part: the same glyphs, so they line up exactly
      if (mode === 'model' && !done) ghost = wd.text;
    }
    this.el.ink.textContent = ink;
    this.el.ghost.textContent = ghost;
    const next = this.filled.indexOf(false);
    this.slotEls.forEach((s, i) => {
      const full = this.filled[i];
      s.classList.toggle('full', full);
      s.classList.toggle('next', i === next);
      s.classList.toggle('model', !full && mode === 'model');
      (s.firstElementChild as HTMLElement).textContent = full || mode === 'model' ? wd.spell[i] : '';
    });
  }

  /** Run the belt fast for a moment (tiles riding in, a product rolling out). */
  private belt(ms: number) {
    const l = this.el.line;
    l.classList.add('run');
    setTimeout(() => l.classList.remove('run'), ms);
  }

  // ---------- input ----------

  private tileAt(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.fac-tile');
    return b ? this.tiles[Number(b.dataset.i)] : undefined;
  }

  private onDown(e: PointerEvent) {
    const t = this.tileAt(e);
    if (!t) return;
    e.preventDefault();
    if (this.shell.paused || this.shell.done || t.used || this.drag) return;
    this.drag = { t, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
    t.el.setPointerCapture(e.pointerId);
    t.el.classList.add('held');
    play(tileAudio(t.char), 0.45);
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) > 12) {
      d.moved = true;
      d.t.el.classList.add('dragging');
    }
    if (d.moved) d.t.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.1)`;
  }

  private onUp(e: PointerEvent, cancelled: boolean) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.t.el.classList.remove('held', 'dragging');
    if (cancelled || this.shell.paused) return this.home(d.t);
    // a tap places the tile; a drag places it only when dropped on the machine window
    if (!d.moved || this.overWindow(e.clientX, e.clientY)) this.offer(d.t);
    else this.home(d.t);
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat || this.shell.done) return;
    if (e.key === 'Escape') this.shell.setPaused(!this.shell.paused);
    else if (this.shell.paused) return;
    else if (e.key === ' ' || e.key === 'Enter') this.replay();
    else {
      // an Arabic keyboard can type the letters too
      const t = this.tiles.find((x) => !x.used && x.char === e.key);
      if (!t) return;
      play(tileAudio(t.char), 0.45);
      this.offer(t);
    }
    e.preventDefault();
  }

  private overWindow(x: number, y: number) {
    const r = this.el.window.getBoundingClientRect();
    const pad = 24;
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  }

  /** Slide a tile back to its place on the belt. */
  private home(t: Tile) {
    const el = t.el;
    if (!el.style.transform) return;
    el.style.transition = 'transform 0.25s cubic-bezier(0.2, 1.3, 0.4, 1)';
    el.style.transform = '';
    setTimeout(() => (el.style.transition = ''), 260);
  }

  private replay() {
    const wd = this.word;
    if (!wd || this.shell.paused || this.shell.done) return;
    if (!this.busy) this.help = Math.max(this.help, 1);
    this.shell.pulseCard();
    void say(wordAudio(wd), wd.text);
  }

  // ---------- judging ----------

  /** The child offers a tile for the next empty slot. */
  private offer(t: Tile) {
    if (this.busy || t.used || !this.word) return this.home(t);
    const i = this.filled.indexOf(false);
    if (i < 0) return this.home(t);
    if (t.char === this.word.spell[i]) this.place(t, i);
    else void this.reject(t, i);
  }

  private place(t: Tile, i: number) {
    t.used = true;
    this.filled[i] = true;
    this.fly(t, i);
    t.el.classList.remove('glow');
    t.el.classList.add('used');
    t.el.style.transform = '';
    this.tiles.forEach((x) => x.el.classList.remove('glow'));
    play('sfx/plop', 0.7);
    this.render();
    this.slotEls[i].classList.add('land');
    if (this.filled.every(Boolean)) void this.complete();
  }

  private async reject(t: Tile, i: number) {
    const wd = this.word!;
    const round = this.roundNo;
    this.tries++;
    this.wrongAt[i]++;
    this.log(false, wd.spell.map((c, k) => (k === i ? t.char : this.filled[k] ? c : '')).join(''));
    this.shell.wrong();
    this.home(t);
    t.el.classList.remove('shake');
    void t.el.offsetWidth;
    t.el.classList.add('shake');
    if (this.wrongAt[i] >= 2) {
      // help: the right tile glows
      this.help = 2;
      this.tiles.find((x) => !x.used && x.char === wd.spell[i])?.el.classList.add('glow');
    }
    if (this.wrongSpoken) return void say(wordAudio(wd), wd.text);
    this.wrongSpoken = true;
    this.shell.bubble(WRONG, 3200);
    await say('factory/wrong', WRONG);
    if (round !== this.roundNo || this.shell.done || this.shell.paused) return;
    await say(wordAudio(wd), wd.text);
  }

  /** The tile flies from the belt into its slot (a copy does the flying; the tile leaves a gap). */
  private fly(t: Tile, i: number) {
    const s = this.el.scene.getBoundingClientRect();
    const a = t.el.getBoundingClientRect();
    const b = this.slotEls[i].getBoundingClientRect();
    const c = document.createElement('div');
    c.className = `fac-tile fac-fly c${t.color}`;
    c.textContent = t.char;
    c.style.cssText = `left:${a.left - s.left}px;top:${a.top - s.top}px;width:${a.width}px;height:${a.height}px`;
    this.el.scene.appendChild(c);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const k = b.width / a.width;
    c.animate(
      [
        { transform: 'none' },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 40}px) scale(${(1 + k) / 2}) rotate(-8deg)`, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0.3 },
      ],
      { duration: 380, easing: 'ease-in-out' },
    ).onfinish = () => c.remove();
  }

  /** Word complete: the machine works, the object pops out, the word is said, then the cheer. */
  private async complete() {
    const wd = this.word!;
    const round = this.roundNo;
    this.busy = true;
    const independent = this.tries === 0 && this.help === 0;
    const firstTry = this.tries === 0;
    this.log(true, wd.spell.join(''));
    this.el.word.classList.add('done');
    this.el.machine.classList.add('working');
    play('sfx/reel', 0.6);
    this.shell.bubble('تمّ صنع الكلمة!', 1800);
    void say('factory/made', 'تمّ صنع الكلمة!');
    await wait(1300);
    if (this.shell.done || round !== this.roundNo) return;
    this.el.machine.classList.remove('working');
    sfx.whoosh();
    const p = this.popProduct();
    play('sfx/plop', 0.9);
    this.shell.burst(p.x, p.y, 50);
    await wait(350);
    await say(wordAudio(wd), wd.text);
    if (this.shell.done) return;
    const over = await this.shell.correct(independent, firstTry, p.x, p.y);
    if (this.shell.done) return;
    if (over) {
      this.shell.finish(`صنعت ${this.o.stage.rounds} كلمات`);
      return;
    }
    await this.whenRunning();
    this.shipProduct();
    await wait(350);
    void this.newRound();
  }

  private log(correct: boolean, answer: string) {
    logAttempt({
      child: this.o.child,
      activity: 'word-factory',
      stage: this.o.stage.id,
      item: this.word!.id,
      answer,
      correct,
      help: this.help,
      // which offer this was for the word: the n-th wrong tile is try n, the finished word is wrong + 1
      tries: correct ? this.tries + 1 : this.tries,
      ms: Math.round(performance.now() - this.roundStart),
    });
  }

  // ---------- product ----------

  /** The finished object pops out of the hatch and hangs over the machine; returns its centre in shell coordinates. */
  private popProduct() {
    const wd = this.word!;
    const s = this.el.scene.getBoundingClientRect();
    const r = this.shell.root.getBoundingClientRect();
    const h = this.el.hatch.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'fac-product';
    el.appendChild(picture(wd, 'fac-prod-pic'));
    const tag = document.createElement('div');
    tag.className = 'fac-prod-tag';
    tag.textContent = wd.text;
    el.appendChild(tag);
    this.el.scene.appendChild(el);
    const w = el.offsetWidth;
    const hh = el.offsetHeight;
    const fx = s.width / 2;
    const fy = Math.min(s.height - hh / 2 - 10, Math.max(hh / 2 + 100, s.height * 0.45));
    el.style.left = `${fx - w / 2}px`;
    el.style.top = `${fy - hh / 2}px`;
    const dx = h.left + h.width / 2 - s.left - fx;
    const dy = h.top + h.height / 2 - s.top - fy;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0 },
        { transform: 'translate(0, -26px) scale(1.12)', opacity: 1, offset: 0.65 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 650, easing: 'cubic-bezier(0.2, 1.2, 0.4, 1)', fill: 'backwards' },
    );
    this.product = el;
    return { x: s.left - r.left + fx, y: s.top - r.top + fy };
  }

  /** The product rolls off with the belt to make room for the next order. */
  private shipProduct() {
    const el = this.product;
    if (!el) return;
    this.product = null;
    this.belt(800);
    sfx.whoosh();
    el.animate([{ transform: 'none' }, { transform: `translate(${-window.innerWidth}px, 60px) rotate(-14deg) scale(0.55)`, opacity: 0.4 }], {
      duration: 650,
      easing: 'ease-in',
      fill: 'forwards',
    }).onfinish = () => el.remove();
  }

  // ---------- pause ----------

  private onPause(p: boolean) {
    this.shell.root.classList.toggle('paused', p);
    if (p && this.drag) {
      const t = this.drag.t;
      this.drag = null;
      t.el.classList.remove('held', 'dragging');
      this.home(t);
    }
    if (!p) {
      const r = this.resumers;
      this.resumers = [];
      r.forEach((f) => f());
    }
  }

  private whenRunning() {
    if (!this.shell.paused) return Promise.resolve();
    return new Promise<void>((res) => this.resumers.push(res));
  }
}
