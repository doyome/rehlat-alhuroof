// «سباق الحركات» — pseudo-3D chase-camera driving game.
// The child hears a syllable and steers the Patrol through the gate that carries it.
// Mastery is judged only on the choice; driving speed or steering skill never lowers the score.
// Coins, turbo, combos, horn and fireworks are pure fun: they never affect the learning record.

import { Engine, Music, play, preloadAudio, say, sfx, stopVoice } from '../audio';
import { logAttempt, saveStage } from '../progress';
import { RACE_AUDIO, type RaceStage, type Syllable, stageAudio, syllableAudio, syllableKey, syllableText } from '../data/race';

const BASE = import.meta.env.BASE_URL;

export type RaceMode = 'calm' | 'race';

export interface RaceResult {
  rounds: number;
  firstTry: number;
}

export interface RaceOptions {
  child: string;
  stage: RaceStage;
  mode: RaceMode;
  reducedMotion: boolean;
  onExit: () => void;
  onRestart: () => void;
  onNext: (r: RaceResult) => void;
}

const ASSET = `${BASE}assets/race/`;
const CAR_VIEWS = ['patrol_left.png', 'patrol_left1.png', 'patrol_rear.png', 'patrol_right1.png', 'patrol_right.png'] as const;
const IMG_NAMES = ['backdrop.jpg', ...CAR_VIEWS, 'gate.png', 'palm.png', 'lamp.png', 'bush.png', 'villa.png'] as const;
type ImgName = (typeof IMG_NAMES)[number];
const images = new Map<ImgName, HTMLImageElement>();

export function preloadRace(stage: RaceStage) {
  return Promise.all([
    preloadAudio([...RACE_AUDIO, ...stageAudio(stage)]),
    ...IMG_NAMES.map(
      (n) =>
        new Promise<void>((res) => {
          if (images.has(n)) return res();
          const im = new Image();
          im.onload = () => res();
          im.onerror = () => res();
          im.src = ASSET + n;
          images.set(n, im);
        }),
    ),
  ]);
}

const Z_CAR = 2.0;
const Z_FAR = 70;
const SEG = 0.5;
const SPAWN = 26;
const CAR_W = 0.66;
const GATE_W = 1.12;
const SPEED: Record<RaceMode, number> = { calm: 4.6, race: 7.8 };
// each cheer bubble matches its recorded line (Shamma's voice)
const CHEERS = ['أحسنت! رائع!', 'واااو! إجابة صحيحة!', 'ممتاز! أنت بطل!', 'صح! استمرّ هكذا!', 'يا سلام! أنت سريع وذكي!'];
let introPlayed = false;

// the coast road: gentle bends and hills (world units along the road)
const ramp = (d: number) => Math.min(1, Math.max(0, (d - 20) / 60));
const curveAt = (d: number) => ramp(d) * (1.1 * Math.sin(d * 0.03) + 0.35 * Math.sin(d * 0.071 + 1.3));
const slopeAt = (d: number) => (curveAt(d + 0.5) - curveAt(d - 0.5)) / 1;
const hillAt = (d: number) => ramp(d) * (0.16 * Math.sin(d * 0.045 + 0.5) + 0.04 * Math.sin(d * 0.11));

interface Gate {
  lane: number;
  syl: Syllable | null; // null = flower barrier in an unused lane
  wobble: number;
}

interface Wave {
  zw: number;
  target: Syllable;
  gates: Gate[];
  judged: boolean;
  tries: number;
  help: number;
  spawnedAt: number;
}

interface Prop {
  img: ImgName;
  x: number;
  zw: number;
  h: number;
}

interface Coin {
  lane: number;
  zw: number;
  taken: number; // 0 = on the road, >0 = flying to the counter
  x?: number;
  y?: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  shade: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  g?: number; // gravity (default 600)
  size?: number;
}

interface Rocket {
  x: number;
  y: number;
  vy: number;
  fuse: number;
  hue: number;
}

