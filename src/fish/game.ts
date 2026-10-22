// «الصيّاد» — the child hears a letter and catches the fish that carries it.
// One action only: tap the fish. The boat sails over, the hook drops to it and it bites.
// The boat can also be dragged and poked for fun. Only the letter choice counts for learning.
// Letter cards stay upright whichever way a fish swims.
// Role mode (grade 4 grammar, «اصطد الفاعل»…): a sentence sits in a banner over the sky, each fish
// carries one of its words, and the child catches the word that plays the role on the target card.

import { Music, play, preloadAudio, say, sfx, stopVoice } from '../audio';
import { logAttempt, saveStage } from '../progress';
import { FISH_AUDIO, type FishStage, LETTER_NAME, letterNameAudio } from '../data/fish';
import { G4_LINES, type Role, type RoleSentence, type RoleStage } from '../data/g4';
import './roles.css';

const BASE = import.meta.env.BASE_URL;

export interface FishOptions {
  child: string;
  stage: FishStage | RoleStage;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

export function isRoleStage(stage: FishStage | RoleStage): stage is RoleStage {
  return 'role' in stage;
}

/** what the target card says for each role */
const ROLE_LABEL: Record<Role, string> = {
  فعل: 'الفعل',
  فاعل: 'الفاعل',
  'مفعول به': 'المفعول به',
  'حرف جرّ': 'حرف الجرّ',
  'اسم مجرور': 'الاسم المجرور',
  مبتدأ: 'المبتدأ',
  خبر: 'الخبر',
};
const WORD_FONT = '"Noto Naskh Arabic", serif';

const ASSET = `${BASE}assets/fish/`;
const COLORS = ['orange', 'purple', 'yellow', 'mint', 'blue', 'pink'] as const;
const images = new Map<string, HTMLImageElement>();
const BOAT_KIDS = ['salem', 'raya', 'shamma'];

function loadImg(name: string) {
  return new Promise<void>((res) => {
    if (images.has(name)) return res();
    const im = new Image();
    im.onload = () => res();
    im.onerror = () => res();
    im.src = ASSET + name;
    images.set(name, im);
  });
}

export function preloadFish(child: string, stage?: FishStage | RoleStage) {
  const boat = `boat_${BOAT_KIDS.includes(child) ? child : 'salem'}.png`;
  const role = !!stage && isRoleStage(stage);
  // role mode never speaks letter names, so it skips them and loads its own two lines instead
  const names = new Set(Object.keys(LETTER_NAME).map(letterNameAudio));
  const audio = role ? [...FISH_AUDIO.filter((k) => !names.has(k)), 'g4/pick-intro', 'g4/pick-wrong'] : FISH_AUDIO;
  // the words are drawn on canvas, which only uses the font once it has loaded
  const font = role && document.fonts ? document.fonts.load(`700 32px ${WORD_FONT}`, 'كَتَبَ').catch(() => undefined) : Promise.resolve();
  return Promise.all([preloadAudio(audio), loadImg('scene.jpg'), loadImg(boat), ...COLORS.map((c) => loadImg(`fish_${c}.png`)), font]);
}

// where things sit inside scene.jpg / boat images (measured on the artwork)
const SURFACE = 0.236; // waterline in the scene image
const FLOOR = 0.83; // sand line
const ROD_TIP = { x: 0.995, y: 0.046 }; // rod tip in the boat image
const WATERLINE = 0.8; // boat image height that stays above water
const CHEERS = ['صيدٌ رائع!', 'يا سلام! أمسكتَها!', 'واااو! سمكة صحيحة!', 'أحسنت يا صيّاد!', 'ممتاز! سلّتك تمتلئ!'];
let introPlayed = false;

type FishState = 'swim' | 'lured' | 'hooked' | 'escape' | 'jump' | 'gone';

interface Fish {
  id: number;
  letter: string;
  color: (typeof COLORS)[number];
  baseY: number; // its own swimming depth (free, not banded)
  x: number;
  y: number;
  dir: number;
  speed: number;
  state: FishState;
  t: number;
  wob: number;
  // jump arc into the boat
  jx?: number;
  jy?: number;
  ok?: boolean; // judged at the bite
  right?: boolean; // role mode: this fish carries the word with the role
}

type HookState = 'idle' | 'drop' | 'wait' | 'reel';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  size: number;
  g: number;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  life: number;
}

interface Rocket {
  x: number;
  y: number;
  vy: number;
  fuse: number;
  hue: number;
}

export class FishGame {
  private root: HTMLElement;
  private o: FishOptions;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  // scene placement
  private bgX = 0;
  private bgY = 0;
  private bgW = 0;
  private bgH = 0;
  private surface = 0;
  private floor = 0;
  private fishH = 60;
  // boat & hook
  private boatW = 300;
  private boatX = 0;
  private boatTarget = 0;
  private facing = 1; // 1 = rod over the right side, -1 = boat turned round
  private boatV = 0;
  private dip = 0;
  private dipV = 0;
  private drag: { id: number; dx: number; x0: number; moved: boolean } | null = null;
  private foam: { x: number; y: number; r: number; life: number }[] = [];
  private hinted = false;
  private hookX = 0;
  private hookY = 0;
  private hookState: HookState = 'idle';
  private hookGoal = 0;
  private hookWait = 0;
  private hooked: Fish | null = null;
  private lure: Fish | null = null;
  private castPending = false;
  // round
  private fish: Fish[] = [];
  private nextId = 1;
  private target = '';
  private round = 0;
  private tries = 0;
  private help = 0;
  private firstTry = 0;
  private streak = 0;
  private caught = 0;
  private roundStart = 0;
  private busy = true; // true while voices/animations own the scene
  private done = false;
  private lastCheer = -1;
  private recent: string[] = [];
  // role mode (null for letter stages)
  private rs: RoleStage | null = null;
  private deck: RoleSentence[] = [];
  private sentence: RoleSentence | null = null;
  private answer = -1; // index of the word with the role
  private caughtIdx = -1; // highlighted in the banner after the catch
  // fx
  private sparks: Spark[] = [];
  private bubbles: Bubble[] = [];
  private rockets: Rocket[] = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private paused = false;
  private music = new Music('music/fish', 0.55);
  private ocean = new Music('sfx/ocean', 0.5);
  private el: Record<string, HTMLElement> = {};
  private off: (() => void)[] = [];

