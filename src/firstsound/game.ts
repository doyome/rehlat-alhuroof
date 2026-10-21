// «مكتب البريد — أول حرف» — a parcel shows a picture; the child posts it into the mailbox marked with
// the first letter of the word. Drag the parcel onto a mailbox, or tap the parcel then tap a mailbox.
// Tapping the parcel says the word. Only the chosen mailbox counts for learning; time is logged, never judged.
// The post office is plain DOM + CSS inside the GameShell stage; sizes are set on resize so it fits
// phones in portrait and desktops in landscape.

import './style.css';
import { play, preloadAudio, say, sfx } from '../audio';
import { GameShell } from '../core/shell';
import { logAttempt } from '../progress';
import { LETTER, WORDS, firstLetter, letterNameAudio, wordAudio, wordImage, type Word } from '../data/arabic';
import { FIRSTSOUND_AUDIO, type FirstSoundStage, wordsFor } from '../data/firstsound';

const BASE = import.meta.env.BASE_URL;

export interface FirstSoundOptions {
  child: string;
  stage: FirstSoundStage;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

const COLORS = ['red', 'teal', 'yellow', 'blue'] as const;
const pics = new Map<string, boolean>(); // word id -> its picture loaded
const picUrl = (wd: Word) => `${BASE}assets/${wordImage(wd)}`;

function loadPic(wd: Word) {
  return new Promise<void>((res) => {
    if (pics.has(wd.id)) return res();
    const im = new Image();
    im.onload = () => {
      pics.set(wd.id, true);
      res();
    };
    im.onerror = () => {
      pics.set(wd.id, false);
      res();
    };
    im.src = picUrl(wd);
  });
}

export function preloadFirstSound(): Promise<unknown> {
  return Promise.all([
    preloadAudio(FIRSTSOUND_AUDIO),
    document.fonts.load('700 80px "Noto Naskh Arabic"').catch(() => undefined),
    ...WORDS.map(loadPic),
  ]);
}

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

const INTRO = 'أهلًا في مكتب البريد! ضع كل طرد في صندوق أول حرف من اسمه';
const WRONG = 'استمع لأول صوت في الكلمة…';

interface Box {
  el: HTMLButtonElement;
  body: HTMLElement;
  slot: HTMLElement;
  plate: HTMLElement;
  letter: string;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  moved: boolean;
  over: Box | null;
}

export class FirstSoundGame {
  private o: FirstSoundOptions;
  private shell: GameShell;
  private po!: HTMLElement;
  private boxesEl!: HTMLElement;
  private belt!: HTMLElement;
  private parcel!: HTMLButtonElement;
  private label!: HTMLElement;
  private boxes: Box[] = [];
  private mb = 120; // mailbox width in px
  // round
  private word: Word | null = null;
  private queue: Word[] = [];
  private lastWord = '';
  private tries = 0;
  private help = 0;
  private roundStart = 0;
  private delivered = 0;
  private busy = true; // true while voices/animations own the scene
  private selected = false; // parcel tapped, waiting for a mailbox tap
  private drag: Drag | null = null;
  private dead = false;
  private introDone = false;
  private waiters: (() => void)[] = [];

  constructor(root: HTMLElement, opts: FirstSoundOptions) {
    this.o = opts;
    this.shell = new GameShell({
      root,
      kind: 'firstsound',
      child: opts.child,
      stageId: opts.stage.id,
      rounds: opts.stage.rounds,
      doneTitle: 'أحسنت يا ساعي البريد!',
      onExit: opts.onExit,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
      onPause: (p) => !p && this.resumed(),
      onReplay: () => this.replay(),
    });
    this.build();
    this.layout();
    this.shell.listen(window, 'resize', () => this.layout());
    if (import.meta.env.DEV) (window as unknown as { __first: FirstSoundGame }).__first = this;
    void this.newRound();
  }

  destroy() {
    this.dead = true;
    this.resumed();
    this.shell.destroy();
  }