type Phase = 'ready' | 'intro' | 'drive' | 'bump' | 'finish' | 'done';

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const mixCache = new Map<string, string>();
const mix = (a: number[], b: number[], t: number) => {
  const q = Math.round(t * 20);
  const key = `${a.join(',')}|${q}`;
  let c = mixCache.get(key);
  if (!c) {
    c = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * (q / 20))).join(',')})`;
    mixCache.set(key, c);
  }
  return c;
};
const HAZE = [214, 230, 238];

/** A soft round puff, drawn once and reused for every smoke particle. */
function puffSprite(shade: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, `rgba(${shade},${shade},${shade},1)`);
  r.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return c;
}
const PUFF_LIGHT = puffSprite(238);
const PUFF_DARK = puffSprite(170);

export class RaceGame {
  private root: HTMLElement;
  private o: RaceOptions;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private k0 = 1;
  private k = 1;
  private horizon = 0;
  private camH = 0.6;
  private camX = 0;
  private travel = 0;
  private speed = 0;
  private carX = 0;
  private lane = 0;
  private phase: Phase = 'ready';
  private voiceDone = true;
  private lastCheer = -1;
  private phaseT = 0;
  private paused = false;
  private wave: Wave | null = null;
  private prevWave: Wave | null = null;
  private round = 0;
  private firstTry = 0;
  private streak = 0;
  private coins: Coin[] = [];
  private coinCount = 0;
  private props: Prop[] = [];
  private propZ = 0;
  private sparks: Spark[] = [];
  private rockets: Rocket[] = [];
  private puffs: Puff[] = [];
  private brake = 0;
  private boost = 0;
  private exhaustT = 0;
  private yaw = 0;
  private view = 2; // index into CAR_VIEWS, changed with hysteresis so it never flickers
  private shake = 0;
  private susp = 0;
  private suspV = 0;
  private bumpT = 2;
  private hornCool = 0;
  // road shape around the car, refreshed every frame
  private cBase = 0;
  private cSlope = 0;
  private eBase = 0;
  private eSlope = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  private engine = new Engine();
  private music = new Music('music/race', 0.6);
  private el: Record<string, HTMLElement> = {};
  private recent: string[] = [];
  private off: (() => void)[] = [];

  constructor(root: HTMLElement, opts: RaceOptions) {
    this.root = root;
    this.o = opts;
    root.innerHTML = '';
    root.className = 'race';
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    root.appendChild(this.canvas);
    this.buildHud();
    this.resize();
    this.listen(window, 'resize', () => this.resize());
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    this.listen(document, 'visibilitychange', () => document.hidden && this.setPaused(true));
    this.bindSwipe();
    for (let i = 0; i < 40; i++) this.spawnProps();
    this.updateStars();
    this.updateCoins();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    this.engine.start();
    if (import.meta.env.DEV) (window as unknown as { __race: RaceGame }).__race = this;
    void this.startSequence();
  }

  /** Welcome (first stage of the session only), then a 3-2-1 countdown, then go. */
  private async startSequence() {
    if (!introPlayed) {
      introPlayed = true;
      this.bubble('يلّا نبدأ السباق! اسمع الصوت وانطلق إلى البوابة الصحيحة', 6500);
      await say('race/intro', 'هيّا نبدأ السباق');
      if (this.phase !== 'ready') return;
    }
    const el = this.el.countdown;
    el.hidden = false;
    play('sfx/countdown', 0.6);
    this.engine.rev(1.2);
    void say('race/countdown', 'ثلاثة اثنان واحد انطلق');
    const marks: [number, string][] = [[0, '3'], [800, '2'], [1600, '1'], [2450, 'انطلق!']];
    for (const [ms, label] of marks) {
      setTimeout(() => {
        el.textContent = label;
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
        if (ms < 2400) this.engine.rev(0.6);
      }, ms);
    }
    setTimeout(() => {
      el.hidden = true;
      if (this.phase !== 'ready') return;
      this.phase = 'intro';
      this.phaseT = 0;
      play('sfx/drift', 0.5);
      this.tyreSmoke(30, 0);
      this.music.start();
    }, 2900);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.engine.dispose();
    this.music.dispose();
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
      <div class="coins" dir="ltr"><i class="coin-ico"></i><b>0</b></div>
      <div class="stars" dir="ltr"><span class="row"></span><span class="count"></span></div>
      <div class="combo" hidden></div>
      <div class="target">
        <div class="card"><span class="syl"></span></div>
        <button class="hud-btn speak" aria-label="أعد الصوت"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </div>
      <button class="arrow left" aria-label="يسار"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="horn" aria-label="البوري"><svg viewBox="0 0 24 24"><path d="M3 10v4h3l6 4V6L6 10H3z"/><path d="M15 9l5-3M15 12h6M15 15l5 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      <button class="arrow right" aria-label="يمين"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="bubble"><img src="${BASE}assets/chars/shamma_face.png" alt=""><span></span></div>
      <div class="turbo" hidden>تيربو!</div>
      <div class="countdown" hidden></div>
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
          <h2>أنهيت المرحلة!</h2>
          <div class="end-stars" dir="ltr"></div>
          <p class="end-line"></p>
          <p class="end-coins" dir="rtl"></p>
          <button class="big next">المرحلة التالية</button>
          <button class="big ghost again">إعادة</button>
          <button class="big ghost exit">الخريطة</button>
        </div>
      </div>`;
    this.root.appendChild(h);
    const q = (s: string) => h.querySelector(s) as HTMLElement;
    this.el = {
      stars: q('.stars .row'),
      countdown: q('.countdown'),
      count: q('.stars .count'),
      coins: q('.coins b'),
      coinBox: q('.coins'),
      combo: q('.combo'),
      turbo: q('.turbo'),
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
    };
    const press = (sel: string, fn: () => void) =>
      h.querySelectorAll(sel).forEach((b) =>
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        }),
      );
    press('.pause', () => this.setPaused(true));
    press('.resume', () => this.setPaused(false));
    press('.music-toggle', () => {
      const on = this.music.toggle();
      this.el.musicToggle.textContent = on ? 'الموسيقى: تعمل' : 'الموسيقى: متوقفة';
    });
    press('.restart', () => this.restart());
    press('.again', () => this.restart());
    press('.exit', () => this.o.onExit());
    press('.next', () => this.o.onNext({ rounds: this.o.stage.rounds, firstTry: this.firstTry }));
    press('.speak', () => this.replay());
    press('.card', () => this.replay());
    press('.arrow.left', () => this.steer(-1));
    press('.arrow.right', () => this.steer(1));
    press('.horn', () => this.honk());
  }

  private updateStars() {
    const n = this.o.stage.rounds;
    this.el.stars.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < this.round ? 'on' : ''}">★</i>`).join('');
    this.el.count.textContent = `${this.round} / ${n}`;
  }

  private updateCoins() {
    this.el.coins.textContent = String(this.coinCount);
    this.el.coinBox.classList.remove('bump');
    void this.el.coinBox.offsetWidth;
    this.el.coinBox.classList.add('bump');
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

  // ---------- input ----------

  private onKey(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.steer(-1);
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.steer(1);
    else if (e.key === ' ' || e.key === 'p' || e.key === 'Escape') this.setPaused(!this.paused);
    else if (e.key === 'r' || e.key === 'R') this.replay();
    else if (e.key === 'h' || e.key === 'H' || e.key === 'Enter') this.honk();
    else return;
    e.preventDefault();
  }

  private bindSwipe() {
    let sx = 0;
    let sy = 0;
    let st = 0;
    this.listen(this.canvas, 'pointerdown', (e) => {
      const p = e as PointerEvent;
      sx = p.clientX;
      sy = p.clientY;
      st = performance.now();
    });
    this.listen(this.canvas, 'pointerup', (e) => {
      const p = e as PointerEvent;
      const dx = p.clientX - sx;
      const dy = p.clientY - sy;
      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) this.steer(dx > 0 ? 1 : -1);
      else if (performance.now() - st < 300 && Math.abs(dx) < 12) this.steer(p.clientX < this.W / 2 ? -1 : 1);
    });
  }

  private steer(dir: number) {
    if (this.paused || this.phase === 'done') return;
    const next = Math.max(-1, Math.min(1, this.lane + dir));
    if (next !== this.lane) {
      this.lane = next;
      if (this.speed > 1) {
        sfx.squeal();
        this.tyreSmoke(8, dir);
      } else sfx.tap();
    }
  }

  private honk() {
    if (this.paused || this.hornCool > 0) return;
    this.hornCool = 0.7;
    play('sfx/horn', 0.9);
    const b = this.root.querySelector('.horn');
    b?.classList.remove('honk');
    void (b as HTMLElement | null)?.offsetWidth;
    b?.classList.add('honk');
    if (Math.random() < 0.35 && this.voiceDone && this.phase === 'drive' && !this.wave) void say('race/beep', 'بيب بيب');
  }

  private setPaused(p: boolean) {
    if (this.phase === 'done') return;
    this.paused = p;
    this.el.pauseMenu.hidden = !p;
    if (p) {
      this.engine.stop();
      this.music.pause();
      stopVoice();
    } else {
      this.engine.start();
      this.music.resume();
      this.last = performance.now();
    }
  }

  private restart() {
    this.o.onRestart();
  }

  private replay() {
    if (!this.wave || this.paused) return;
    this.wave.help = Math.max(this.wave.help, 1);
    this.sayTarget();
  }

  private sayTarget() {
    if (!this.wave || this.phase === 'done') return;
    const t = this.wave.target;
    void say(syllableAudio(t), syllableText(t));
    this.el.card.classList.remove('pulse');
    void this.el.card.offsetWidth;
    this.el.card.classList.add('pulse');
  }

  // ---------- game flow ----------

  private pickTarget(): Syllable {
    const s = this.o.stage;
    let t: Syllable;
    let guard = 0;
    do {
      t = { letter: s.letters[Math.floor(Math.random() * s.letters.length)], haraka: s.harakat[Math.floor(Math.random() * s.harakat.length)] };
    } while (this.recent.slice(-1).includes(syllableKey(t)) && guard++ < 10);
    this.recent.push(syllableKey(t));
    return t;
  }

  private layoutGates(target: Syllable): Gate[] {
    const opts = this.o.stage.harakat.map((h) => ({ letter: target.letter, haraka: h }));
    const lanes = shuffle([-1, 0, 1]);
    return lanes.map((lane, i) => ({ lane, syl: opts[i] ?? null, wobble: 0 })).sort((a, b) => a.lane - b.lane);
  }

  private spawnWave(target?: Syllable, dist = SPAWN) {
    const t = target ?? this.pickTarget();
    const w: Wave = {
      zw: this.travel + dist,
      target: t,
      gates: this.layoutGates(t),
      judged: false,
      tries: this.wave && target ? this.wave.tries : 0,
      help: this.wave && target ? this.wave.help : 0,
      spawnedAt: performance.now(),
    };
    this.wave = w;
    this.el.syl.textContent = syllableText(t);
    setTimeout(() => this.sayTarget(), target ? 300 : 500);
  }

  /** A short trail of coins in one lane: optional fun between gates. */
  private spawnCoins() {
    const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    for (let i = 0; i < 6; i++) this.coins.push({ lane, zw: this.travel + 7 + i * 1.5, taken: 0 });
  }

  private judge(w: Wave) {
    const gate = w.gates.find((g) => g.lane === this.lane)!;
    const correct = !!gate.syl && syllableKey(gate.syl) === syllableKey(w.target);
    w.tries++;
    logAttempt({
      child: this.o.child,
      activity: 'vowel-race',
      stage: this.o.stage.id,
      item: syllableText(w.target),
      answer: gate.syl ? syllableText(gate.syl) : 'none',
      correct,
      help: w.help,
      tries: w.tries,
      ms: Math.round(performance.now() - w.spawnedAt),
    });
    if (correct) {
      w.judged = true;
      const independent = w.tries === 1 && w.help === 0;
      if (independent) this.firstTry++;
      this.streak = w.tries === 1 ? this.streak + 1 : 0;
      this.round++;
      this.updateStars();
      sfx.correct();
      play('sfx/gate-pop', 0.7);
      this.startBoost();
      this.burst(gate.lane);
      this.el.stars.querySelectorAll('i.on')[this.round - 1]?.classList.add('pop');
      this.prevWave = w;
      this.wave = null;
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
        line = `race/cheer${c + 1}`;
        text = CHEERS[c];
      }
      this.bubble(text, 2800);
      if (this.round >= this.o.stage.rounds) {
        this.phase = 'finish';
        this.phaseT = 0;
        void say(line, text);
      } else {
        this.spawnCoins();
        // the next syllable waits for the cheer to finish, so the two never talk over each other
        const t0 = performance.now();
        void say(line, text).then(() =>
          setTimeout(() => this.phase === 'drive' && !this.wave && this.spawnWave(), Math.max(0, 1600 - (performance.now() - t0))),
        );
      }
    } else {
      this.streak = 0;
      gate.wobble = 1;
      this.phase = 'bump';
      this.phaseT = 0;
      this.speed = 0;
      this.boost = 0;
      if (!this.o.reducedMotion) this.shake = 1;
      this.brake = 1.6;
      this.suspV -= 6;
      this.tyreSmoke(22, 0);
      sfx.bump();
      this.voiceDone = false;
      const done = () => (this.voiceDone = true);
      if (w.tries >= 2) {
        w.help = 2;
        this.bubble('استمع جيدًا… البوابة المضيئة هي الصحيحة!', 4800);
        void say('race/hint', 'البوابة المضيئة هي الصحيحة').then(done);
      } else if (gate.syl) {
        this.bubble('لا بأس! لنجرّبها مرة أخرى… أنت تستطيع!', 4800);
        void say('race/retry', 'لنجربها مرة أخرى').then(done);
      } else {
        this.bubble('اختر إحدى البوابات!', 2600);
        void say('race/choose', 'اختر إحدى البوابات').then(done);
      }
    }
  }

  private startBoost() {
    this.boost = 1;
    play('sfx/boost', 0.75);
    this.engine.rev(1.8);
    this.flash(this.el.turbo, 'تيربو!', 1300);
  }

  private finish() {
    this.phase = 'done';
    this.engine.stop();
    this.music.duck(0.4);
    saveStage(this.o.child, this.o.stage.id, this.firstTry, this.o.stage.rounds);
    sfx.fanfare();
    play('sfx/yay', 0.8);
    this.confetti();
    this.launchFireworks(9);
    setTimeout(() => void say('race/stage-done', 'مبروك! أنهيت المرحلة'), 900);
    const n = this.o.stage.rounds;
    this.el.endStars.innerHTML = Array.from({ length: n }, () => '<i class="on">★</i>').join('');
    this.el.endLine.textContent = `أجبت من أول مرة ${this.firstTry} من ${n}`;
    this.el.endCoins.textContent = `جمعت ${this.coinCount} قطعة ذهبية`;
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

  private update(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    this.hornCool = Math.max(0, this.hornCool - dt);
    this.boost = Math.max(0, this.boost - dt / 1.8);
    const cruise = SPEED[this.o.mode];
    const target = cruise * (1 + 0.9 * Math.sin(Math.min(1, this.boost) * Math.PI * 0.5));

    if (this.phase === 'ready') {
      this.speed = 0;
    } else if (this.phase === 'intro') {
      this.speed = Math.min(cruise, this.speed + cruise * dt * 1.1);
      if (this.phaseT > 1.4) {
        this.phase = 'drive';
        this.spawnWave();
      }
    } else if (this.phase === 'drive') {
      this.speed += (target - this.speed) * Math.min(1, dt * 2.2);
    } else if (this.phase === 'bump') {
      this.speed = 0;
      if (this.phaseT > 1.1 && (this.voiceDone || this.phaseT > 5) && this.wave) {
        this.phase = 'drive';
        this.speed = cruise * 0.3;
        this.spawnWave(this.wave.target, SPAWN * 0.6);
      }
    } else if (this.phase === 'finish') {
      this.speed = Math.max(0, this.speed - cruise * dt * 0.7);
      if (this.phaseT > 1.6) this.finish();
    }

    this.travel += this.speed * dt;
    this.engine.setSpeed(this.speed);

    // road shape at the car
    const dc = this.travel + Z_CAR;
    this.cBase = curveAt(dc);
    this.cSlope = slopeAt(dc);
    this.eBase = hillAt(dc);
    this.eSlope = hillAt(dc + 0.5) - hillAt(dc - 0.5);

    this.carX += (this.lane - this.carX) * Math.min(1, dt * 4.2);
    this.camX = this.carX * 0.6;
    this.k = this.k0 * (1 - 0.07 * Math.min(1, this.boost * 1.5));
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.phase === 'finish') this.brake = 0.6;
    this.brake = Math.max(0, this.brake - dt);

    // body: the car only turns while it changes lane, then straightens; light suspension on road bumps
    const slip = this.lane - this.carX;
    this.yaw += (slip * 0.42 - this.yaw) * Math.min(1, dt * 10);
    const y = this.yaw;
    const v = this.view;
    if (v === 2) this.view = y < -0.09 ? 1 : y > 0.09 ? 3 : 2;
    else if (v === 1) this.view = y < -0.24 ? 0 : y > -0.05 ? 2 : 1;
    else if (v === 3) this.view = y > 0.24 ? 4 : y < 0.05 ? 2 : 3;
    else if (v === 0) this.view = y > -0.18 ? 1 : 0;
    else this.view = y < 0.18 ? 3 : 4;
    this.suspV += (-60 * this.susp - 7 * this.suspV) * dt;
    this.susp += this.suspV * dt;
    this.bumpT -= dt * (this.speed / cruise);
    if (this.bumpT <= 0 && this.speed > 1) {
      this.bumpT = 1.2 + Math.random() * 2.2;
      this.suspV -= 1.2 + Math.random() * 1.2;
      play('sfx/thump', 0.2);
    }
    if (Math.abs(slip) > 0.2 && this.speed > 1 && Math.random() < dt * 50) this.tyreSmoke(1, Math.sign(slip));
    this.exhaustT -= dt;
    if (this.exhaustT <= 0 && this.speed > 0.3) {
      this.exhaustT = this.phase === 'intro' || this.boost > 0 ? 0.05 : 0.18;
      this.exhaust();
    }
    for (const f of this.puffs) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= 1 - dt * 1.5;
      f.r += dt * f.max;
      f.life -= dt;
    }
    this.puffs = this.puffs.filter((f) => f.life > 0);
    if (this.puffs.length > 90) this.puffs.splice(0, this.puffs.length - 90);

    if (this.wave && !this.wave.judged && this.phase === 'drive' && this.wave.zw - this.travel <= Z_CAR + 0.15) {
      this.wave.zw = this.travel + Z_CAR + 0.15;
      this.judge(this.wave);
    }
    for (const w of [this.wave, this.prevWave]) w?.gates.forEach((g) => (g.wobble = Math.max(0, g.wobble - dt * 1.5)));
    if (this.prevWave && this.prevWave.zw - this.travel < 0.3) this.prevWave = null;

    // coins
    const carLane = Math.round(this.carX);
    for (const c of this.coins) {
      const z = c.zw - this.travel;
      if (!c.taken && z <= Z_CAR + 0.25 && z > Z_CAR - 0.5 && c.lane === carLane) {
        c.taken = 0.001;
        const p = this.proj(c.lane, Math.max(z, 0.8), 0.35);
        c.x = p.x;
        c.y = p.y;
        this.coinCount++;
        this.updateCoins();
        play('sfx/coin', 0.6, 0.95 + Math.random() * 0.2);
        this.coinBurst(p.x, p.y);
      } else if (c.taken) c.taken += dt;
    }
    this.coins = this.coins.filter((c) => (c.taken ? c.taken < 0.6 : c.zw - this.travel > 0.6));

    while (this.propZ < this.travel + Z_FAR) this.spawnProps();
    this.props = this.props.filter((p) => p.zw - this.travel > 0.4);

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
      s.vy += (s.g ?? 600) * dt;
      s.vx *= 1 - dt * 0.6;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  private spawnProps() {
    const z = this.propZ;
    const n = Math.round(z / 3);
    this.props.push({ img: 'palm.png', x: -2.35, zw: z, h: 3.0 + (n % 3) * 0.25 });
    if (n % 2 === 0) this.props.push({ img: 'lamp.png', x: 2.2, zw: z + 1.5, h: 2.1 });
    else this.props.push({ img: 'palm.png', x: 2.45, zw: z + 1.5, h: 2.9 });
    if (n % 3 === 0) this.props.push({ img: 'bush.png', x: 2.35, zw: z + 0.7, h: 0.6 });
    if (n % 4 === 1) this.props.push({ img: 'villa.png', x: 5.2, zw: z + 2.2, h: 2.4 });
    if (n % 5 === 2) this.props.push({ img: 'bush.png', x: -2.0, zw: z + 2.2, h: 0.5 });
    this.propZ += 3;
  }

  /** Car-local anchor in screen space: u across the car (-0.5..0.5), v up from the wheels (0..1). */
  private carPoint(u: number, v: number) {
    const p = this.proj(this.carX, Z_CAR);
    const wp = CAR_W * p.s;
    return { x: p.x + u * wp, y: p.y - v * wp * 0.88 + this.susp * 6, wp };
  }

  private tyreSmoke(n: number, dir: number) {
    if (this.o.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const a = this.carPoint(side * 0.38 + (Math.random() - 0.5) * 0.06, 0.03);
      this.puffs.push({
        x: a.x,
        y: a.y,
        vx: -dir * a.wp * (0.8 + Math.random() * 0.8) + (Math.random() - 0.5) * a.wp * 0.6,
        vy: -a.wp * (0.2 + Math.random() * 0.35),
        r: a.wp * 0.07,
        max: a.wp * (0.35 + Math.random() * 0.3),
        life: 0.9 + Math.random() * 0.7,
        shade: 225 + Math.random() * 25,
      });
    }
  }

  private exhaust() {
    if (this.o.reducedMotion) return;
    const a = this.carPoint(-0.3, 0.1);
    this.puffs.push({ x: a.x, y: a.y, vx: -a.wp * 0.15, vy: -a.wp * 0.12, r: a.wp * 0.02, max: a.wp * 0.1, life: 0.6, shade: 165 });
  }

  private confetti() {
    if (this.o.reducedMotion) return;
    for (let i = 0; i < 200; i++) {
      this.sparks.push({
        x: Math.random() * this.W,
        y: -20 - Math.random() * this.H * 0.4,
        vx: (Math.random() - 0.5) * 120,
        vy: 60 + Math.random() * 160,
        life: 2.4 + Math.random() * 1.5,
        hue: Math.floor(Math.random() * 360),
        g: 90,
        size: 5,
      });
    }
  }

  private launchFireworks(n: number) {
    if (this.o.reducedMotion) return;
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

  private coinBurst(x: number, y: number) {
    if (this.o.reducedMotion) return;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 200;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0.5 + Math.random() * 0.3, hue: 45, size: 3 });
    }
  }

  private burst(lane: number) {
    if (this.o.reducedMotion) return;
    const p = this.proj(lane, Z_CAR + 1.2, GATE_W * 0.64);
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 160 + Math.random() * 420;
      this.sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 260, life: 0.8 + Math.random() * 0.7, hue: Math.floor(Math.random() * 360), size: 4 });
    }
  }

  // ---------- rendering ----------

  private resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.W = this.root.clientWidth || window.innerWidth;
    this.H = this.root.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const portrait = this.H > this.W;
    const yCar = this.H * (portrait ? 0.86 : 0.95);
    this.horizon = this.H * (portrait ? 0.36 : 0.42);
    this.camH = 0.62;
    this.k0 = ((yCar - this.horizon) * Z_CAR) / this.camH;
    const kMax = (this.W * (portrait ? 1.5 : 1.22) * Z_CAR) / 3;
    if (this.k0 > kMax) {
      this.k0 = kMax;
      this.camH = ((yCar - this.horizon) * Z_CAR) / this.k0;
    }
    this.k = this.k0;
  }

  /** Project a road-relative point (lane offset x, depth z, height above the road h) to the screen. */
  private proj(x: number, z: number, h = 0) {
    const s = this.k / z;
    const d = this.travel + z;
    const dz = z - Z_CAR;
    // camera follows the road's heading at the car; the road ahead bends and climbs relative to it
    const ox = curveAt(d) - this.cBase - dz * this.cSlope;
    const oy = hillAt(d) - this.eBase - dz * this.eSlope;
    return { x: this.W / 2 + (x + ox - this.camX) * s, y: this.horizon + (this.camH - oy - h) * s, s };
  }

  private draw() {
    const { ctx } = this;
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.sin(this.time * 70) * 8 * this.shake, Math.cos(this.time * 55) * 4 * this.shake);
    this.drawSky();
    this.drawGround();

    const items: { z: number; draw: () => void }[] = [];
    for (const p of this.props) items.push({ z: p.zw - this.travel, draw: () => this.sprite(p.img, p.x, p.zw - this.travel, p.h) });
    for (const w of [this.prevWave, this.wave]) {
      if (!w) continue;
      for (const g of w.gates) items.push({ z: w.zw - this.travel + g.lane * 0.001, draw: () => this.drawGate(w, g) });
    }
    for (const c of this.coins) if (!c.taken) items.push({ z: c.zw - this.travel, draw: () => this.drawCoin(c) });
    items.push({ z: Z_CAR, draw: () => this.drawCar() });
    items.push({ z: Z_CAR - 0.01, draw: () => this.drawPuffs() });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) if (it.z > 0.35 && it.z < Z_FAR) it.draw();
    ctx.restore();

    this.drawSpeedLines();
    this.drawFlyingCoins();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      ctx.globalAlpha = Math.min(1, s.life * 1.5);
      ctx.fillStyle = `hsl(${s.hue} 95% 62%)`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, (s.size ?? 4) + s.life * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSky() {
    const { ctx, W } = this;
    const g = ctx.createLinearGradient(0, -40, 0, this.horizon);
    g.addColorStop(0, '#3a8fe0');
    g.addColorStop(1, '#bfe4f8');
    ctx.fillStyle = g;
    ctx.fillRect(-60, -60, W + 120, this.horizon + 62);
    const im = images.get('backdrop.jpg');
    if (im?.complete && im.naturalWidth) {
      const sc = Math.max((W * 1.5) / im.naturalWidth, (this.horizon * 1.02) / im.naturalHeight);
      const w = im.naturalWidth * sc;
      const h = im.naturalHeight * sc;
      // the backdrop slides as the road turns
      const x = (W - w) / 2 - this.camX * 18 - Math.max(-1, Math.min(1, this.cSlope * 3)) * (w - W) * 0.3;
      ctx.drawImage(im, x, this.horizon + 2 - h, w, h);
    }
  }

  private drawGround() {
    const { ctx, W, H } = this;
    const sea = ctx.createLinearGradient(0, this.horizon, 0, H);
    sea.addColorStop(0, '#5cc2d6');
    sea.addColorStop(1, '#1b8fb0');
    ctx.fillStyle = sea;
    ctx.fillRect(-60, this.horizon, W / 2 + 60, H - this.horizon + 60);
    ctx.fillStyle = '#e7d3ac';
    ctx.fillRect(W / 2, this.horizon, W / 2 + 60, H - this.horizon + 60);

    const off = this.travel % SEG;
    const zs: number[] = [];
    for (let z = Z_FAR - ((Z_FAR + off) % SEG); z > 0.4; z -= SEG) zs.push(z);
    zs.push(0.4);
    const band = (z1: number, z2: number, x1: number, x2: number, color: string) => {
      const a = this.proj(x1, z1);
      const b = this.proj(x2, z1);
      const c = this.proj(x2, z2);
      const d = this.proj(x1, z2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y + 0.6);
      ctx.lineTo(d.x, d.y + 0.6);
      ctx.fill();
    };
    for (let i = 0; i < zs.length - 1; i++) {
      const z1 = zs[i];
      const z2 = zs[i + 1];
      const n = Math.round((z1 + this.travel) / SEG);
      const fog = Math.min(0.75, Math.max(0, (z1 - 12) / 60));
      const c = (rgb: number[]) => mix(rgb, HAZE, fog);
      band(z1, z2, -60, -2.2, c(n % 2 ? [32, 162, 198] : [40, 172, 206]));
      band(z1, z2, -2.2, -1.7, c([240, 226, 198]));
      band(z1, z2, -1.7, -1.5, c(n % 2 ? [214, 64, 58] : [250, 246, 236]));
      band(z1, z2, -1.5, 1.5, c(n % 2 ? [86, 92, 106] : [96, 101, 116]));
      band(z1, z2, -1.45, -1.41, c([250, 250, 244]));
      band(z1, z2, 1.41, 1.45, c([250, 250, 244]));
      if (n % 4 < 2) {
        band(z1, z2, -0.53, -0.47, c([255, 214, 70]));
        band(z1, z2, 0.47, 0.53, c([255, 214, 70]));
      }
      band(z1, z2, 1.5, 1.7, c(n % 2 ? [214, 64, 58] : [250, 246, 236]));
      band(z1, z2, 1.7, 2.6, c([240, 226, 198]));
      band(z1, z2, 2.6, 60, c(n % 3 ? [226, 206, 158] : [218, 198, 150]));
      const a = this.proj(-2.2, z1);
      const b = this.proj(-2.2, z2);
      const hh = 0.16;
      ctx.fillStyle = c([230, 212, 178]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x, a.y - hh * a.s);
      ctx.lineTo(b.x, b.y - hh * b.s);
      ctx.lineTo(b.x, b.y + 0.6);
      ctx.fill();
    }
  }

  private sprite(name: ImgName, x: number, z: number, h: number) {
    const im = images.get(name);
    if (!im?.complete || !im.naturalWidth) return;
    const p = this.proj(x, z);
    const hp = h * p.s;
    const wp = (hp * im.naturalWidth) / im.naturalHeight;
    if (p.x + wp / 2 < -80 || p.x - wp / 2 > this.W + 80) return;
    const fog = Math.min(0.7, Math.max(0, (z - 14) / 60));
    this.ctx.globalAlpha = 1 - fog;
    this.ctx.drawImage(im, p.x - wp / 2, p.y - hp, wp, hp);
    this.ctx.globalAlpha = 1;
  }

  private drawCoin(c: Coin) {
    const { ctx } = this;
    const z = c.zw - this.travel;
    const p = this.proj(c.lane, z, 0.32 + Math.sin(this.time * 4 + c.zw) * 0.04);
    const r = 0.15 * p.s;
    const squash = Math.abs(Math.cos(this.time * 5 + c.zw));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, r * 2.2, r * 0.8, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(Math.max(0.12, squash), 1);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#fff6b0');
    g.addColorStop(0.5, '#ffcc1a');
    g.addColorStop(1, '#d48a00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = r * 0.14;
    ctx.strokeStyle = '#b66f00';
    ctx.stroke();
    ctx.fillStyle = '#fff3a0';
    ctx.font = `800 ${r * 1.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', 0, r * 0.05);
    ctx.restore();
  }

  private drawFlyingCoins() {
    const { ctx } = this;
    const box = this.el.coinBox.getBoundingClientRect();
    const tx = box.left + 20;
    const ty = box.top + box.height / 2;
    for (const c of this.coins) {
      if (!c.taken || c.x === undefined || c.y === undefined) continue;
      const t = Math.min(1, c.taken / 0.6);
      const e = t * t;
      const x = c.x + (tx - c.x) * e;
      const y = c.y + (ty - c.y) * e - Math.sin(t * Math.PI) * 60;
      ctx.fillStyle = '#ffcc1a';
      ctx.strokeStyle = '#b66f00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12 * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawSpeedLines() {
    const b = Math.min(1, this.boost * 1.4);
    if (b <= 0 || this.o.reducedMotion) return;
    const { ctx, W, H } = this;
    const cx = W / 2;
    const cy = this.horizon;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.75 * b})`;
    ctx.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = Math.min(W, H) * (0.3 + Math.random() * 0.4);
      const len = Math.min(W, H) * (0.12 + Math.random() * 0.25) * b;
      ctx.lineWidth = 1.5 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.7);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len) * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGate(w: Wave, g: Gate) {
    const { ctx } = this;
    const z = w.zw - this.travel;
    if (z < 0.35) return;
    if (!g.syl) {
      for (const dx of [-0.28, 0, 0.28]) this.sprite('bush.png', g.lane + dx, z, 0.5);
      return;
    }
    const im = images.get('gate.png');
    if (!im?.complete || !im.naturalWidth) return;
    const p = this.proj(g.lane, z);
    const wp = GATE_W * p.s;
    const hp = (wp * im.naturalHeight) / im.naturalWidth;
    const fog = Math.min(0.6, Math.max(0, (z - 14) / 60));
    const hint = w === this.wave && w.help >= 2 && syllableKey(g.syl) === syllableKey(w.target);
    if (hint) {
      // a glowing path on the road from the car to the right gate
      const a = this.proj(g.lane - 0.42, z);
      const b = this.proj(g.lane + 0.42, z);
      const c = this.proj(g.lane + 0.42, Math.max(0.5, Z_CAR - 1));
      const d = this.proj(g.lane - 0.42, Math.max(0.5, Z_CAR - 1));
      const grd = ctx.createLinearGradient(0, a.y, 0, c.y);
      const pulse = 0.5 + Math.sin(this.time * 5) * 0.15;
      grd.addColorStop(0, `rgba(255, 196, 40, ${pulse})`);
      grd.addColorStop(1, `rgba(255, 196, 40, ${pulse * 0.4})`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.fill();
    }
    ctx.save();
    ctx.globalAlpha = 1 - fog;
    ctx.translate(p.x, p.y);
    if (g.wobble > 0) ctx.rotate(Math.sin(g.wobble * 18) * 0.05 * g.wobble);
    if (hint) {
      ctx.shadowColor = 'rgba(255, 214, 90, 0.95)';
      ctx.shadowBlur = 30 + Math.sin(this.time * 6) * 12;
    }
    ctx.drawImage(im, -wp / 2, -hp, wp, hp);
    ctx.shadowBlur = 0;
    // the syllable on the ivory panel — always live text, never part of the image
    const fs = hp * 0.27;
    ctx.font = `700 ${fs}px "Noto Naskh Arabic", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#1f2a33';
    ctx.fillText(syllableText(g.syl), 0, -hp * 0.62);
    if (g.wobble > 0) {
      ctx.globalAlpha = g.wobble * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-wp * 0.28, -hp * 0.5, wp * 0.56, hp * 0.5);
    }
    ctx.restore();
  }

  private drawPuffs() {
    const { ctx } = this;
    for (const f of this.puffs) {
      ctx.globalAlpha = Math.min(1, Math.max(0, f.life) * 0.65);
      ctx.drawImage(f.shade < 200 ? PUFF_DARK : PUFF_LIGHT, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawCar() {
    const { ctx } = this;
    const slip = this.lane - this.carX;
    // five real views of his Patrol, picked by how far the nose points left or right
    const view = this.view;
    const im = images.get(CAR_VIEWS[view]);
    if (!im?.complete || !im.naturalWidth) return;
    const p = this.proj(this.carX, Z_CAR);
    const hp = CAR_W * p.s * (this.H > this.W ? 0.98 : 0.8);
    const wp = (hp * im.naturalWidth) / im.naturalHeight;
    const moving = this.speed > 0.5 && !this.o.reducedMotion;
    const rumble = moving ? Math.sin(this.time * 41) * 0.3 * (this.speed / SPEED[this.o.mode]) : 0;
    const bounce = this.o.reducedMotion ? 0 : this.susp * 4;
    const roll = this.o.reducedMotion ? 0 : -slip * 0.06;
    // squat on hard acceleration, nose dip on braking
    const squash = this.o.reducedMotion ? 1 : 1 - Math.min(0.04, this.boost * 0.04) + Math.min(0.03, this.brake * 0.02);
    ctx.save();
    ctx.fillStyle = 'rgba(20, 24, 30, 0.4)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - hp * 0.02, Math.max(wp, CAR_W * p.s) * 0.5, hp * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(p.x, p.y + rumble + bounce);
    ctx.rotate(roll);
    ctx.scale(1, squash);
    ctx.drawImage(im, -wp / 2, -hp, wp, hp);
    if (this.boost > 0 && view >= 1 && view <= 3 && !this.o.reducedMotion) this.drawFlames(wp, hp);
    if (this.brake > 0 && view === 2) {
      ctx.globalCompositeOperation = 'lighter';
      const a = Math.min(1, this.brake);
      for (const u of [-0.41, 0.41]) {
        const gx = u * wp;
        const gy = -hp * 0.38;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, wp * 0.14);
        g.addColorStop(0, `rgba(255, 60, 40, ${0.95 * a})`);
        g.addColorStop(1, 'rgba(255, 30, 20, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gy, wp * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /** Turbo flames from the exhaust (lower left of the rear bumper). */
  private drawFlames(wp: number, hp: number) {
    const { ctx } = this;
    const b = Math.min(1, this.boost * 1.3);
    const x = -wp * 0.3;
    const y = -hp * 0.1;
    const r = wp * (0.1 + 0.05 * Math.random()) * b;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [rr, col] of [
      [r * 2.2, 'rgba(255,120,20,0.35)'],
      [r * 1.4, 'rgba(255,190,40,0.7)'],
      [r * 0.7, 'rgba(160,220,255,0.9)'],
    ] as [number, string][]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x - rr * 0.2, y + rr * 0.15, rr * 1.2, rr * 0.8, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
