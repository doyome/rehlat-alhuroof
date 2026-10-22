// «مكتب الفرز» — a card (a word or a short sentence) rides in on the conveyor; the child drops it into
// the crate with the right label (اسم / فعل / حرف, جملة اسمية / فعلية …). One tap on a crate posts the
// card there; dragging the card onto a crate works too. Crates keep their place and label for the whole
// stage, and each sorted card stays visible in its crate. Only the chosen crate counts for learning;
// time is logged, never judged. Plain DOM + CSS inside the GameShell stage, sized in JS on resize.

import './style.css';
import { play, preloadAudio, say, sfx } from '../audio';
import { GameShell } from '../core/shell';
import { logAttempt } from '../progress';
import { G4_LINES, type SortItem, type SortStage } from '../data/g4';

export interface SortOptions {
  child: string;
  stage: SortStage;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

const SORT_AUDIO = [
  'g4/sort-intro', 'g4/sort-wrong',
  'race/cheer1', 'race/cheer2', 'race/cheer3', 'race/cheer4', 'race/cheer5',
  'race/combo3', 'race/combo5', 'race/stage-done',
  'sfx/correct', 'sfx/star', 'sfx/combo', 'sfx/fanfare', 'sfx/applause', 'sfx/yay', 'sfx/fireworks',
  'sfx/bump', 'sfx/plop', 'sfx/whoosh',
];

const NASKH = '"Noto Naskh Arabic"';
const BALOO = '"Baloo Bhaijaan 2"';

export function preloadSort(): Promise<unknown> {
  const font = (f: string, t: string) => document.fonts.load(f, t).catch(() => []);
  return Promise.all([
    preloadAudio(SORT_AUDIO),
    font(`700 80px ${NASKH}`, 'كَتَبَ سالِمٌ'),
    font(`800 32px ${BALOO}`, 'اسم فعل حرف'),
  ]);
}

const INTRO = G4_LINES['g4/sort-intro'];
const WRONG = G4_LINES['g4/sort-wrong'];
const COLORS = ['coral', 'sky', 'lime', 'violet'] as const;
const FLAGS = ['#ff6b5b', '#ffd23f', '#3fa9f5', '#4cc46a', '#b06cf0', '#ff9f43'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const shuffle = <T>(a: T[]) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};
const center = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// ---------- text fitting: biggest font that fits a box, breaking between words into 1–3 lines ----------

const measure = document.createElement('canvas').getContext('2d')!;

interface Fit {
  lines: string[];
  fs: number;
}

/** Split `ws` (word widths) into `n` lines so the widest line is as narrow as possible. */
function splitLines(words: string[], ws: number[], space: number, n: number): { text: string; w: number }[] {
  let best: { text: string; w: number }[] = [];
  let bestW = Infinity;
  const go = (start: number, left: number, acc: { text: string; w: number }[]) => {
    if (left === 1) {
      const w = ws.slice(start).reduce((s, x) => s + x, 0) + space * (words.length - start - 1);
      const lines = [...acc, { text: words.slice(start).join(' '), w }];
      const m = Math.max(...lines.map((l) => l.w));
      if (m < bestW) {
        bestW = m;
        best = lines;
      }
      return;
    }
    // leave at least one word for each remaining line
    for (let end = start + 1; end <= words.length - (left - 1); end++) {
      const w = ws.slice(start, end).reduce((s, x) => s + x, 0) + space * (end - start - 1);
      if (w >= bestW) break;
      go(end, left - 1, [...acc, { text: words.slice(start, end).join(' '), w }]);
    }
  };
  go(0, n, []);
  return best;
}

function fitText(text: string, font: string, boxW: number, boxH: number, maxFs: number, lh: number, maxLines: number): Fit {
  const words = text.split(/\s+/).filter(Boolean);
  measure.font = font.replace('$', '100px'); // `font` has a '$' where the size goes
  const space = measure.measureText(' ').width;
  const ws = words.map((w) => measure.measureText(w).width);
  let best: Fit = { lines: [text], fs: 0 };
  for (let n = 1; n <= Math.min(maxLines, words.length); n++) {
    const lines = splitLines(words, ws, space, n);
    if (!lines.length) continue;
    const wMax = Math.max(1, ...lines.map((l) => l.w));
    const fs = Math.min(maxFs, (boxW / wMax) * 100, boxH / (n * lh));
    // one line reads best: take more lines only when they make the text clearly bigger
    if (fs > best.fs * 1.12) best = { lines: lines.map((l) => l.text), fs };
  }
  best.fs = Math.max(10, Math.floor(best.fs));
  return best;
}

function renderLines(el: HTMLElement, fit: Fit) {
  el.innerHTML = '';
  for (const l of fit.lines) {
    const s = document.createElement('span');
    s.textContent = l;
    el.appendChild(s);
  }
  el.style.fontSize = `${fit.fs}px`;
}

// ---------- the game ----------

interface Bin {
  el: HTMLButtonElement;
  body: HTMLElement;
  mouth: HTMLElement;
  pile: HTMLElement;
  plaque: HTMLElement;
  count: HTMLElement;
  label: string;
  index: number;
  got: number;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  moved: boolean;
  over: Bin | null;
}

export class SortGame {
  private o: SortOptions;
  private shell: GameShell;
  private so!: HTMLElement;
  private belt!: HTMLElement;
  private bunting!: HTMLElement;
  private card!: HTMLButtonElement;
  private face!: HTMLElement;
  private text!: HTMLElement;
  private bins: Bin[] = [];
  private cw = 300; // card width
  private ch = 120; // card height
  private bw = 120; // crate width
  private bh = 130; // crate height
  // rounds
  private plan: SortItem[];
  private item: SortItem | null = null;
  private tries = 0;
  private help = 0;
  private roundStart = 0;
  private sorted = 0;
  private busy = true; // true while voices/animations own the scene
  private drag: Drag | null = null;
  private dead = false;
  private introDone = false;
  private hintTimer = 0;
  private waiters: (() => void)[] = [];

