// «ورشة الجمل» — the word factory's sibling for grade 4: the child gets a sentence cut into word
// tiles and puts them back in order. One gesture: tap a tile on the bench and it goes into the next
// empty slot (the first slot is on the right, where reading starts); tap a placed tile and it goes
// back. When every slot is full the order is checked: the main order or any other accepted order
// wins; otherwise the right-leading words stay, the rest return, and after two misses the next
// right word glows. Never timed: speed is not judged.

import { play, preloadAudio, say, sfx } from '../audio';
import { GameShell } from '../core/shell';
import { logAttempt } from '../progress';
import { G4_LINES, type BuildItem, type BuildStage } from '../data/g4';
import './style.css';

const BASE = import.meta.env.BASE_URL;

export interface BuilderOptions {
  child: string;
  stage: BuildStage;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

const LINES = ['g4/build-intro', 'g4/build-wrong', 'g4/build-made'] as const;
const AUDIO = [
  ...LINES,
  ...[1, 2, 3, 4, 5].map((i) => `race/cheer${i}`),
  'race/combo3',
  'race/combo5',
  'race/stage-done',
  'music/fish',
  ...['correct', 'star', 'combo', 'fanfare', 'applause', 'yay', 'fireworks', 'bump', 'plop', 'whoosh'].map((s) => `sfx/${s}`),
];

/** Audio and fonts the workshop needs before it opens. */
export function preloadBuilder() {
  const font = (f: string, t?: string) => document.fonts.load(f, t).catch(() => []);
  return Promise.all([
    preloadAudio(AUDIO),
    font('700 40px "Noto Naskh Arabic"', 'جملة'),
    font('800 24px "Baloo Bhaijaan 2"', 'ورشة'),
    new Promise<void>((res) => {
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = `${BASE}assets/chars/salem_body.png`;
    }),
  ]);
}

const line = (k: (typeof LINES)[number]) => say(k, G4_LINES[k]);
const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const TILE_COLORS = 6;
let introPlayed = false;

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);

/** How many leading words of `got` agree with `want`. */
function prefix(got: (string | null)[], want: string[]) {
  let k = 0;
  while (k < want.length && got[k] === want[k]) k++;
  return k;
}

interface Tile {
  word: string;
  color: number;
  el: HTMLButtonElement;
  /** slot index while placed, -1 on the bench */
  slot: number;
}

export class BuilderGame {
  private o: BuilderOptions;
  private shell: GameShell;
  private el: Record<string, HTMLElement> = {};
  private items: BuildItem[];
  // round
  private item: BuildItem | null = null;
  private orders: string[][] = [];
  private tiles: Tile[] = [];
  private slots: (number | null)[] = [];
  private slotEls: HTMLElement[] = [];
  private roundNo = 0; // bumps every round so late callbacks can tell they are stale
  private tries = 0; // checks made for this sentence
  private misses = 0;
  private help = 0;
  private wrongSpoken = false;
  private roundStart = 0;
  private busy = true;
  private resumers: (() => void)[] = [];

  constructor(root: HTMLElement, opts: BuilderOptions) {
    this.o = opts;
    this.shell = new GameShell({
      root,
      kind: 'builder',
      child: opts.child,
      stageId: opts.stage.id,
      rounds: opts.stage.rounds,
      music: 'music/fish',
      doneTitle: 'نجّار الجمل الماهر!',
      onExit: opts.onExit,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
      onPause: (p) => this.onPause(p),
      onReplay: () => this.replay(),
    });
    this.items = this.pickItems();
    this.build();
    this.shell.setTarget('رتّب الجملة');
    if (import.meta.env.DEV) (window as unknown as { __builder: BuilderGame }).__builder = this;
    void this.start();
  }

  destroy() {
    this.resumers = [];
    this.shell.destroy();
  }

  private async start() {
    // the tiles come in while the intro plays, so the child is never left looking at an empty board
    if (!introPlayed) {
      introPlayed = true;
      this.shell.bubble(G4_LINES['g4/build-intro'], 4200);
      void line('g4/build-intro');
    }
    if (this.shell.done) return;
    void this.newRound();
  }