  // ---------- scene ----------

  private build() {
    const s = this.shell.stage;
    s.innerHTML = `
      <div class="po" dir="rtl">
        <div class="po-sky"><i class="po-sun"></i><i class="po-cloud c1"></i><i class="po-cloud c2"></i></div>
        <div class="po-awning">
          <div class="po-sign"><svg viewBox="0 0 32 24" aria-hidden="true"><rect x="2" y="2" width="28" height="20" rx="3"/><path d="M3 4l13 10L29 4"/></svg><span>مكتب البريد</span></div>
        </div>
        <div class="po-boxes"></div>
        <div class="po-counter">
          <div class="po-belt">
            <i class="po-roller"></i><i class="po-roller end"></i>
            <button class="parcel" aria-label="الطرد">
              <span class="parcel-box">
                <svg class="parcel-bow" viewBox="0 0 60 28" aria-hidden="true"><path d="M30 21C19 3 4 5 8 15c3 8 14 8 22 6zM30 21C41 3 56 5 52 15c-3 8-14 8-22 6z"/><circle cx="30" cy="20" r="5"/></svg>
                <span class="parcel-label"></span>
              </span>
            </button>
          </div>
          <div class="po-desk"></div>
        </div>
      </div>`;
    const q = (sel: string) => s.querySelector(sel) as HTMLElement;
    this.po = q('.po');
    this.boxesEl = q('.po-boxes');
    this.belt = q('.po-belt');
    this.parcel = q('.parcel') as HTMLButtonElement;
    this.label = q('.parcel-label');
    for (let i = 0; i < this.o.stage.boxes; i++) {
      const el = document.createElement('button');
      el.className = `mailbox ${COLORS[i % COLORS.length]}`;
      el.innerHTML = `<span class="mb-flag"></span><span class="mb-body"><span class="mb-slot"></span><span class="mb-plate"><b></b></span></span><span class="mb-post"></span>`;
      this.boxesEl.appendChild(el);
      const box: Box = {
        el,
        body: el.querySelector('.mb-body') as HTMLElement,
        slot: el.querySelector('.mb-slot') as HTMLElement,
        plate: el.querySelector('.mb-plate b') as HTMLElement,
        letter: '',
      };
      this.boxes.push(box);
      this.shell.press(el, () => this.tapBox(box));
    }
    const p = this.parcel;
    this.shell.listen(p, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.shell.listen(p, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.shell.listen(p, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.shell.listen(p, 'pointercancel', (e) => this.onUp(e as PointerEvent));
  }

  /** Size everything from the space we have: mailboxes in a row (2×2 on a phone held upright). */
  private layout() {
    const W = this.shell.stage.clientWidth || window.innerWidth;
    const H = this.shell.stage.clientHeight || window.innerHeight;
    const n = this.boxes.length;
    const portrait = H > W;
    // short landscape screens (a phone on its side): the counter moves beside the mailboxes
    const side = !portrait && H < 560 && W > H * 1.5;
    const cols = portrait && n >= 3 ? 2 : n;
    const rows = Math.ceil(n / cols);
    const sky = clamp(H * 0.16, 116, 150); // keeps the HUD over sky, never over a mailbox
    const aw = clamp(H * 0.055, 26, 50);
    const desk = clamp(H * 0.04, 14, 40);
    const parcel = clamp(Math.min(W * (portrait ? 0.4 : side ? 0.17 : 0.2), H * (portrait ? 0.19 : side ? 0.3 : 0.22)), 84, 200);
    const counter = parcel * 0.78 + 30 + desk;
    const freeH = H - sky - aw - (side ? 0 : counter) - 24;
    const freeW = W - 24 - (side ? parcel * 1.75 : 0);
    // a mailbox is 1.5 widths tall with its post; columns need room for the flag beside each box
    this.mb = clamp(Math.min(freeH / (rows * 1.5 + (rows - 1) * 0.16), freeW / (cols + (cols - 1) * 0.42 + 0.36)), 60, 200);
    const st = this.po.style;
    st.setProperty('--sky', `${sky}px`);
    st.setProperty('--aw', `${aw}px`);
    st.setProperty('--desk', `${desk}px`);
    st.setProperty('--parcel', `${parcel}px`);
    st.setProperty('--mb', `${this.mb}px`);
    st.setProperty('--cols', String(cols));
    this.po.classList.toggle('side', side);
    this.boxesEl.classList.toggle('odd', n % cols !== 0);
  }

  private fillLabel(wd: Word) {
    const ok = pics.get(wd.id);
    this.label.classList.toggle('text', !ok);
    this.label.innerHTML = '';
    if (ok) {
      const im = document.createElement('img');
      im.src = picUrl(wd);
      im.alt = '';
      im.draggable = false;
      this.label.appendChild(im);
    } else {
      // no picture yet: the vowelled word on an airmail label
      const t = document.createElement('span');
      t.textContent = wd.text;
      this.label.appendChild(t);
      if (!pics.has(wd.id)) void loadPic(wd).then(() => this.word === wd && pics.get(wd.id) && this.fillLabel(wd));
    }
  }

  private stamp(box: Box) {
    const s = document.createElement('span');
    s.className = 'mb-stamp';
    s.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="43"/><circle class="ring2" cx="50" cy="50" r="33"/><path class="tick" d="M30 52l14 14 27-30"/></svg>`;
    box.body.appendChild(s);
  }

  private setSelected(on: boolean) {
    this.selected = on;
    this.parcel.classList.toggle('sel', on);
    this.boxesEl.classList.toggle('ready', on);
  }

  // ---------- input ----------

  private onDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (this.shell.paused || this.shell.done || this.busy || this.drag) return;
    this.parcel.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false, over: null };
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(d.dx, d.dy) > 10) {
      d.moved = true;
      this.setSelected(false);
      this.parcel.classList.add('drag');
    }
    if (!d.moved) return;
    this.parcel.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${clamp(d.dx * 0.03, -8, 8)}deg) scale(1.06)`;
    const over = this.boxAt(e.clientX, e.clientY);
    if (over !== d.over) {
      d.over?.el.classList.remove('over');
      over?.el.classList.add('over');
      d.over = over;
    }
    if (Math.random() < 0.35) {
      const r = this.shell.root.getBoundingClientRect();
      this.shell.sparkle(e.clientX - r.left, e.clientY - r.top);
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.over?.el.classList.remove('over');
    this.parcel.classList.remove('drag');
    if (!d.moved) {
      if (e.type === 'pointerup') this.tapParcel();
      return;
    }
    if (e.type === 'pointerup' && d.over && !this.shell.paused) void this.post(d.over, d.dx, d.dy);
    else void this.goHome(d.dx, d.dy, 1.06);
  }

  private boxAt(x: number, y: number) {
    const pad = this.mb * 0.14;
    for (const b of this.boxes) {
      const r = b.el.getBoundingClientRect();
      if (x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad) return b;
    }
    return null;
  }

  /** Tap the parcel: pick it up and hear the word. */
  private tapParcel() {
    if (this.busy || !this.word) return;
    this.setSelected(true);
    sfx.tap();
    void say(wordAudio(this.word), this.word.text);
  }

  private tapBox(box: Box) {
    if (this.busy || this.drag || this.shell.done) return;
    if (this.selected) {
      void this.post(box, 0, 0);
      return;
    }
    // nothing in hand yet: the mailbox says its letter, and the parcel waves
    box.el.classList.remove('peek');
    void box.el.offsetWidth;
    box.el.classList.add('peek');
    this.parcel.classList.remove('wobble');
    void this.parcel.offsetWidth;
    this.parcel.classList.add('wobble');
    this.shell.bubble('المس الطرد أولًا، ثم اختر الصندوق', 2600);
    void say(letterNameAudio(box.letter), LETTER.get(box.letter)?.name ?? box.letter);
  }

  private replay() {
    if (this.shell.paused || this.shell.done || !this.word) return;
    this.help = Math.max(this.help, 1);
    this.shell.pulseCard();
    void say(wordAudio(this.word), this.word.text);
  }

  // ---------- rounds ----------

  private nextWord() {
    if (!this.queue.length) {
      this.queue = shuffle(wordsFor(this.o.stage.letters));
      if (this.queue.length > 1 && this.queue[0].id === this.lastWord) this.queue.push(this.queue.shift()!);
    }
    const wd = this.queue.shift()!;
    this.lastWord = wd.id;
    return wd;
  }

  private async newRound() {
    await this.untilResumed();
    if (this.dead || this.shell.done) return;
    this.busy = true;
    const wd = this.nextWord();
    this.word = wd;
    this.tries = 0;
    this.help = 0;
    this.shell.setTarget('؟', true);
    // the right mailbox plus other letters of the stage, in a new order every round
    const right = firstLetter(wd);
    const others = shuffle(this.o.stage.letters.filter((l) => l !== right)).slice(0, this.boxes.length - 1);
    const letters = shuffle([right, ...others]);
    this.boxes.forEach((b, i) => {
      b.letter = letters[i] ?? '';
      b.plate.textContent = b.letter;
      b.el.setAttribute('aria-label', `صندوق حرف ${LETTER.get(b.letter)?.name ?? b.letter}`);
      b.el.classList.remove('got', 'glow', 'nope', 'over', 'peek', 'swap');
      b.body.querySelectorAll('.mb-stamp').forEach((s) => s.remove());
      void b.el.offsetWidth;
      b.el.classList.add('swap');
    });
    // a new parcel rides in on the conveyor
    this.fillLabel(wd);
    this.parcel.getAnimations().forEach((a) => a.cancel());
    this.parcel.style.transform = '';
    this.parcel.classList.remove('gone', 'sel', 'arrive', 'wobble');
    this.setSelected(false);
    void this.parcel.offsetWidth;
    this.parcel.classList.add('arrive');
    this.belt.classList.add('moving');
    play('sfx/whoosh', 0.35);
    await this.wait(850);
    this.belt.classList.remove('moving');
    if (this.dead) return;
    if (!this.introDone) {
      this.introDone = true;
      this.shell.bubble(INTRO, 6000);
      await say('first/intro', INTRO);
    }
    await this.untilResumed();
    if (this.dead || this.word !== wd) return;
    this.roundStart = performance.now();
    this.busy = false;
    void say(wordAudio(wd), wd.text);
  }

  /** The parcel goes to a mailbox: into the slot when right, back to the counter when not. */
  private async post(box: Box, dx: number, dy: number) {
    const wd = this.word;
    if (!wd || this.busy) return;
    this.busy = true;
    this.setSelected(false);
    const right = firstLetter(wd);
    const correct = box.letter === right;
    this.tries++;
    logAttempt({
      child: this.o.child,
      activity: 'first-sound',
      stage: this.o.stage.id,
      item: wd.id,
      answer: box.letter,
      correct,
      help: this.help,
      tries: this.tries,
      ms: Math.round(performance.now() - this.roundStart),
    });
    const dragged = dx !== 0 || dy !== 0;
    const from = `translate(${dx}px, ${dy}px) scale(${dragged ? 1.06 : 1})`;
    this.parcel.style.transform = '';
    const home = this.home();
    if (correct) {
      const slot = center(box.slot);
      const tx = slot.x - home.x;
      const ty = slot.y - home.y;
      sfx.whoosh();
      await this.animate([
        { transform: from, opacity: 1 },
        { transform: `translate(${tx}px, ${ty - this.mb * 0.35}px) scale(0.42)`, opacity: 1, offset: 0.65 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.05)`, opacity: 0.2 },
      ], 700, 'ease-in-out');
      if (this.dead) return;
      this.parcel.classList.add('gone');
      play('sfx/plop', 0.9);
      box.el.classList.remove('swap', 'glow');
      box.el.classList.add('got');
      this.stamp(box);
      const r = this.shell.root.getBoundingClientRect();
      const c = center(box.body);
      const x = c.x - r.left;
      const y = c.y - r.top;
      this.shell.burst(x, y, 30);
      this.shell.setTarget(right);
      this.shell.pulseCard();
      await say(wordAudio(wd), wd.text);
      await this.untilResumed();
      if (this.dead) return;
      const over = await this.shell.correct(this.tries === 1 && this.help === 0, this.tries === 1, x, y);
      if (this.dead) return;
      this.delivered++;
      if (over) this.shell.finish(`وصّلت ${this.delivered} طرود`);
      else {
        await this.wait(400);
        void this.newRound();
      }
      return;
    }
    // wrong: the parcel bumps the mailbox and bounces back to the counter
    let at = { x: dx, y: dy, s: dragged ? 1.06 : 1 };
    if (!dragged) {
      const c = center(box.body);
      at = { x: c.x - home.x, y: c.y - home.y, s: 0.5 };
      await this.animate([{ transform: from }, { transform: `translate(${at.x}px, ${at.y}px) scale(0.5)` }], 380, 'ease-in');
      if (this.dead) return;
    }
    this.shell.wrong();
    box.el.classList.remove('nope');
    void box.el.offsetWidth;
    box.el.classList.add('nope');
    await this.goHome(at.x, at.y, at.s);
    if (this.dead) return;
    if (this.tries >= 2) {
      this.help = 2;
      this.boxes.find((b) => b.letter === right)?.el.classList.add('glow');
    }
    this.shell.bubble(WRONG, 3600);
    await say('first/wrong', WRONG);
    await this.untilResumed();
    if (this.dead || this.word !== wd) return;
    this.busy = false;
    void say(wordAudio(wd), wd.text);
  }

  /** Spring back to the counter from a drag offset. */
  private async goHome(x: number, y: number, s: number) {
    this.parcel.style.transform = '';
    this.parcel.classList.remove('wobble');
    await this.animate([
      { transform: `translate(${x}px, ${y}px) scale(${s})` },
      { transform: `translate(${x * 0.55}px, ${y * 0.55 - this.mb * 0.45}px) scale(${(s + 1) / 2}) rotate(-6deg)`, offset: 0.45 },
      { transform: 'translate(0px, 0px) scale(1)' },
    ], 620, 'ease-out');
    this.parcel.getAnimations().forEach((a) => a.cancel());
    this.parcel.classList.add('wobble');
  }

  // ---------- helpers ----------

  /** The parcel's resting centre on the counter (ignores any transform it has now). */
  private home() {
    const p = this.parcel;
    const r = (p.offsetParent ?? this.belt).getBoundingClientRect();
    return { x: r.left + p.offsetLeft + p.offsetWidth / 2, y: r.top + p.offsetTop + p.offsetHeight / 2 };
  }

  private async animate(frames: Keyframe[], duration: number, easing: string) {
    this.parcel.getAnimations().forEach((a) => a.cancel());
    const a = this.parcel.animate(frames, { duration, easing, fill: 'forwards' });
    try {
      await a.finished;
    } catch {
      /* cancelled */
    }
  }

  private wait(ms: number) {
    return new Promise<void>((res) => setTimeout(res, ms));
  }

  private untilResumed() {
    return this.shell.paused && !this.dead ? new Promise<void>((res) => this.waiters.push(res)) : Promise.resolve();
  }

  private resumed() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
    // the pause cut the voice off: say the word again when play goes on
    if (!this.dead && !this.busy && this.word && !this.shell.done) void say(wordAudio(this.word), this.word.text);
  }
}