  constructor(root: HTMLElement, opts: FishOptions) {
    this.root = root;
    this.o = opts;
    this.rs = isRoleStage(opts.stage) ? opts.stage : null;
    root.innerHTML = '';
    root.className = this.rs ? 'fishing role-mode' : 'fishing';
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    root.appendChild(this.canvas);
    this.buildHud();
    this.resize();
    this.boatX = this.W * 0.42;
    this.boatTarget = this.boatX;
    const tip = this.rodTip();
    this.hookX = tip.x;
    this.hookY = this.surface + 18;
    this.listen(window, 'resize', () => this.resize());
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    this.listen(document, 'visibilitychange', () => document.hidden && this.setPaused(true));
    this.listen(this.canvas, 'pointerdown', (e) => this.onTap(e as PointerEvent));
    this.listen(this.canvas, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(this.canvas, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(this.canvas, 'pointercancel', (e) => this.onUp(e as PointerEvent));
    this.updateStars();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    this.music.start();
    this.ocean.start();
    if (import.meta.env.DEV) (window as unknown as { __fish: FishGame }).__fish = this;
    // the banner's height depends on the font; lay out again once it is in
    if (this.rs && document.fonts) void document.fonts.ready.then(() => !this.done && this.resize());
    void this.start();
  }

  /** The letter stage (only called on letter-mode paths). */
  private get ls() {
    return this.o.stage as FishStage;
  }

  /** Is this the fish to catch this round? */
  private isRight(f: Fish) {
    return this.rs ? !!f.right : f.letter === this.target;
  }

  private async start() {
    if (this.rs) {
      // role mode has its own intro on the first round (the letter intro talks about letters)
      this.newRound();
      return;
    }
    if (!introPlayed) {
      introPlayed = true;
      this.bubble('هيّا نصطاد! استمع إلى الحرف، واصطد السمكة الصحيحة!', 5600);
      await say('fish/intro', 'هيّا نصطاد');
    }
    if (this.done) return;
    this.newRound();
  }

  destroy() {
    this.done = true;
    cancelAnimationFrame(this.raf);
    this.music.dispose();
    this.ocean.dispose();
    stopVoice();
    this.off.forEach((f) => f());
    this.root.innerHTML = '';
  }

  private listen(t: EventTarget, ev: string, fn: (e: Event) => void) {
    t.addEventListener(ev, fn);
    this.off.push(() => t.removeEventListener(ev, fn));
  }

  // ---------- HUD ----------

  private buildHud() {
    const h = document.createElement('div');
    h.className = 'hud';
    h.innerHTML = `
      <button class="hud-btn pause" aria-label="إيقاف مؤقت"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg></button>
      <div class="coins bucket" dir="ltr"><i class="fish-ico"></i><b>0</b></div>
      <div class="stars" dir="ltr"><span class="row"></span><span class="count"></span></div>
      <div class="combo" hidden></div>
      <div class="target">
        <div class="card"><span class="syl"></span></div>
        <button class="hud-btn speak" aria-label="أعد الصوت"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
      <div class="tap-hint" hidden>
        <svg viewBox="0 0 64 64"><path d="M26 30V12a4 4 0 0 1 8 0v14l3-1a4 4 0 0 1 5 3l1 1a4 4 0 0 1 6 2v1a4 4 0 0 1 6 3v10c0 9-6 15-15 15h-3c-6 0-10-3-13-8l-8-12a4 4 0 0 1 6-5z" fill="#fff" stroke="#0f6b78" stroke-width="3" stroke-linejoin="round"/></svg>
        <span>${this.rs ? `المس السمكة التي تحمل ${ROLE_LABEL[this.rs.role]}` : 'المس السمكة التي تحمل الحرف'}</span>
      </div>
      ${this.rs ? '<div class="role-banner" dir="rtl" lang="ar"></div>' : ''}
      <div class="bubble"><img src="${BASE}assets/chars/shamma_face.png" alt=""><span></span></div>
      <div class="overlay pause-menu" hidden>
        <div class="panel">
          <h2>استراحة</h2>
          <button class="big resume">أكمل</button>
          <button class="big ghost music-toggle">الموسيقى: تعمل</button>
          <button class="big ghost restart">ابدأ المرحلة من جديد</button>
          <button class="big ghost exit">الخريطة</button>
        </div>
      </div>
      <div class="overlay end" hidden>
        <div class="panel">
          <img class="cheer" src="${BASE}assets/chars/saif_body.png" alt="">
          <h2>صيد رائع!</h2>
          <div class="end-stars" dir="ltr"></div>
          <p class="end-line"></p>
          <p class="end-coins"></p>
          <button class="big next">المرحلة التالية</button>
          <button class="big ghost again">إعادة</button>
          <button class="big ghost exit">الخريطة</button>
        </div>
      </div>`;
    this.root.appendChild(h);
    const q = (s: string) => h.querySelector(s) as HTMLElement;
    this.el = {
      stars: q('.stars .row'),
      count: q('.stars .count'),
      bucket: q('.bucket b'),
      bucketBox: q('.bucket'),
      combo: q('.combo'),
      syl: q('.target .syl'),
      card: q('.target .card'),
      bubble: q('.bubble'),
      bubbleText: q('.bubble span'),
      pauseMenu: q('.pause-menu'),
      musicToggle: q('.music-toggle'),
      end: q('.end'),
      endStars: q('.end-stars'),
      endLine: q('.end-line'),
      endCoins: q('.end-coins'),
      tapHint: q('.tap-hint'),
      starsBox: q('.stars'),
      target: q('.target'),
      pauseBtn: q('.hud > .pause'),
    };
    if (this.rs) {
      this.el.banner = q('.role-banner');
      this.el.card.classList.add('role');
    }
    const press = (sel: string, fn: (b: HTMLElement) => void) =>
      h.querySelectorAll<HTMLElement>(sel).forEach((b) =>
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn(b);
        }),
      );
    press('.pause', () => this.setPaused(true));
    press('.resume', () => this.setPaused(false));
    press('.music-toggle', () => {
      const on = this.music.toggle();
      this.el.musicToggle.textContent = on ? 'الموسيقى: تعمل' : 'الموسيقى: متوقفة';
    });
    press('.restart', () => this.o.onRestart());
    press('.again', () => this.o.onRestart());
    press('.exit', () => this.o.onExit());
    press('.next', () => this.o.onNext());
    press('.speak', () => this.replay());
    press('.card', () => this.replay());
  }