  constructor(root: HTMLElement, opts: SortOptions) {
    this.o = opts;
    this.shell = new GameShell({
      root,
      kind: 'sort',
      child: opts.child,
      stageId: opts.stage.id,
      rounds: opts.stage.rounds,
      doneTitle: 'أحسنت يا بطل الفرز!',
      onExit: opts.onExit,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
      onPause: (p) => !p && this.resumed(),
      onReplay: () => this.replay(),
    });
    this.plan = this.buildPlan();
    this.build();
    this.shell.setTarget(opts.stage.ask);
    this.layout();
    this.shell.listen(window, 'resize', () => this.layout());
    void document.fonts.ready.then(() => !this.dead && this.layout());
    if (import.meta.env.DEV) (window as unknown as { __sort: SortGame }).__sort = this;
    void this.newRound();
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.hintTimer);
    this.resumed();
    this.shell.destroy();
  }

  // ---------- scene ----------

  private build() {
    const s = this.shell.stage;
    s.innerHTML = `
      <div class="so" dir="rtl">
        <div class="so-head"><i class="so-beams"></i><div class="so-bunting"></div></div>
        <div class="so-beam">
          <div class="so-sign"><svg viewBox="0 0 40 28" aria-hidden="true"><rect class="a" x="2" y="16" width="10" height="10" rx="2"/><rect class="b" x="15" y="16" width="10" height="10" rx="2"/><rect class="c" x="28" y="16" width="10" height="10" rx="2"/><path d="M20 2v7M20 9L7 14M20 9l13 5M20 9v5"/></svg><span>مكتب الفرز</span></div>
        </div>
        <div class="so-line">
          <div class="so-belt">
            <i class="so-roller"></i><i class="so-roller end"></i>
            <button class="sc" aria-label="البطاقة">
              <span class="sc-face">
                <svg class="sc-clip" viewBox="0 0 24 60" aria-hidden="true"><path d="M8 52V14a6 6 0 0 1 12 0v36a9 9 0 0 1-18 0V18"/></svg>
                <span class="sc-text" dir="rtl"></span>
              </span>
            </button>
            <div class="so-mach" aria-hidden="true">
              <i class="so-lamp"></i>
              <i class="so-dial"><b></b></i>
              <i class="so-vents"></i>
              <i class="so-mouth"></i>
            </div>
          </div>
        </div>
        <div class="so-bins"></div>
        <div class="so-floor"></div>
      </div>`;
    const q = (sel: string) => s.querySelector(sel) as HTMLElement;
    this.so = q('.so');
    this.belt = q('.so-belt');
    this.bunting = q('.so-bunting');
    this.card = q('.sc') as HTMLButtonElement;
    this.face = q('.sc-face');
    this.text = q('.sc-text');
    const binsEl = q('.so-bins');
    this.o.stage.bins.forEach((label, i) => {
      const el = document.createElement('button');
      el.className = `bin ${COLORS[i % COLORS.length]}`;
      el.setAttribute('aria-label', `صندوق ${label}`);
      el.innerHTML = `
        <span class="bin-body">
          <span class="bin-back"></span>
          <span class="bin-pile"></span>
          <span class="bin-front">
            <span class="bin-handle"></span>
            <span class="bin-plaque"><b></b></span>
          </span>
          <span class="bin-count">0</span>
        </span>`;
      binsEl.appendChild(el);
      const bin: Bin = {
        el,
        body: el.querySelector('.bin-body') as HTMLElement,
        mouth: el.querySelector('.bin-back') as HTMLElement,
        pile: el.querySelector('.bin-pile') as HTMLElement,
        plaque: el.querySelector('.bin-plaque b') as HTMLElement,
        count: el.querySelector('.bin-count') as HTMLElement,
        label,
        index: i,
        got: 0,
      };
      this.bins.push(bin);
      this.shell.press(el, () => this.tapBin(bin));
    });
    const c = this.card;
    this.shell.listen(c, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.shell.listen(c, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.shell.listen(c, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.shell.listen(c, 'pointercancel', (e) => this.onUp(e as PointerEvent));
  }

  /** Size the room from the space we have: belt above a row of crates (belt beside them on a phone on its side). */
  private layout() {
    const W = this.shell.stage.clientWidth || window.innerWidth;
    const H = this.shell.stage.clientHeight || window.innerHeight;
    const n = this.bins.length;
    const portrait = H > W;
    const side = !portrait && H < 560 && W > H * 1.5;
    const head = clamp(H * 0.16, 112, 150); // keeps the HUD over the ceiling, never over a crate
    const sign = clamp(H * 0.055, 26, 46);
    const floor = clamp(H * 0.04, 12, 34);
    const gap = clamp(W * 0.025, 10, 30);
    const freeH = H - head - sign - floor - 16;
    let col = 0;
    if (side) {
      col = clamp(W * 0.36, 220, 420);
      this.cw = col - 28;
      this.ch = clamp(Math.min(this.cw * 0.48, freeH * 0.62), 76, 170);
      const binsW = W - col - 24;
      this.bw = clamp(Math.min((binsW - gap * (n - 1)) / n, freeH / 0.8, 260), 64, 260);
      this.bh = Math.min(freeH - 8, this.bw * 1.1);
    } else {
      this.cw = clamp(Math.min(W * (portrait ? 0.88 : 0.56), 620), 200, 620);
      this.ch = clamp(Math.min(this.cw * (portrait ? 0.46 : 0.36), freeH * 0.3, 210), 76, 210);
      const binsH = freeH - (this.ch + 40) - 16;
      this.bw = clamp(Math.min((W - 24 - gap * (n - 1)) / n, binsH / 0.75, n === 2 ? 320 : 300), 64, 320);
      this.bh = Math.min(binsH, this.bw * (portrait ? (n === 2 ? 1.3 : 1.6) : 1.05));
    }
    this.bh = Math.max(this.bh, 64);
    const mach = side ? 0 : Math.min((W - this.cw) / 2 - 18, 150);
    // the plaque sits in the crate front (which starts 22% down the crate)
    const ph = Math.min(this.bh * 0.78 * 0.48, this.bw * 0.52);
    const st = this.so.style;
    st.setProperty('--head', `${head}px`);
    st.setProperty('--sign', `${sign}px`);
    st.setProperty('--floor', `${floor}px`);
    st.setProperty('--gap', `${gap}px`);
    st.setProperty('--col', `${col}px`);
    st.setProperty('--cw', `${this.cw}px`);
    st.setProperty('--ch', `${this.ch}px`);
    st.setProperty('--bw', `${this.bw}px`);
    st.setProperty('--bh', `${this.bh}px`);
    st.setProperty('--ph', `${ph}px`);
    st.setProperty('--mach', `${Math.max(0, mach)}px`);
    this.so.classList.toggle('side', side);
    this.so.classList.toggle('has-mach', mach >= 70);
    // crate labels: one size for all crates so they read as a set
    const fits = this.bins.map((b) => fitText(b.label, `800 $ ${BALOO}`, this.bw * 0.86 - 26, ph - 8, Math.min(this.bw * 0.22, 40), 1.3, 3));
    const fs = Math.min(...fits.map((f) => f.fs));
    this.bins.forEach((b, i) => renderLines(b.plaque, { lines: fits[i].lines, fs }));
    this.drawBunting(W, head);
    if (this.item) this.fillCard(this.item);
    this.fitAsk(W);
  }

  /** Colourful pennants strung across the ceiling, one flag every ~46px. */
  private drawBunting(W: number, head: number) {
    const h = head * 0.42;
    const sag = h * 0.42;
    const count = Math.max(6, Math.round(W / 46));
    let flags = '';
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = t * W;
      const y = 4 + sag * 4 * t * (1 - t);
      const fw = Math.min(30, (W / count) * 0.7);
      flags += `<path d="M${(x - fw / 2).toFixed(1)} ${y.toFixed(1)}L${(x + fw / 2).toFixed(1)} ${y.toFixed(1)}L${x.toFixed(1)} ${(y + h * 0.52).toFixed(1)}Z" fill="${FLAGS[i % FLAGS.length]}"/>`;
    }
    this.bunting.innerHTML = `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" aria-hidden="true"><path d="M0 4Q${W / 2} ${4 + sag * 2} ${W} 4" fill="none" stroke="#fff6dc" stroke-width="2.5"/>${flags}</svg>`;
  }

  /** The HUD card shows the stage question, which is long: fit it beside the stars (or move the stars aside). */
  private fitAsk(W: number) {
    const root = this.shell.root;
    const small = window.innerWidth <= 600; // the shell's phone sizes
    const btn = small ? 50 : 58;
    const cardH = small ? 74 : 96;
    const ask = this.o.stage.ask;
    const stars = this.shell.hud.querySelector('.stars') as HTMLElement | null;
    root.classList.remove('stars-left');
    let leftLimit = 14 + btn + 12; // right of the pause button
    if (!small && stars) {
      const rr = root.getBoundingClientRect();
      const sr = stars.getBoundingClientRect();
      const centred = sr.right - rr.left + 14;
      const free = W - 12 - btn - 10 - centred;
      measure.font = `700 30px ${NASKH}`;
      const want = Math.min(measure.measureText(ask).width + 40, 340);
      if (free >= want) leftLimit = centred;
      else {
        // not enough room next to centred stars: the stars sit beside the pause button instead
        root.classList.add('stars-left');
        leftLimit = 14 + btn + 12 + sr.width + 14;
      }
    }
    const maxW = clamp(W - 12 - btn - 10 - leftLimit, 120, 460);
    const fit = fitText(ask, `700 $ ${NASKH}`, maxW - 36, cardH - 16, small ? 30 : 38, 1.45, 2);
    const st = root.style;
    st.setProperty('--ask-w', `${maxW}px`);
    renderLines(this.shell.el.syl, fit);
  }

  private fillCard(it: SortItem) {
    const fit = fitText(it.text, `700 $ ${NASKH}`, this.cw * 0.86, this.ch * 0.72, this.ch * 0.46, 1.6, 3);
    renderLines(this.text, fit);
    this.card.setAttribute('aria-label', `البطاقة: ${it.text}`);
  }

  private addToPile(bin: Bin) {
    bin.got++;
    const c = document.createElement('i');
    c.className = 'pc';
    c.style.setProperty('--r', `${(Math.random() * 14 - 7).toFixed(1)}deg`);
    c.style.setProperty('--x', `${(Math.random() * 24 - 12).toFixed(1)}%`);
    bin.pile.appendChild(c);
    while (bin.pile.children.length > 5) bin.pile.firstElementChild?.remove();
    bin.count.textContent = String(bin.got);
    bin.count.classList.remove('pop');
    void bin.count.offsetWidth;
    bin.count.classList.add('pop', 'on');
  }

  private setReady(on: boolean) {
    clearTimeout(this.hintTimer);
    this.so.classList.toggle('ready', on);
    if (on) this.hintTimer = window.setTimeout(() => this.so.classList.remove('ready'), 1800);
  }

  // ---------- input ----------

  private onDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (this.shell.paused || this.shell.done || this.busy || this.drag) return;
    this.card.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false, over: null };
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(d.dx, d.dy) > 10) {
      d.moved = true;
      this.setReady(false);
      this.card.classList.add('drag');
      this.face.classList.remove('wobble', 'arrive');
    }
    if (!d.moved) return;
    // the card shrinks a little as it leaves the belt so the crates stay in view under the finger
    const s = clamp(1 - Math.hypot(d.dx, d.dy) / 900, Math.max(0.55, Math.min(1, (this.bw * 1.2) / this.cw)), 1) * 1.04;
    this.card.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${clamp(d.dx * 0.03, -7, 7)}deg) scale(${s.toFixed(3)})`;
    const over = this.binAt(e.clientX, e.clientY);
    if (over !== d.over) {
      d.over?.el.classList.remove('over');
      over?.el.classList.add('over');
      d.over = over;
    }
    if (Math.random() < 0.35) {
      const r = this.shell.root.getBoundingClientRect();
      this.shell.sparkle(e.clientX - r.left, e.clientY - r.top, 280);
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.over?.el.classList.remove('over');
    this.card.classList.remove('drag');
    if (!d.moved) {
      if (e.type === 'pointerup') this.tapCard();
      return;
    }
    const from = this.card.style.transform;
    if (e.type === 'pointerup' && d.over && !this.shell.paused) void this.post(d.over, from);
    else void this.goHome(from);
  }

  private binAt(x: number, y: number) {
    const pad = this.bw * 0.12;
    for (const b of this.bins) {
      const r = b.el.getBoundingClientRect();
      if (x > r.left - pad && x < r.right + pad && y > r.top - pad * 1.5 && y < r.bottom + pad) return b;
    }
    return null;
  }

  /** Tapping the card: it wiggles and the crates bob, inviting a tap on one of them. */
  private tapCard() {
    if (this.busy || !this.item) return;
    sfx.tap();
    this.wobble();
    this.setReady(true);
  }

  /** Tapping a crate posts the card there: there is only ever one card, so one tap is enough. */
  private tapBin(bin: Bin) {
    if (this.busy || this.drag || this.shell.done || this.shell.paused) return;
    void this.post(bin, '');
  }

  /** The speaker / HUD card: say what to do again (an instruction, not a hint). */
  private replay() {
    if (this.shell.paused || this.shell.done) return;
    this.shell.pulseCard();
    this.shell.bubble(INTRO, 4500);
    void say('g4/sort-intro', INTRO);
  }

  // ---------- rounds ----------

  /**
   * The cards of the stage, decided up front: every crate is the answer at least once (when there are
   * enough rounds), no card twice in a row, and no crate three times in a row when that can be avoided.
   */
  private buildPlan(): SortItem[] {
    const { items, rounds, bins } = this.o.stage;
    const plan: SortItem[] = [];
    if (rounds >= bins.length)
      bins.forEach((_, b) => {
        const mine = items.filter((it) => it.bin === b);
        if (mine.length) plan.push(mine[Math.floor(Math.random() * mine.length)]);
      });
    let pool = shuffle(items.filter((it) => !plan.includes(it)));
    while (plan.length < rounds) {
      if (!pool.length) pool = shuffle(items);
      plan.push(pool.shift()!);
    }
    const score = (p: SortItem[]) =>
      p.reduce((s, it, i) => s + (i > 0 && p[i - 1].text === it.text ? 10 : 0) + (i > 1 && p[i - 1].bin === it.bin && p[i - 2].bin === it.bin ? 1 : 0), 0);
    let best = shuffle(plan);
    let bestScore = score(best);
    for (let k = 0; k < 80 && bestScore > 0; k++) {
      const p = shuffle(plan);
      const sc = score(p);
      if (sc < bestScore) {
        best = p;
        bestScore = sc;
      }
    }
    return best.slice(0, rounds);
  }

  private async newRound() {
    await this.untilResumed();
    if (this.dead || this.shell.done) return;
    this.busy = true;
    const it = this.plan[this.shell.round % this.plan.length];
    this.item = it;
    this.tries = 0;
    this.help = 0;
    this.bins.forEach((b) => b.el.classList.remove('got', 'glow', 'nope', 'over'));
    this.setReady(false);
    // a new card slides out of the sorting machine onto the belt
    this.fillCard(it);
    this.card.getAnimations().forEach((a) => a.cancel());
    this.card.style.transform = '';
    this.card.classList.remove('gone');
    this.face.classList.remove('arrive', 'wobble');
    const stageR = this.shell.stage.getBoundingClientRect();
    const cardR = this.card.getBoundingClientRect();
    this.face.style.setProperty('--from', `${Math.round(stageR.right - cardR.left + 20)}px`);
    void this.face.offsetWidth;
    this.face.classList.add('arrive');
    this.so.classList.add('moving');
    play('sfx/whoosh', 0.35);
    await wait(900);
    this.so.classList.remove('moving');
    if (this.dead) return;
    if (!this.introDone) {
      this.introDone = true;
      this.shell.bubble(INTRO, 6000);
      await say('g4/sort-intro', INTRO);
    }
    await this.untilResumed();
    if (this.dead || this.item !== it) return;
    this.roundStart = performance.now();
    this.busy = false;
  }

  /** The card goes to a crate: dropped inside when right, bounced back to the belt when not. */
  private async post(bin: Bin, from: string) {
    const it = this.item;
    if (!it || this.busy) return;
    this.busy = true;
    this.setReady(false);
    this.face.classList.remove('wobble', 'arrive');
    const correct = bin.index === it.bin;
    this.tries++;
    logAttempt({
      child: this.o.child,
      activity: 'sort',
      stage: this.o.stage.id,
      item: it.text,
      answer: bin.label,
      correct,
      help: this.help,
      tries: this.tries,
      ms: Math.round(performance.now() - this.roundStart),
    });
    const start = from || 'translate(0px, 0px) scale(1)';
    this.card.style.transform = '';
    const home = this.home();
    const mouth = center(bin.mouth);
    const tx = mouth.x - home.x;
    const ty = mouth.y - home.y;
    const s1 = clamp((this.bw * 0.82) / this.cw, 0.18, 1);
    const above = `translate(${tx}px, ${ty - this.bh * 0.42}px) scale(${s1.toFixed(3)})`;
    if (correct) {
      sfx.whoosh();
      await this.animate([
        { transform: start, opacity: 1 },
        { transform: `${above} rotate(-5deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${tx}px, ${ty - this.bh * 0.3}px) scale(${s1.toFixed(3)}) rotate(4deg)`, opacity: 1, offset: 0.72 },
        { transform: `translate(${tx}px, ${ty + this.bh * 0.16}px) scale(${(s1 * 0.85).toFixed(3)})`, opacity: 0 },
      ], 780, 'ease-in-out');
      if (this.dead) return;
      this.card.classList.add('gone');
      play('sfx/plop', 0.9);
      bin.el.classList.remove('glow');
      void bin.el.offsetWidth;
      bin.el.classList.add('got');
      this.addToPile(bin);
      const r = this.shell.root.getBoundingClientRect();
      const x = mouth.x - r.left;
      const y = mouth.y - r.top;
      this.shell.burst(x, y, 34);
      await this.untilResumed();
      if (this.dead) return;
      const over = await this.shell.correct(this.tries === 1 && this.help === 0, this.tries === 1, x, y);
      if (this.dead) return;
      this.sorted++;
      if (over) this.shell.finish(`فرزت ${this.sorted} ${this.sorted >= 3 && this.sorted <= 10 ? 'بطاقات' : 'بطاقة'}`);
      else {
        await wait(350);
        void this.newRound();
      }
      return;
    }
    // wrong: the card bumps the crate and bounces back to the belt
    let at = start;
    if (!from) {
      at = `translate(${tx}px, ${ty - this.bh * 0.12}px) scale(${s1.toFixed(3)})`;
      await this.animate([{ transform: start }, { transform: above, offset: 0.6 }, { transform: at }], 460, 'ease-in');
      if (this.dead) return;
    }
    this.shell.wrong();
    bin.el.classList.remove('nope');
    void bin.el.offsetWidth;
    bin.el.classList.add('nope');
    await this.goHome(at);
    if (this.dead) return;
    if (this.tries >= 2) {
      this.help = 2;
      this.bins[it.bin]?.el.classList.add('glow');
    }
    this.shell.bubble(WRONG, 3600);
    await say('g4/sort-wrong', WRONG);
    await this.untilResumed();
    if (this.dead || this.item !== it) return;
    this.busy = false;
  }

  /** Spring back to the belt from wherever the card is. */
  private async goHome(from: string) {
    this.card.style.transform = '';
    await this.animate([
      { transform: from || 'translate(0px, 0px) scale(1)' },
      { transform: `translate(0px, ${-this.ch * 0.5}px) scale(1.02) rotate(-4deg)`, offset: 0.6 },
      { transform: 'translate(0px, 0px) scale(1)' },
    ], 600, 'ease-out');
    this.card.getAnimations().forEach((a) => a.cancel());
    this.wobble();
  }

  private wobble() {
    this.face.classList.remove('wobble', 'arrive');
    void this.face.offsetWidth;
    this.face.classList.add('wobble');
  }

  // ---------- helpers ----------

  /** The card's resting centre on the belt (ignores any transform it has now). */
  private home() {
    const c = this.card;
    const r = (c.offsetParent ?? this.belt).getBoundingClientRect();
    return { x: r.left + c.offsetLeft + c.offsetWidth / 2, y: r.top + c.offsetTop + c.offsetHeight / 2 };
  }

  private async animate(frames: Keyframe[], duration: number, easing: string) {
    this.card.getAnimations().forEach((a) => a.cancel());
    const a = this.card.animate(frames, { duration, easing, fill: 'forwards' });
    try {
      await a.finished;
    } catch {
      /* cancelled */
    }
  }

  private untilResumed() {
    return this.shell.paused && !this.dead ? new Promise<void>((res) => this.waiters.push(res)) : Promise.resolve();
  }

  private resumed() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
}