  /** The stage's sentences in a fresh order, repeated if the stage has fewer sentences than rounds. */
  private pickItems() {
    const pool = this.o.stage.items;
    const out: BuildItem[] = [];
    while (out.length < this.o.stage.rounds && pool.length) out.push(...shuffle(pool));
    return out;
  }

  // ---------- scene ----------

  private build() {
    const s = this.shell.stage;
    s.innerHTML = `
      <div class="bld-scene" dir="rtl">
        <div class="bld-wall"><i class="bld-tool saw"></i><i class="bld-tool ruler"></i><i class="bld-tool hammer"></i></div>
        <img class="bld-salem" src="${BASE}assets/chars/salem_body.png" alt="" draggable="false">
        <div class="bld-main">
          <div class="bld-board">
            <div class="bld-sign"><i class="l"></i><i class="r"></i><b>ورشة الجمل</b></div>
            <span class="bld-bolt a"></span><span class="bld-bolt b"></span><span class="bld-bolt c"></span><span class="bld-bolt d"></span>
            <div class="bld-paper">
              <div class="bld-slots"></div>
              <p class="bld-sentence" aria-live="polite"></p>
            </div>
            <div class="bld-stamp">✔</div>
          </div>
        </div>
        <div class="bld-bench"><div class="bld-tray"></div></div>
      </div>`;
    const q = (sel: string) => s.querySelector(sel) as HTMLElement;
    this.el = {
      scene: q('.bld-scene'),
      board: q('.bld-board'),
      paper: q('.bld-paper'),
      slots: q('.bld-slots'),
      sentence: q('.bld-sentence'),
      tray: q('.bld-tray'),
      salem: q('.bld-salem'),
    };
    // delegated presses: tiles are rebuilt every round
    this.shell.listen(this.el.tray, 'pointerdown', (e) => this.onTray(e as PointerEvent));
    this.shell.listen(this.el.slots, 'pointerdown', (e) => this.onSlot(e as PointerEvent));
    this.shell.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
  }

  // ---------- rounds ----------

  private async newRound() {
    await this.whenRunning();
    if (this.shell.done) return;
    const it = this.items[this.shell.round % this.items.length];
    this.roundNo++;
    this.item = it;
    this.orders = [it.words, ...it.alts];
    this.tries = 0;
    this.misses = 0;
    this.help = 0;
    this.wrongSpoken = false;
    this.slots = it.words.map(() => null);

    let order = shuffle(it.words);
    // never deal the bench already in an accepted order
    for (let g = 0; g < 12 && order.length > 1 && this.orders.some((o) => same(o, order)); g++) order = shuffle(it.words);

    const b = this.el.board;
    b.classList.remove('won', 'out', 'shake');
    this.el.sentence.textContent = '';
    this.el.paper.classList.remove('done');
    this.buildSlots();
    this.dealTiles(order);
    this.render();
    b.classList.remove('in');
    void b.offsetWidth;
    b.classList.add('in');
    sfx.whoosh();
    this.roundStart = performance.now();
    const round = this.roundNo;
    setTimeout(() => {
      if (round !== this.roundNo) return;
      this.busy = false;
      this.render();
    }, 380);
  }

  private buildSlots() {
    this.el.slots.innerHTML = this.slots.map((_, i) => `<div class="bld-slot" data-s="${i}"></div>`).join('');
    this.slotEls = [...this.el.slots.children] as HTMLElement[];
  }

  private dealTiles(words: string[]) {
    const tray = this.el.tray;
    tray.innerHTML = '';
    const first = Math.floor(Math.random() * TILE_COLORS);
    this.tiles = words.map((word, i) => {
      const el = document.createElement('button');
      el.className = `bld-tile c${(first + i) % TILE_COLORS} arrive`;
      el.style.setProperty('--i', String(i));
      el.dataset.t = String(i);
      el.textContent = word;
      el.addEventListener('animationend', (e) => {
        if (e.target === el && e.animationName !== 'bld-glow') el.classList.remove('arrive', 'back');
      });
      tray.appendChild(el);
      return { word, color: (first + i) % TILE_COLORS, el, slot: -1 };
    });
  }

