// GameShell: the frame every learning game sits in — HUD (pause, stars, target card with replay),
// Shamma's speech bubble, pause menu, end screen, and a celebration layer (confetti, fireworks,
// sparkles) drawn on its own canvas above the game. Games own their scene; the shell owns the chrome.

import { Music, play, say, sfx, stopVoice } from '../audio';
import { saveStage } from '../progress';

const BASE = import.meta.env.BASE_URL;

export interface ShellOptions {
  root: HTMLElement;
  /** css class put on root, e.g. 'trace' */
  kind: string;
  child: string;
  stageId: string;
  rounds: number;
  /** music loop key, e.g. 'music/race' */
  music?: string;
  /** text on the end screen title */
  doneTitle: string;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
  /** called when the pause state changes so the game can stop its own timers */
  onPause?: (paused: boolean) => void;
  onReplay?: () => void;
}

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

interface Rocket {
  x: number;
  y: number;
  vy: number;
  fuse: number;
  hue: number;
}

const CHEERS = ['أحسنت! رائع!', 'واااو! إجابة صحيحة!', 'ممتاز! أنت بطل!', 'صح! استمرّ هكذا!', 'يا سلام! أنت سريع وذكي!'];

export class GameShell {
  readonly root: HTMLElement;
  readonly hud: HTMLElement;
  readonly stage: HTMLElement; // the game draws or builds its scene inside this element
  el: Record<string, HTMLElement> = {};
  paused = false;
  round = 0;
  firstTry = 0;
  streak = 0;
  done = false;
  private o: ShellOptions;
  private fx: HTMLCanvasElement;
  private fxCtx: CanvasRenderingContext2D;
  private sparks: Spark[] = [];
  private rockets: Rocket[] = [];
  private raf = 0;
  private last = 0;
  private lastCheer = -1;
  private bubbleTimer = 0;
  private music: Music | null;
  private off: (() => void)[] = [];

  constructor(o: ShellOptions) {
    this.o = o;
    this.root = o.root;
    this.root.innerHTML = '';
    this.root.className = `game ${o.kind}`;
    this.stage = document.createElement('div');
    this.stage.className = 'stage-area';
    this.root.appendChild(this.stage);
    this.fx = document.createElement('canvas');
    this.fx.className = 'fx-layer';
    this.fxCtx = this.fx.getContext('2d')!;
    this.root.appendChild(this.fx);
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    this.hud.innerHTML = `
      <button class="hud-btn pause" aria-label="إيقاف مؤقت"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg></button>
      <div class="stars" dir="ltr"><span class="row"></span><span class="count"></span></div>
      <div class="combo" hidden></div>
      <div class="target">
        <div class="card"><span class="syl"></span></div>
        <button class="hud-btn speak" aria-label="أعد الصوت"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
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
          <h2></h2>
          <div class="end-stars" dir="ltr"></div>
          <p class="end-line"></p>
          <p class="end-coins"></p>
          <button class="big next">المرحلة التالية</button>
          <button class="big ghost again">إعادة</button>
          <button class="big ghost exit">الخريطة</button>
        </div>
      </div>`;
    this.root.appendChild(this.hud);
    const q = (s: string) => this.hud.querySelector(s) as HTMLElement;
    this.el = {
      stars: q('.stars .row'),
      count: q('.stars .count'),
      combo: q('.combo'),
      target: q('.target'),
      syl: q('.target .syl'),
      card: q('.target .card'),
      bubble: q('.bubble'),
      bubbleText: q('.bubble span'),
      pauseMenu: q('.pause-menu'),
      musicToggle: q('.music-toggle'),
      end: q('.end'),
      endTitle: q('.end h2'),
      endStars: q('.end-stars'),
      endLine: q('.end-line'),
      endExtra: q('.end-coins'),
    };
    this.press('.pause', () => this.setPaused(true));
    this.press('.resume', () => this.setPaused(false));
    this.press('.music-toggle', () => {
      const on = this.music?.toggle() ?? false;
      this.el.musicToggle.textContent = on ? 'الموسيقى: تعمل' : 'الموسيقى: متوقفة';
    });
    this.press('.restart', () => o.onRestart());
    this.press('.again', () => o.onRestart());
    this.press('.exit', () => o.onExit());
    this.press('.next', () => o.onNext());
    this.press('.speak', () => o.onReplay?.());
    this.press('.card', () => o.onReplay?.());
    this.listen(window, 'resize', () => this.resizeFx());
    this.listen(document, 'visibilitychange', () => document.hidden && this.setPaused(true));
    this.resizeFx();
    this.updateStars();
    this.music = o.music ? new Music(o.music, 0.55) : null;
    this.music?.start();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  destroy() {
    this.done = true;
    cancelAnimationFrame(this.raf);
    this.music?.dispose();
    stopVoice();
    this.off.forEach((f) => f());
    this.root.innerHTML = '';
  }

  listen(t: EventTarget, ev: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(ev, fn, opts);
    this.off.push(() => t.removeEventListener(ev, fn, opts));
  }

  /** Bind a press handler (pointerdown, no ghost click) to HUD or game buttons. */
  press(sel: string | HTMLElement, fn: (b: HTMLElement) => void, scope: ParentNode = this.hud) {
    const list = typeof sel === 'string' ? [...scope.querySelectorAll<HTMLElement>(sel)] : [sel];
    for (const b of list)
      this.listen(b, 'pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.paused || b.closest('.pause-menu')) fn(b);
      });
  }