  private updateStars() {
    const n = this.o.stage.rounds;
    this.el.stars.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < this.round ? 'on' : ''}">★</i>`).join('');
    this.el.count.textContent = `${this.round} / ${n}`;
  }

  private bubbleTimer = 0;
  private bubble(text: string, ms = 1600) {
    this.el.bubbleText.textContent = text;
    this.el.bubble.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.el.bubble.classList.remove('show'), ms);
  }

  private flash(el: HTMLElement, text: string, ms: number) {
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    setTimeout(() => (el.hidden = true), ms);
  }

  private setPaused(p: boolean) {
    if (this.done && p) return;
    this.paused = p;
    this.el.pauseMenu.hidden = !p;
    if (p) {
      this.music.pause();
      this.ocean.pause();
      stopVoice();
    } else {
      this.music.resume();
      this.ocean.resume();
      this.last = performance.now();
    }
  }

  // ---------- input ----------

  private onKey(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft') this.nudgeBoat(-1);
    else if (e.key === 'ArrowRight') this.nudgeBoat(1);
    else if (e.key === 'p' || e.key === 'Escape') this.setPaused(!this.paused);
    else if (e.key === 'r' || e.key === 'R') this.replay();
    else return;
    e.preventDefault();
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private boatRect() {
    const im = images.get(this.boatName());
    const h = im?.naturalWidth ? (this.boatW * im.naturalHeight) / im.naturalWidth : this.boatW * 0.5;
    return { x0: this.boatX - this.boatW / 2, x1: this.boatX + this.boatW / 2, y0: this.surface - h * WATERLINE, y1: this.surface + h * (1 - WATERLINE) };
  }

  private onTap(e: PointerEvent) {
    if (this.paused || this.done) return;
    const { x, y } = this.local(e);
    const b = this.boatRect();
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && this.hookState === 'idle') {
      // grab the boat: drag it along the water, or just poke it
      this.drag = { id: e.pointerId, dx: x - this.boatX, x0: x, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    // the one real action: tap a fish
    let best: Fish | null = null;
    let bd = Infinity;
    for (const f of this.fish) {
      if (f.state !== 'swim') continue;
      const d = Math.hypot(f.x - x, (f.y - y) * 1.3);
      if (d < this.fishH * 1.15 && d < bd) {
        bd = d;
        best = f;
      }
    }
    if (best && this.hookState === 'idle' && !this.busy) {
      this.hideHint();
      this.lure = best;
      best.state = 'lured';
      best.t = 0;
      this.aimAt(best.x);
      this.castPending = true;
      play('sfx/cast', 0.5);
    } else if (y > this.surface) {
      // tapping empty water just makes a ripple, and reminds what to do
      this.splash(x, y, 8);
      if (!this.busy && !best) this.bubble(this.rs ? `المس السمكة التي تحمل ${this.target}` : 'المس السمكة التي تحمل الحرف', 1800);
    }
  }

  private onMove(e: PointerEvent) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const { x } = this.local(e);
    if (Math.abs(x - this.drag.x0) > 8) this.drag.moved = true;
    const nx = this.clampBoat(x - this.drag.dx);
    if (Math.abs(nx - this.boatTarget) > 1) this.facing = nx > this.boatTarget ? 1 : -1;
    this.boatTarget = nx;
  }

  private onUp(e: PointerEvent) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    if (!this.drag.moved) this.pokeBoat();
    this.drag = null;
  }

  /** Poke the boat: it bounces, splashes and rocks. */
  private pokeBoat() {
    this.dipV -= 14;
    play('sfx/splash', 0.6);
    play('sfx/bubbles', 0.4);
    this.splash(this.boatX - this.boatW * 0.35, this.surface, 14);
    this.splash(this.boatX + this.boatW * 0.35, this.surface, 14);
  }

  private nudgeBoat(dir: number) {
    if (this.paused || this.hookState !== 'idle') return;
    this.facing = dir;
    this.boatTarget = this.clampBoat(this.boatTarget + dir * this.W * 0.14);
  }

  /** Turn the boat so its rod reaches x (rod points toward the nearer screen half), then sail there. */
  private aimAt(x: number) {
    this.facing = x < this.W * 0.5 ? -1 : 1;
    this.boatTarget = this.clampBoat(x - this.tipOffset());
  }

  private showHint() {
    if (this.hinted) return;
    this.el.tapHint.hidden = false;
  }

  private hideHint() {
    this.hinted = true;
    this.el.tapHint.hidden = true;
  }

  private replay() {
    if (this.paused || !this.target) return;
    if (this.rs) {
      // re-reading the instruction is not a hint about the word
      this.pulse();
      void say('g4/pick-intro', G4_LINES['g4/pick-intro']);
      return;
    }
    this.help = Math.max(this.help, 1);
    void this.sayTarget();
  }

  private pulse() {
    for (const el of [this.el.card, this.el.banner]) {
      if (!el) continue;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    }
  }

  private async sayTarget() {
    this.pulse();
    await say('fish/find', 'أين السمكة التي تحمل حرف');
    if (this.done) return;
    await say(letterNameAudio(this.target), LETTER_NAME[this.target]);
  }

  // ---------- rounds ----------

  private pickTarget() {
    const L = this.ls.letters;
    let t = L[Math.floor(Math.random() * L.length)];
    for (let g = 0; g < 8 && this.recent.slice(-1).includes(t); g++) t = L[Math.floor(Math.random() * L.length)];
    this.recent.push(t);
    return t;
  }

  /** Next sentence: the stage's sentences in shuffled order, reshuffled only when all were used. */
  private pickSentence(): RoleSentence {
    const items = this.rs!.items;
    if (!this.deck.length) {
      this.deck = [...items].sort(() => Math.random() - 0.5);
      // no immediate repeat across a reshuffle
      if (this.deck.length > 1 && this.deck[this.deck.length - 1] === this.sentence) this.deck.unshift(this.deck.pop()!);
    }
    return this.deck.pop()!;
  }

  /** Role mode: one fish per word of the sentence (2–5 fish); only the word with the role is right. */
  private roleCards() {
    const words = this.sentence!.words.map((text, i) => ({ text, right: i === this.answer }));
    const right = words.filter((w) => w.right);
    const others = words.filter((w) => !w.right).sort(() => Math.random() - 0.5);
    return [...right, ...others].slice(0, Math.max(2, Math.min(5, words.length)));
  }

  /** Fill the sea: exactly one fish with the target letter, the rest are other stage letters. */
  private stock() {
    let cards: { text: string; right: boolean }[];
    if (this.rs) cards = this.roleCards();
    else {
      const n = this.ls.fish;
      const others = this.ls.letters.filter((l) => l !== this.target);
      const letters = [this.target];
      for (let i = 1; i < n; i++) letters.push(others[(i - 1) % others.length]);
      cards = letters.map((text) => ({ text, right: text === this.target }));
    }
    const n = cards.length;
    const colors = [...COLORS].sort(() => Math.random() - 0.5);
    const keep = this.fish.filter((f) => f.state === 'jump' || (f.state === 'escape' && !this.rs));
    this.fish = keep;
    // every fish gets its own depth, spread through the water so none hide behind another
    const ys = Array.from({ length: n }, (_, i) => (i + 0.5) / n).sort(() => Math.random() - 0.5);
    cards
      .sort(() => Math.random() - 0.5)
      .forEach(({ text: letter, right }, i) => {
        const dir = Math.random() < 0.5 ? -1 : 1;
        const baseY = this.waterY(0.12 + ys[i] * 0.78);
        this.fish.push({
          id: this.nextId++,
          letter,
          right,
          color: colors[i % colors.length],
          baseY,
          x: this.W * (0.12 + ((i + 0.5) / n) * 0.76) + (Math.random() - 0.5) * this.W * 0.05,
          y: baseY,
          dir,
          speed: this.W * (0.035 + Math.random() * 0.03),
          state: 'swim',
          t: Math.random() * 10,
          wob: 0,
        });
      });
    for (let i = 0; i < 18; i++) this.spawnBubble(Math.random() * this.W, this.floor);
    play('sfx/bubbles', 0.4);
  }

  private newRound() {
    if (this.done) return;
    if (this.rs) {
      this.newRoleRound(this.rs);
      return;
    }
    this.target = this.pickTarget();
    this.tries = 0;
    this.help = 0;
    this.roundStart = performance.now();
    this.el.syl.textContent = this.ls.showCard ? this.target : '؟';
    this.el.card.classList.toggle('mystery', !this.ls.showCard);
    this.stock();
    this.busy = false;
    if (this.round === 0 && !this.hinted) setTimeout(() => !this.hinted && !this.done && this.showHint(), 1200);
    void this.sayTarget();
  }

  private newRoleRound(rs: RoleStage) {
    this.sentence = this.pickSentence();
    this.answer = this.sentence.roles[rs.role] ?? 0;
    this.caughtIdx = -1;
    this.target = ROLE_LABEL[rs.role];
    this.tries = 0;
    this.help = 0;
    this.roundStart = performance.now();
    this.el.syl.textContent = this.target;
    this.el.card.classList.remove('mystery');
    this.renderBanner();
    this.stock();
    this.busy = false;
    this.pulse();
    if (this.round === 0) {
      if (!this.hinted) setTimeout(() => !this.hinted && !this.done && this.showHint(), 1200);
      const line = G4_LINES['g4/pick-intro'];
      this.bubble(`${line}: ${this.target}`, 5000);
      void say('g4/pick-intro', line);
    }
  }

  /** The sentence banner: one span per word, the caught word underlined with its role under it. */
  private renderBanner(s: RoleSentence | null = this.sentence) {
    const b = this.el.banner;
    if (!b || !this.rs) return;
    b.replaceChildren(
      ...(s?.words ?? []).map((word, i) => {
        const w = document.createElement('span');
        w.className = 'w';
        if (s === this.sentence && i === this.caughtIdx) w.classList.add('caught');
        const t = document.createElement('b');
        t.textContent = word;
        const l = document.createElement('small');
        l.textContent = this.rs!.role;
        w.append(t, l);
        return w;
      }),
    );
  }

  /** Place the banner under the top HUD and reserve the height of the stage's longest sentence. */
  private layoutBanner() {
    const b = this.el.banner;
    if (!b || !this.rs) return 0;
    let top = 0;
    for (const e of [this.el.target, this.el.starsBox, this.el.bucketBox, this.el.pauseBtn]) top = Math.max(top, e.offsetTop + e.offsetHeight);
    top += 8;
    b.style.top = `${top}px`;
    b.style.minHeight = '';
    let h = 0;
    for (const s of this.rs.items) {
      this.renderBanner(s);
      h = Math.max(h, b.offsetHeight);
    }
    this.renderBanner();
    b.style.minHeight = `${h}px`;
    return top + h;
  }

  private judge(f: Fish) {
    const correct = this.isRight(f);
    this.tries++;
    logAttempt({
      child: this.o.child,
      activity: this.rs ? 'role-fishing' : 'letter-fishing',
      stage: this.o.stage.id,
      item: this.sentence && this.rs ? this.sentence.words.join(' ') : this.target,
      answer: f.letter,
      correct,
      help: this.help,
      tries: this.tries,
      ms: Math.round(performance.now() - this.roundStart),
    });
    return correct;
  }

  private onCaught(f: Fish) {
    // the fish lands in the boat
    this.busy = true;
    const independent = this.tries === 1 && this.help === 0;
    if (independent) this.firstTry++;
    this.streak = this.tries === 1 ? this.streak + 1 : 0;
    this.round++;
    this.caught++;
    this.updateStars();
    this.el.bucket.textContent = String(this.caught);
    this.el.bucketBox.classList.remove('bump');
    void this.el.bucketBox.offsetWidth;
    this.el.bucketBox.classList.add('bump');
    this.el.stars.querySelectorAll('i.on')[this.round - 1]?.classList.add('pop');
    sfx.correct();
    play('sfx/plop', 0.8);
    this.burst(f.x, f.y, 70);
    if (this.rs) {
      // show the caught word in its sentence, underlined with its role
      this.caughtIdx = this.answer;
      this.el.banner?.children[this.answer]?.classList.add('caught');
    }
    let line: string;
    let text: string;
    if (this.streak === 3 || this.streak === 5) {
      line = `race/combo${this.streak}`;
      text = this.streak === 3 ? 'ثلاث إجابات صحيحة متتالية! أنت مذهل!' : 'خمس إجابات صحيحة! أنت بطل خارق!';
      play('sfx/combo', 0.8);
      this.flash(this.el.combo, `سلسلة ${this.streak}`, 2600);
    } else {
      let c = Math.floor(Math.random() * CHEERS.length);
      if (c === this.lastCheer) c = (c + 1) % CHEERS.length;
      this.lastCheer = c;
      line = `fish/cheer${c + 1}`;
      text = CHEERS[c];
    }
    this.bubble(text, 2600);
    void say(line, text).then(() => {
      if (this.round >= this.o.stage.rounds) this.finish();
      else setTimeout(() => this.newRound(), this.rs ? 1100 : 500);
    });
  }

  private async onEscaped(f: Fish) {
    this.busy = true;
    this.streak = 0;
    play('sfx/escape', 0.8);
    this.splash(f.x, f.y);
    if (this.tries >= 2) this.help = 2;
    if (this.rs) {
      const line = G4_LINES['g4/pick-wrong'];
      this.bubble(line, 3600);
      await say('g4/pick-wrong', line);
      if (this.help >= 2) {
        this.bubble('انظر جيدًا… السمكة اللامعة هي الصحيحة!', 4200);
        await say('fish/hint', 'السمكة اللامعة هي الصحيحة');
      }
      if (this.done) return;
      this.busy = false;
      return;
    }
    this.bubble(`هذا حرف «${f.letter}»… لنبحث عن الحرف الصحيح!`, 4200);
    await say('fish/this-is', 'هذا حرف');
    await say(letterNameAudio(f.letter), LETTER_NAME[f.letter]);
    if (this.help >= 2) {
      this.bubble('انظر جيدًا… السمكة اللامعة هي الصحيحة!', 4200);
      await say('fish/hint', 'السمكة اللامعة هي الصحيحة');
    } else await say('fish/try-again', 'لنبحث عن الحرف الصحيح');
    if (this.done) return;
    this.busy = false;
    await say(letterNameAudio(this.target), LETTER_NAME[this.target]);
  }

  private finish() {
    this.done = true;
    this.busy = true;
    saveStage(this.o.child, this.o.stage.id, this.firstTry, this.o.stage.rounds);
    this.music.duck(0.4);
    sfx.fanfare();
    play('sfx/yay', 0.8);
    this.confetti();
    this.launchFireworks(9);
    setTimeout(() => void say('fish/done', 'رائع! امتلأت سلّتك'), 900);
    const n = this.o.stage.rounds;
    this.el.endStars.innerHTML = Array.from({ length: n }, () => '<i class="on">★</i>').join('');
    this.el.endLine.textContent = `أجبت من أول مرة ${this.firstTry} من ${n}`;
    this.el.endCoins.textContent = `اصطدت ${this.caught} سمكات`;
    this.el.end.hidden = false;
  }

  // ---------- simulation ----------

  private frame(t: number) {
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (!this.paused) this.update(dt);
    this.draw();
  }

  /** A point in the water column: 0 = just under the surface, 1 = the sand. */
  private waterY(k: number) {
    return this.surface + (this.floor - this.surface) * k;
  }

  private tipOffset() {
    return this.facing * this.boatW * (ROD_TIP.x - 0.5);
  }

  private clampBoat(x: number) {
    return Math.max(this.boatW * 0.5, Math.min(this.W - this.boatW * 0.5, x));
  }

  private rodTip() {
    const im = images.get(this.boatName());
    const h = im?.naturalWidth ? (this.boatW * im.naturalHeight) / im.naturalWidth : this.boatW * 0.5;
    const top = this.surface - h * WATERLINE + Math.sin(this.time * 1.6) * 3 + this.dip;
    return { x: this.boatX + this.tipOffset(), y: top + h * ROD_TIP.y };
  }

  private boatName() {
    return `boat_${BOAT_KIDS.includes(this.o.child) ? this.o.child : 'salem'}.png`;
  }

  private update(dt: number) {
    this.time += dt;
    // boat: sails toward its target with some momentum, leaves a wake, dips when poked or loaded
    const prev = this.boatX;
    this.boatX += (this.boatTarget - this.boatX) * Math.min(1, dt * (this.drag ? 8 : 2.6));
    this.boatV = (this.boatX - prev) / Math.max(dt, 1e-3);
    this.dipV += (-55 * this.dip - 6 * this.dipV) * dt;
    this.dip += this.dipV * dt;
    if (Math.abs(this.boatV) > 30 && Math.random() < dt * 30) {
      const stern = this.boatX - Math.sign(this.boatV) * this.boatW * 0.45;
      this.foam.push({ x: stern, y: this.surface + 4, r: 6 + Math.random() * 8, life: 1.2 });
      if (Math.random() < 0.4) {
        const bow = this.boatX + Math.sign(this.boatV) * this.boatW * 0.48;
        this.sparks.push({ x: bow, y: this.surface, vx: Math.sign(this.boatV) * 60 + (Math.random() - 0.5) * 60, vy: -120 - Math.random() * 120, life: 0.5, hue: 195, size: 2.5, g: 700 });
      }
    }
    for (const f of this.foam) {
      f.r += dt * 18;
      f.life -= dt;
    }
    this.foam = this.foam.filter((f) => f.life > 0);
    const tip = this.rodTip();

    // fish
    for (const f of this.fish) {
      f.t += dt;
      f.wob = Math.max(0, f.wob - dt);
      if (f.state === 'swim') {
        f.x += f.dir * f.speed * dt;
        f.y = f.baseY + Math.sin(f.t * 1.3 + f.id) * this.fishH * 0.35;
        const m = this.fishH * 1.2;
        if (f.x < -m) f.x = this.W + m * 0.9;
        if (f.x > this.W + m) f.x = -m * 0.9;
        if (Math.random() < dt * 0.15) f.dir *= -1;
        if (Math.random() < dt * 0.5) this.spawnBubble(f.x + f.dir * this.fishH * 0.6, f.y - this.fishH * 0.2, 0.5);
      } else if (f.state === 'lured') {
        // swim gently toward the hook's line and wait there
        const gx = this.hookState === 'idle' ? f.x : this.hookX;
        f.x += (gx - f.x) * Math.min(1, dt * 3.5);
        if (Math.abs(gx - f.x) > 2) f.dir = gx > f.x ? 1 : -1;
      } else if (f.state === 'hooked') {
        f.x = this.hookX;
        f.y = this.hookY + this.fishH * 0.55;
      } else if (f.state === 'escape') {
        f.x += f.dir * this.W * 0.5 * dt;
        f.y += (f.baseY - f.y) * Math.min(1, dt * 2);
        if (f.x < -this.fishH * 2 || f.x > this.W + this.fishH * 2) {
          f.state = 'swim';
          f.x = f.dir > 0 ? -this.fishH : this.W + this.fishH;
        }
      } else if (f.state === 'jump') {
        f.t = Math.min(1, f.t + dt * 1.4);
        const k = f.t;
        f.x = f.jx! + (this.boatX - f.jx!) * k;
        f.y = f.jy! + (this.surface - this.boatW * 0.12 - f.jy!) * k - Math.sin(k * Math.PI) * this.H * 0.18;
        if (k >= 1) {
          f.state = 'gone';
          this.dipV += 10;
          this.burst(f.x, f.y, 40);
          this.onCaught(f);
        }
      }
    }
    this.fish = this.fish.filter((f) => f.state !== 'gone');

    // hook
    if (this.castPending && Math.abs(this.boatX - this.boatTarget) < 6) {
      this.castPending = false;
      if (this.lure) {
        this.hookState = 'drop';
        this.hookGoal = this.lure.y - this.fishH * 0.45;
        setTimeout(() => play('sfx/splash', 0.5), 150);
      }
    }
    if (this.hookState === 'idle') {
      this.hookX = tip.x;
      this.hookY += (this.surface + 18 - this.hookY) * Math.min(1, dt * 6);
    } else if (this.hookState === 'drop') {
      this.hookX = tip.x;
      this.hookY = Math.min(this.hookGoal, this.hookY + this.H * 0.75 * dt);
      if (this.hookY >= this.hookGoal) {
        this.hookState = 'wait';
        this.hookWait = 0;
      }
    } else if (this.hookState === 'wait') {
      this.hookWait += dt;
      const f = this.lure;
      if (f && Math.abs(f.x - this.hookX) < this.fishH * 0.25 && this.hookWait > 0.25) {
        // bite!
        f.state = 'hooked';
        f.wob = 1;
        f.jy = this.hookY; // where it bit, so a wrong fish can slip off half way up
        this.hooked = f;
        this.lure = null;
        this.hookState = 'reel';
        play('sfx/reel', 0.6);
        this.burst(f.x, f.y, 18);
        f.ok = this.judge(f);
      } else if (!f) {
        this.hookState = 'reel';
      } else if (this.hookWait > 4) {
        f.state = 'swim';
        this.lure = null;
        this.hookState = 'reel';
      }
    } else if (this.hookState === 'reel') {
      this.hookX = tip.x;
      this.hookY -= this.H * 0.5 * dt;
      const f = this.hooked;
      // a wrong fish always slips off before the surface, however shallow it was
      const slipY = Math.max((f?.jy ?? this.surface) * 0.5 + this.surface * 0.5, this.surface + 40);
      if (f && !f.ok && this.hookY < slipY) {
        // the wrong fish wiggles free half way up
        f.state = 'escape';
        f.dir = Math.random() < 0.5 ? -1 : 1;
        this.hooked = null;
        void this.onEscaped(f);
      }
      if (this.hookY <= this.surface + 18) {
        this.hookY = this.surface + 18;
        this.hookState = 'idle';
        if (this.hooked?.ok) {
          const h = this.hooked;
          this.hooked = null;
          h.state = 'jump';
          h.t = 0;
          h.jx = h.x;
          h.jy = this.surface;
          play('sfx/fish-jump', 0.8);
          this.splash(h.x, this.surface);
        }
      }
    }

    // ambient bubbles
    if (Math.random() < dt * 4) this.spawnBubble(Math.random() * this.W, this.floor, 0.7);
    for (const b of this.bubbles) {
      b.y -= b.vy * dt;
      b.x += Math.sin(this.time * 3 + b.r) * 8 * dt;
      b.life -= dt;
    }
    this.bubbles = this.bubbles.filter((b) => b.life > 0 && b.y > this.surface + 4);

    for (const r of this.rockets) {
      r.y += r.vy * dt;
      r.vy += 260 * dt;
      r.fuse -= dt;
      if (Math.random() < 0.6) this.sparks.push({ x: r.x, y: r.y, vx: (Math.random() - 0.5) * 30, vy: 40, life: 0.4, hue: 45, g: 0, size: 2 });
      if (r.fuse <= 0) this.explode(r);
    }
    this.rockets = this.rockets.filter((r) => r.fuse > 0);
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += s.g * dt;
      s.vx *= 1 - dt * 0.6;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  private spawnBubble(x: number, y: number, size = 1) {
    this.bubbles.push({ x, y, r: (3 + Math.random() * 7) * size, vy: 40 + Math.random() * 70, life: 6 });
  }

  private splash(x: number, y: number, n = 26) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const v = 120 + Math.random() * 260;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.4, hue: 195, size: 3.5, g: 700 });
    }
    for (let i = 0; i < n / 2.6; i++) this.spawnBubble(x + (Math.random() - 0.5) * 40, y + 10, 0.8);
  }

  private burst(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 320;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0.7 + Math.random() * 0.6, hue: Math.floor(Math.random() * 360), size: 3.5, g: 400 });
    }
  }

  private confetti() {
    for (let i = 0; i < 200; i++) {
      this.sparks.push({ x: Math.random() * this.W, y: -20 - Math.random() * this.H * 0.4, vx: (Math.random() - 0.5) * 120, vy: 60 + Math.random() * 160, life: 2.4 + Math.random() * 1.5, hue: Math.floor(Math.random() * 360), g: 90, size: 5 });
    }
  }

  private launchFireworks(n: number) {
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        this.rockets.push({ x: this.W * (0.15 + Math.random() * 0.7), y: this.H, vy: -this.H * (1.15 + Math.random() * 0.35), fuse: 0.9 + Math.random() * 0.4, hue: Math.floor(Math.random() * 360) });
        if (i % 3 === 0) play('sfx/fireworks', 0.55);
      }, i * 420);
    }
  }

  private explode(r: Rocket) {
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const v = 160 + Math.random() * 140;
      this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.1 + Math.random() * 0.6, hue: r.hue + (Math.random() - 0.5) * 50, g: 120, size: 3.5 });
    }
  }

  // ---------- rendering ----------

  private resize() {
    const old = { surface: this.surface, floor: this.floor };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = this.root.clientWidth || window.innerWidth;
    this.H = this.root.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const im = images.get('scene.jpg');
    const iw = im?.naturalWidth || 1728;
    const ih = im?.naturalHeight || 976;
    const portrait = this.H > this.W;
    // put the waterline low enough that the whole boat shows under the HUD; sky is extended above the art
    let want = this.H * (portrait ? 0.3 : 0.4);
    let boatW = Math.min(this.W * (portrait ? 0.6 : 0.32), this.H * 0.62);
    if (this.rs) {
      // role mode: the sentence banner sits under the HUD and the boat floats just below it.
      // The water goes down a little; past a cap the boat gets smaller instead.
      const top = this.layoutBanner() + 6;
      const boat = images.get(this.boatName());
      const k = (boat?.naturalWidth ? boat.naturalHeight / boat.naturalWidth : 0.505) * WATERLINE;
      const cap = this.H * (portrait ? 0.5 : 0.54);
      const minW = Math.min(boatW, Math.max(120, this.W * 0.16));
      if (top + boatW * k <= Math.max(want, cap)) want = Math.max(want, top + boatW * k);
      else {
        want = Math.max(want, cap, top + minW * k);
        boatW = Math.max(minW, Math.min(boatW, (want - top) / k));
      }
    }
    const sc = Math.max(this.W / iw, (this.H - want) / ((1 - SURFACE) * ih));
    this.bgW = iw * sc;
    this.bgH = ih * sc;
    this.bgX = (this.W - this.bgW) / 2;
    this.bgY = want - this.bgH * SURFACE;
    this.surface = want;
    this.floor = Math.min(this.H * 0.88, this.bgY + this.bgH * FLOOR);
    this.fishH = Math.min(this.H * (portrait ? 0.075 : 0.12), this.W * (portrait ? 0.17 : 0.1));
    this.boatW = boatW;
    this.boatTarget = this.clampBoat(this.boatTarget || this.W * 0.42);
    this.boatX = this.clampBoat(this.boatX || this.boatTarget);
    if (this.rs && old.floor > old.surface && (old.surface !== this.surface || old.floor !== this.floor)) {
      // the banner moved the waterline: keep each fish at the same depth in the new water column
      const span = old.floor - old.surface;
      for (const f of this.fish) {
        const k = (f.baseY - old.surface) / span;
        f.y += this.waterY(k) - f.baseY;
        f.baseY = this.waterY(k);
      }
    }
  }

  private draw() {
    const { ctx, W, H } = this;
    const bg = images.get('scene.jpg');
    if (this.bgY > 0) {
      const sky = ctx.createLinearGradient(0, 0, 0, this.bgY + 2);
      sky.addColorStop(0, '#2f7fd8');
      sky.addColorStop(1, '#4a97e6');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, this.bgY + 2);
    }
    if (bg?.complete && bg.naturalWidth) ctx.drawImage(bg, this.bgX, this.bgY, this.bgW, this.bgH);
    else {
      ctx.fillStyle = '#2aa7c9';
      ctx.fillRect(0, 0, W, H);
    }
    this.drawRays();
    this.drawSurface();
    this.drawBoat();
    this.drawLine();
    for (const b of this.bubbles) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const f of this.fish) this.drawFish(f);
    this.drawHook();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      ctx.globalAlpha = Math.min(1, s.life * 1.5);
      ctx.fillStyle = `hsl(${s.hue} 95% 62%)`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size + s.life * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRays() {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = this.W * (0.15 + i * 0.18) + Math.sin(this.time * 0.4 + i * 1.7) * this.W * 0.04;
      const w = this.W * 0.05;
      const g = ctx.createLinearGradient(0, this.surface, 0, this.floor);
      const a = 0.07 + 0.04 * Math.sin(this.time * 0.9 + i);
      g.addColorStop(0, `rgba(255,255,230,${a})`);
      g.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.4, this.surface);
      ctx.lineTo(x + w * 0.4, this.surface);
      ctx.lineTo(x + w * 2.2, this.floor);
      ctx.lineTo(x - w * 0.6, this.floor);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSurface() {
    const { ctx, W } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 12) {
      const y = this.surface + Math.sin(x * 0.02 + this.time * 2.2) * 3 + Math.sin(x * 0.007 - this.time) * 2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBoat() {
    const { ctx } = this;
    const im = images.get(this.boatName());
    if (!im?.complete || !im.naturalWidth) return;
    const w = this.boatW;
    const h = (w * im.naturalHeight) / im.naturalWidth;
    const bob = Math.sin(this.time * 1.6) * 3 + this.dip;
    // leans into its motion and rocks after a poke
    const tilt = Math.sin(this.time * 1.1) * 0.025 + Math.max(-0.09, Math.min(0.09, this.boatV * 0.0005)) + this.dipV * 0.004;
    for (const f of this.foam) {
      ctx.strokeStyle = `rgba(255,255,255,${f.life * 0.55})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.r * 1.8, f.r * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(this.boatX, this.surface + bob);
    ctx.rotate(tilt);
    ctx.scale(this.facing, 1);
    ctx.drawImage(im, -w / 2, -h * WATERLINE, w, h);
    ctx.restore();
    // water laps over the hull
    ctx.fillStyle = 'rgba(64, 196, 220, 0.35)';
    ctx.fillRect(this.boatX - w * 0.5, this.surface + 2, w, h * (1 - WATERLINE));
  }

  private drawLine() {
    const { ctx } = this;
    const tip = this.rodTip();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    const sag = this.hookState === 'idle' ? 14 : 4;
    ctx.quadraticCurveTo((tip.x + this.hookX) / 2 + sag, (tip.y + this.hookY) / 2, this.hookX, this.hookY);
    ctx.stroke();
  }

  private drawHook() {
    const { ctx } = this;
    const s = Math.max(10, this.fishH * 0.28);
    ctx.save();
    ctx.translate(this.hookX, this.hookY);
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = Math.max(2.5, s * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, s * 0.9);
    ctx.arc(-s * 0.35, s * 0.9, s * 0.35, 0, Math.PI * 0.9);
    ctx.stroke();
    ctx.restore();
  }

  private drawFish(f: Fish) {
    const { ctx } = this;
    const im = images.get(`fish_${f.color}.png`);
    if (!im?.complete || !im.naturalWidth) return;
    const h = this.fishH * (f.state === 'jump' ? 1 - f.t * 0.45 : 1);
    const w = (h * im.naturalWidth) / im.naturalHeight;
    const target = this.isRight(f);
    const glow = this.help >= 2 && target && !this.done && f.state !== 'escape';
    ctx.save();
    ctx.translate(f.x, f.y);
    if (glow) {
      // the right fish shines and blows a ring of bubbles
      const r = w * 0.75 + Math.sin(this.time * 6) * 6;
      const g = ctx.createRadialGradient(0, 0, w * 0.2, 0, 0, r);
      g.addColorStop(0, 'rgba(255,230,120,0.55)');
      g.addColorStop(1, 'rgba(255,230,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      if (Math.random() < 0.15) this.spawnBubble(f.x + (Math.random() - 0.5) * w, f.y, 0.6);
    }
    let rot = 0;
    if (f.state === 'hooked') rot = -Math.PI / 2 + Math.sin(this.time * 22) * 0.25;
    else if (f.state === 'jump') rot = -Math.PI / 2 + f.t * Math.PI * 1.5;
    else rot = Math.sin(f.t * 3) * 0.06;
    ctx.save();
    ctx.rotate(rot);
    const flip = f.state === 'hooked' || f.state === 'jump' ? 1 : f.dir;
    ctx.scale(flip, 1);
    // tail wag by squashing slightly
    const wag = 1 + Math.sin(f.t * 9) * 0.03;
    ctx.scale(wag, 1);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
    // the letter card — always upright, never mirrored
    const cr = h * 0.27;
    const cx = f.state === 'hooked' || f.state === 'jump' ? 0 : -f.dir * w * 0.04;
    const cy = f.state === 'hooked' || f.state === 'jump' ? h * 0.05 : h * 0.06;
    if (this.rs) {
      this.drawWordBadge(f.letter, cx, cy, w, h);
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = 'rgba(120, 90, 40, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cr * 1.08, cr, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1f2a33';
    ctx.font = `700 ${cr * 1.35}px "Noto Naskh Arabic", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillText(f.letter, cx, cy + cr * 0.05);
    ctx.restore();
  }

  /** Role mode: the word on a rounded pill sized to the text; long words shrink to fit. */
  private drawWordBadge(word: string, cx: number, cy: number, w: number, h: number) {
    const { ctx } = this;
    const base = Math.max(15, h * 0.34);
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${base}px ${WORD_FONT}`;
    const m0 = ctx.measureText(word);
    const maxW = Math.max(w * 1.15, h * 1.9);
    const fs = m0.width > maxW ? Math.max(base * 0.6, (base * maxW) / m0.width) : base;
    let tw = m0.width;
    let m = m0;
    if (fs !== base) {
      ctx.font = `700 ${fs}px ${WORD_FONT}`;
      m = ctx.measureText(word);
      tw = m.width;
    }
    // room above and below for harakat
    const asc = m.actualBoundingBoxAscent || fs * 0.75;
    const desc = m.actualBoundingBoxDescent || fs * 0.3;
    const ph = Math.max(fs * 1.5, asc + desc + fs * 0.4);
    const pw = Math.max(ph * 1.2, tw + fs * 1.1);
    const x0 = cx - pw / 2;
    const y0 = cy - ph / 2;
    const r = ph / 2;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x0 + pw - r, y0);
    ctx.arc(x0 + pw - r, cy, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0 + r, y0 + ph);
    ctx.arc(x0 + r, cy, r, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = 'rgba(120, 90, 40, 0.45)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1f2a33';
    ctx.fillText(word, cx, cy + (asc - desc) / 2);
  }
}