  /** Slots show their placed tiles; the next empty one pulses. */
  private render() {
    const next = this.slots.indexOf(null);
    this.slotEls.forEach((s, i) => {
      const t = this.slots[i];
      s.classList.toggle('full', t !== null);
      s.classList.toggle('next', i === next && !this.busy);
      const cur = s.firstElementChild as HTMLElement | null;
      if (t === null) {
        cur?.remove();
        return;
      }
      if (cur && cur.dataset.t === String(t)) return;
      const tile = this.tiles[t];
      const el = document.createElement('button');
      el.className = `bld-tile placed c${tile.color}`;
      el.dataset.t = String(t);
      el.textContent = tile.word;
      s.replaceChildren(el);
    });
    this.tiles.forEach((t) => t.el.classList.toggle('used', t.slot >= 0));
  }

  // ---------- input ----------

  private onTray(e: PointerEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.bld-tile');
    if (!b) return;
    e.preventDefault();
    if (this.shell.paused || this.shell.done || this.busy) return;
    const t = this.tiles[Number(b.dataset.t)];
    if (t && t.slot < 0) this.place(t);
  }

  private onSlot(e: PointerEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.bld-tile');
    if (!b) return;
    e.preventDefault();
    if (this.shell.paused || this.shell.done || this.busy) return;
    const t = this.tiles[Number(b.dataset.t)];
    if (t && t.slot >= 0) this.unplace(t);
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat || this.shell.done) return;
    if (e.key === 'Escape') this.shell.setPaused(!this.shell.paused);
    else if (this.shell.paused || this.busy) return;
    else if (e.key === 'Backspace') {
      // take back the last filled slot
      for (let i = this.slots.length - 1; i >= 0; i--) {
        const t = this.slots[i];
        if (t !== null) {
          this.unplace(this.tiles[t]);
          break;
        }
      }
    } else if (e.key === ' ' || e.key === 'Enter') this.replay();
    else return;
    e.preventDefault();
  }

  private replay() {
    if (this.shell.paused || this.shell.done) return;
    this.shell.pulseCard();
    void line('g4/build-intro');
  }

  // ---------- moving tiles ----------

  private place(t: Tile) {
    const i = this.slots.indexOf(null);
    if (i < 0) return;
    const from = t.el.getBoundingClientRect();
    this.slots[i] = this.tiles.indexOf(t);
    t.slot = i;
    t.el.classList.remove('glow');
    this.render();
    const placed = this.slotEls[i].firstElementChild as HTMLElement;
    this.fly(t, from, placed);
    play('sfx/plop', 0.7);
    this.slotEls[i].classList.remove('land');
    void this.slotEls[i].offsetWidth;
    this.slotEls[i].classList.add('land');
    if (this.slots.every((x) => x !== null)) void this.check();
    else this.guide();
  }

  private unplace(t: Tile, quiet = false) {
    const i = t.slot;
    if (i < 0) return;
    const placed = this.slotEls[i].firstElementChild as HTMLElement | null;
    const from = placed?.getBoundingClientRect();
    this.slots[i] = null;
    t.slot = -1;
    this.render();
    if (from) this.fly(t, from, t.el);
    t.el.classList.remove('back');
    void t.el.offsetWidth;
    t.el.classList.add('back');
    if (!quiet) {
      sfx.whoosh();
      this.guide();
    }
  }

  /** A copy of the tile flies from `from` to where `to` sits; the target fades in under it. */
  private fly(t: Tile, from: DOMRect, to: HTMLElement) {
    const s = this.el.scene.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const c = document.createElement('div');
    c.className = `bld-tile bld-fly c${t.color}`;
    c.textContent = t.word;
    c.style.cssText = `left:${from.left - s.left}px;top:${from.top - s.top}px;width:${from.width}px;height:${from.height}px`;
    this.el.scene.appendChild(c);
    const dx = b.left + b.width / 2 - (from.left + from.width / 2);
    const dy = b.top + b.height / 2 - (from.top + from.height / 2);
    const k = b.width / Math.max(1, from.width);
    to.style.opacity = '0';
    const anim = c.animate(
      [
        { transform: 'none' },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 34}px) scale(${(1 + k) / 2 + 0.08}) rotate(${dy < 0 ? -6 : 6}deg)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})` },
      ],
      { duration: 340, easing: 'ease-in-out' },
    );
    anim.onfinish = anim.oncancel = () => {
      c.remove();
      to.style.opacity = '';
    };
  }

  /** After two misses the bench tile for the next right word glows (when the words so far are right). */
  private guide() {
    this.tiles.forEach((t) => t.el.classList.remove('glow'));
    if (this.misses < 2 || !this.item) return;
    const got = this.slots.map((t) => (t === null ? null : this.tiles[t].word));
    const next = this.slots.indexOf(null);
    if (next < 0) return;
    const best = this.bestOrder(got);
    if (prefix(got, best) < next) return;
    this.tiles.find((t) => t.slot < 0 && t.word === best[next])?.el.classList.add('glow');
  }

  /** The accepted order that agrees longest with the start of `got` (the main order on ties). */
  private bestOrder(got: (string | null)[]) {
    let best = this.orders[0];
    let n = prefix(got, best);
    for (const o of this.orders.slice(1)) {
      const k = prefix(got, o);
      if (k > n) {
        n = k;
        best = o;
      }
    }
    return best;
  }

  // ---------- judging ----------

  private async check() {
    const round = this.roundNo;
    this.busy = true;
    this.render();
    await wait(380);
    await this.whenRunning();
    if (round !== this.roundNo || this.shell.done) return;
    const got = this.slots.map((t) => this.tiles[t!].word);
    this.tries++;
    if (this.orders.some((o) => same(o, got))) return void this.success(got);

    this.misses++;
    this.log(false, got);
    this.shell.wrong();
    const b = this.el.board;
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('shake');
    this.slotEls.forEach((s) => s.classList.add('bad'));
    if (this.misses >= 2) this.help = 2;
    if (!this.wrongSpoken) {
      this.wrongSpoken = true;
      this.shell.bubble(G4_LINES['g4/build-wrong'], 3000);
      void line('g4/build-wrong');
    }
    await wait(650);
    if (round !== this.roundNo || this.shell.done) return;
    await this.whenRunning();
    this.slotEls.forEach((s) => s.classList.remove('bad'));
    // keep the leading words that start an accepted order; the rest go back to the bench
    const keep = prefix(got, this.bestOrder(got));
    for (let i = this.slots.length - 1; i >= keep; i--) {
      const t = this.slots[i];
      if (t !== null) this.unplace(this.tiles[t], true);
    }
    sfx.whoosh();
    this.busy = false;
    this.render();
    this.guide();
  }

  private async success(got: string[]) {
    const round = this.roundNo;
    const independent = this.misses === 0 && this.help === 0;
    const firstTry = this.misses === 0;
    this.log(true, got);
    this.tiles.forEach((t) => t.el.classList.remove('glow'));
    const b = this.el.board;
    b.classList.add('won');
    this.el.sentence.textContent = got.join(' ');
    this.el.paper.classList.add('done');
    this.el.salem.classList.remove('cheer');
    void this.el.salem.offsetWidth;
    this.el.salem.classList.add('cheer');
    play('sfx/star', 0.7);
    const r = this.shell.root.getBoundingClientRect();
    const p = this.el.paper.getBoundingClientRect();
    const x = p.left - r.left + p.width / 2;
    const y = p.top - r.top + p.height / 2;
    this.shell.burst(x, y, 60);
    this.shell.bubble(G4_LINES['g4/build-made'], 2000);
    await line('g4/build-made');
    await this.whenRunning();
    if (this.shell.done || round !== this.roundNo) return;
    const over = await this.shell.correct(independent, firstTry, x, y);
    if (this.shell.done) return;
    if (over) {
      this.shell.finish(`رتّبت ${this.o.stage.rounds} جمل`);
      return;
    }
    await this.whenRunning();
    b.classList.add('out');
    sfx.whoosh();
    await wait(420);
    void this.newRound();
  }

  private log(correct: boolean, got: string[]) {
    logAttempt({
      child: this.o.child,
      activity: 'build-sentence',
      stage: this.o.stage.id,
      item: this.item!.words.join(' '),
      answer: got.join(' '),
      correct,
      help: this.help,
      tries: this.tries,
      ms: Math.round(performance.now() - this.roundStart),
    });
  }

  // ---------- pause ----------

  private onPause(p: boolean) {
    this.shell.root.classList.toggle('paused', p);
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