  // ---------- HUD ----------

  /** Show the target on the card (a letter, a syllable, a word, or '؟' for listen-only). */
  setTarget(text: string, mystery = false) {
    this.el.syl.textContent = text;
    this.el.card.classList.toggle('mystery', mystery);
    this.el.card.classList.toggle('wide', [...text].length > 2);
  }

  pulseCard() {
    this.el.card.classList.remove('pulse');
    void this.el.card.offsetWidth;
    this.el.card.classList.add('pulse');
  }

  updateStars() {
    const n = this.o.rounds;
    this.el.stars.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < this.round ? 'on' : ''}">★</i>`).join('');
    this.el.count.textContent = `${this.round} / ${n}`;
  }

  bubble(text: string, ms = 2200) {
    this.el.bubbleText.textContent = text;
    this.el.bubble.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.el.bubble.classList.remove('show'), ms);
  }

  flash(text: string, ms = 2400) {
    const el = this.el.combo;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    setTimeout(() => (el.hidden = true), ms);
  }

  setPaused(p: boolean) {
    if (this.done && p) return;
    this.paused = p;
    this.el.pauseMenu.hidden = !p;
    if (p) {
      this.music?.pause();
      stopVoice();
    } else {
      this.music?.resume();
    }
    this.o.onPause?.(p);
  }

  // ---------- results ----------

  /**
   * A correct answer: stars, sparkles at (x, y), a cheer (or a streak cheer), then resolves when the
   * voice is done so the game can move on without talking over it. Returns true when the stage is over.
   */
  async correct(independent: boolean, firstTryOfRound: boolean, x?: number, y?: number): Promise<boolean> {
    if (independent) this.firstTry++;
    this.streak = firstTryOfRound ? this.streak + 1 : 0;
    this.round++;
    this.updateStars();
    this.el.stars.querySelectorAll('i.on')[this.round - 1]?.classList.add('pop');
    sfx.correct();
    if (x !== undefined && y !== undefined) this.burst(x, y, 70);
    let line: string;
    let text: string;
    if (this.streak === 3 || this.streak === 5) {
      line = `race/combo${this.streak}`;
      text = this.streak === 3 ? 'ثلاث إجابات صحيحة متتالية! أنت مذهل!' : 'خمس إجابات صحيحة! أنت بطل خارق!';
      play('sfx/combo', 0.8);
      this.flash(`سلسلة ${this.streak}`);
    } else {
      let c = Math.floor(Math.random() * CHEERS.length);
      if (c === this.lastCheer) c = (c + 1) % CHEERS.length;
      this.lastCheer = c;
      line = `race/cheer${c + 1}`;
      text = CHEERS[c];
    }
    this.bubble(text, 2600);
    await say(line, text);
    return this.round >= this.o.rounds;
  }

  /** A wrong answer: streak resets; the game decides what to say. */
  wrong() {
    this.streak = 0;
    sfx.bump();
  }

  /** End of stage: save, celebrate, show the end screen. */
  finish(extra = '') {
    if (this.done) return;
    this.done = true;
    saveStage(this.o.child, this.o.stageId, this.firstTry, this.o.rounds);
    this.music?.duck(0.4);
    sfx.fanfare();
    play('sfx/yay', 0.8);
    this.confetti();
    this.fireworks(9);
    setTimeout(() => void say('race/stage-done', 'مبروك! أنهيت المرحلة'), 900);
    const n = this.o.rounds;
    this.el.endTitle.textContent = this.o.doneTitle;
    this.el.endStars.innerHTML = Array.from({ length: n }, () => '<i class="on">★</i>').join('');
    this.el.endLine.textContent = `أجبت من أول مرة ${this.firstTry} من ${n}`;
    this.el.endExtra.textContent = extra;
    this.el.end.hidden = false;
  }

  // ---------- celebration layer ----------

  burst(x: number, y: number, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 320;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0.7 + Math.random() * 0.6, hue: Math.floor(Math.random() * 360), size: 3.5, g: 400 });
    }
  }

  /** A trail sparkle (for tracing, dragging). */
  sparkle(x: number, y: number, hue = 45) {
    this.sparks.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 60, life: 0.5, hue, size: 2.5, g: 120 });
  }

  confetti() {
    const W = this.fx.clientWidth;
    const H = this.fx.clientHeight;
    for (let i = 0; i < 200; i++)
      this.sparks.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.4, vx: (Math.random() - 0.5) * 120, vy: 60 + Math.random() * 160, life: 2.4 + Math.random() * 1.5, hue: Math.floor(Math.random() * 360), g: 90, size: 5 });
  }

  fireworks(n: number) {
    const W = this.fx.clientWidth;
    const H = this.fx.clientHeight;
    for (let i = 0; i < n; i++)
      setTimeout(() => {
        this.rockets.push({ x: W * (0.15 + Math.random() * 0.7), y: H, vy: -H * (1.15 + Math.random() * 0.35), fuse: 0.9 + Math.random() * 0.4, hue: Math.floor(Math.random() * 360) });
        if (i % 3 === 0) play('sfx/fireworks', 0.55);
      }, i * 420);
  }

  private resizeFx() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const r = this.root.getBoundingClientRect();
    this.fx.width = Math.round(r.width * dpr);
    this.fx.height = Math.round(r.height * dpr);
    this.fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private tick(t: number) {
    this.raf = requestAnimationFrame((tt) => this.tick(tt));
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const ctx = this.fxCtx;
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    if (!this.sparks.length && !this.rockets.length) return;
    for (const r of this.rockets) {
      r.y += r.vy * dt;
      r.vy += 260 * dt;
      r.fuse -= dt;
      if (Math.random() < 0.6) this.sparks.push({ x: r.x, y: r.y, vx: (Math.random() - 0.5) * 30, vy: 40, life: 0.4, hue: 45, g: 0, size: 2 });
      if (r.fuse <= 0)
        for (let i = 0; i < 70; i++) {
          const a = (i / 70) * Math.PI * 2;
          const v = 160 + Math.random() * 140;
          this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.1 + Math.random() * 0.6, hue: r.hue + (Math.random() - 0.5) * 50, g: 120, size: 3.5 });
        }
    }
    this.rockets = this.rockets.filter((r) => r.fuse > 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += s.g * dt;
      s.vx *= 1 - dt * 0.6;
      s.life -= dt;
      ctx.globalAlpha = Math.min(1, Math.max(0, s.life) * 1.5);
      ctx.fillStyle = `hsl(${s.hue} 95% 62%)`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size + Math.max(0, s.life) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    this.sparks = this.sparks.filter((s) => s.life > 0);
    if (this.sparks.length > 600) this.sparks.splice(0, this.sparks.length - 600);
  }
}
