// «مشغل الحروف» — the child writes a big letter on an ivory slate with a finger (or the mouse).
// Judging looks at the shape only and is forgiving: the glyph is rendered into a coarse mask, the ink
// must cover most of it and must not wander far off. No stroke order and no clock: a slow, careful
// hand never scores lower. A miss only clears the slate and shows a little more of the letter.

import { play, preloadAudio, say, sfx } from '../audio';
import { GameShell } from '../core/shell';
import { logAttempt } from '../progress';
import { LETTER, LETTERS, letterNameAudio } from '../data/arabic';
import { DOTTED, TRACE_AUDIO, type TraceHelp, type TraceStage } from '../data/trace';
import './style.css';

export interface TraceOptions {
  child: string;
  stage: TraceStage;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

const FONT = '"Noto Naskh Arabic", serif';

export function preloadTrace() {
  // the font is split by script, so ask for the Arabic letters themselves
  return Promise.all([preloadAudio(TRACE_AUDIO), document.fonts.load(`700 100px ${FONT}`, LETTERS.map((l) => l.char).join(''))]);
}

const HELP: TraceHelp[] = ['free', 'dots', 'light', 'full']; // least guide to most
const PASS_COVER = 0.65; // share of the letter the ink must reach
const AUTO_COVER = 0.8; // lifting the finger judges by itself only when the letter is clearly done
const PASS_SPILL = 0.35; // share of the ink allowed outside the tolerance band
const TOL = 0.1; // tolerance band, as a share of the glyph's larger side
const GRID = 240; // judging cells along the slate's longer side
const MAX_TRIES = 3;
const IDLE_MS = 900; // pause after the finger lifts before the slate looks at the letter
const RAINBOW = ['#ff5d73', '#ffa53d', '#ffd23f', '#5ccf6b', '#3fb6f0', '#a26bf5'];
let introPlayed = false;

/** An ink point in glyph space: (slate px − text anchor) / font size, so the ink survives a resize. */
interface Pt {
  u: number;
  v: number;
  hue: number;
}

interface Dot {
  cx: number;
  cy: number;
  r: number;
}

/** The letter as the judge sees it, on a grid of `cell`-px squares laid over the slate. */
interface Glyph {
  fs: number; // font size and text anchor, slate px
  x: number;
  y: number;
  x0: number; // drawn bounds, slate px
  y0: number;
  x1: number;
  y1: number;
  gw: number;
  gh: number;
  cell: number;
  body: number[]; // glyph cells that are not dots
  dots: Dot[]; // one per loose dot (or cluster of dots), in cells
  dotMask: Uint8Array; // dot cells grown a little, to erase them from the guide
  near: Float32Array; // distance from every cell to the glyph
  nearBody: Float32Array; // distance from every cell to the body
  half: number; // half the stroke thickness
  tol: number; // tolerance band
}

interface Score {
  coverage: number;
  spill: number;
  dotsMissing: boolean;
}

// one offscreen canvas for measuring, rendering masks and rasterising ink
const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true })!;

function setFont(c: CanvasRenderingContext2D, fs: number) {
  c.font = `700 ${fs}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.direction = 'rtl';
}

/** Distance (in cells) from every cell to the nearest set cell: two-pass chamfer, plenty for a finger. */
function distanceTo(src: Uint8Array, w: number, h: number) {
  const D = Math.SQRT2;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : 1e9;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (!v) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (!v) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  return d;
}

/** Connected parts of a mask (8 neighbours), as lists of cell indices. */
function partsOf(mask: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(mask.length);
  const out: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const p: number[] = [];
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      p.push(c);
      const x = c % w;
      const y = (c - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
    }
    out.push(p);
  }
  return out;
}

/** Render the letter at (x, y, fs) on a W×H slate into the judging grid and work out its body, dots and band. */
function analyze(ch: string, fs: number, x: number, y: number, W: number, H: number): Glyph {
  const cell = Math.max(1, Math.max(W, H) / GRID);
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  scratch.width = gw;
  scratch.height = gh;
  sctx.setTransform(1 / cell, 0, 0, 1 / cell, 0, 0);
  setFont(sctx, fs);
  sctx.fillStyle = '#000';
  sctx.fillText(ch, x, y);
  const px = sctx.getImageData(0, 0, gw, gh).data;
  const mask = new Uint8Array(gw * gh);
  let mx0 = gw;
  let my0 = gh;
  let mx1 = 0;
  let my1 = 0;
  for (let i = 0; i < mask.length; i++) {
    if (px[i * 4 + 3] < 110) continue;
    mask[i] = 1;
    const cx = i % gw;
    const cy = (i - cx) / gw;
    mx0 = Math.min(mx0, cx);
    my0 = Math.min(my0, cy);
    mx1 = Math.max(mx1, cx + 1);
    my1 = Math.max(my1, cy + 1);
  }
  // the biggest part is the body; small loose parts of a dotted letter are its dots
  const parts = partsOf(mask, gw, gh).sort((a, b) => b.length - a.length);
  const dotted = DOTTED.has(ch);
  const body: number[] = [];
  const dots: Dot[] = [];
  const bodyMask = new Uint8Array(mask.length);
  const dotMask = new Uint8Array(mask.length);
  parts.forEach((p, i) => {
    if (i > 0 && dotted && p.length < parts[0].length * 0.3) {
      let sx = 0;
      let sy = 0;
      for (const c of p) {
        sx += (c % gw) + 0.5;
        sy += Math.floor(c / gw) + 0.5;
      }
      const cx = sx / p.length;
      const cy = sy / p.length;
      let r = 0;
      for (const c of p) {
        r = Math.max(r, Math.hypot((c % gw) + 0.5 - cx, Math.floor(c / gw) + 0.5 - cy));
        const ex = c % gw;
        const ey = Math.floor(c / gw);
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const nx = ex + dx;
            const ny = ey + dy;
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) dotMask[ny * gw + nx] = 1;
          }
      }
      dots.push({ cx, cy, r: r + 0.5 });
    } else
      for (const c of p) {
        body.push(c);
        bodyMask[c] = 1;
      }
  });
  const inside = distanceTo(mask.map((v) => 1 - v), gw, gh);
  const depth = body.map((c) => inside[c]).sort((a, b) => a - b);
  return {
    fs,
    x,
    y,
    x0: mx0 * cell,
    y0: my0 * cell,
    x1: mx1 * cell,
    y1: my1 * cell,
    gw,
    gh,
    cell,
    body,
    dots,
    dotMask,
    near: distanceTo(mask, gw, gh),
    nearBody: distanceTo(bodyMask, gw, gh),
    half: depth.length ? depth[Math.floor(depth.length * 0.97)] : 1,
    tol: TOL * Math.max(mx1 - mx0, my1 - my0, 1),
  };
}

/**
 * coverage = body cells within reach of the ink; spill = ink cells outside the tolerance band;
 * a dot counts when a stroke passes over it (and is nearer to the dot than to the body).
 */
function score(g: Glyph, ink: Uint8Array, reach: Float32Array, path: [number, number][], inkR: number): Score {
  const r = g.half + g.tol * 0.5;
  let hit = 0;
  for (const c of g.body) if (reach[c] <= r) hit++;
  let n = 0;
  let out = 0;
  for (let i = 0; i < ink.length; i++)
    if (ink[i]) {
      n++;
      if (g.near[i] > g.tol) out++;
    }
  const slack = g.tol * 0.6 + inkR * 0.5;
  const dotsMissing = g.dots.some(
    (d) =>
      !path.some(([x, y]) => {
        const e = Math.max(0, Math.hypot(x - d.cx, y - d.cy) - d.r);
        const i = Math.min(g.gh - 1, Math.max(0, Math.floor(y))) * g.gw + Math.min(g.gw - 1, Math.max(0, Math.floor(x)));
        return e <= slack && e < g.nearBody[i];
      }),
  );
  return { coverage: g.body.length ? hit / g.body.length : 1, spill: n ? out / n : 0, dotsMissing };
}

export class TraceGame {
  private o: TraceOptions;
  private shell: GameShell;
  private slate: HTMLElement;
  private guideEl: HTMLCanvasElement;
  private inkEl: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;
  private ictx: CanvasRenderingContext2D;
  private tools: HTMLElement;
  private doneBtn: HTMLElement;
  // slate placement inside the stage (stage and root share an origin, so this is also the fx-layer frame)
  private sx = 0;
  private sy = 0;
  private sw = 0;
  private sh = 0;
  private base!: Glyph;
  private inkW = 24;
  // ink
  private strokes: Pt[][] = [];
  private stroke: Pt[] | null = null;
  private pointer = -1;
  private hue = 0;
  private trail = 0;
  private lastPx = { x: 0, y: 0 };
  // round
  private seq: string[];
  private target = '';
  private level: TraceHelp;
  private tries = 0;
  private help = 0;
  private dotsAsked = false;
  private roundStart = 0;
  private filled = 0; // 0..1 colour wipe once the letter is written
  private busy = true; // true while the slate is judging or celebrating
  private dead = false;
  private idle = 0;
  private raf = 0;

  constructor(root: HTMLElement, opts: TraceOptions) {
    this.o = opts;
    this.level = opts.stage.help;
    this.shell = new GameShell({
      root,
      kind: 'trace',
      child: opts.child,
      stageId: opts.stage.id,
      rounds: opts.stage.rounds,
      music: 'music/race',
      doneTitle: 'كتابة رائعة!',
      onExit: opts.onExit,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
      onPause: (p) => p && this.holdStroke(),
      onReplay: () => this.replay(),
    });
    const st = this.shell.stage;
    st.innerHTML = `
      <div class="tr-garden"><i class="tr-awning"></i><i class="tr-sun"></i><i class="tr-dune a"></i><i class="tr-dune b"></i><i class="tr-pebbles"></i></div>
      <div class="tr-slate"><div class="tr-paper"><canvas class="tr-guide"></canvas><canvas class="tr-ink"></canvas></div></div>
      <div class="tr-tools">
        <button class="tr-btn done" aria-label="تم"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>تم</span></button>
        <button class="tr-btn clear" aria-label="امسح"><svg viewBox="0 0 24 24"><path d="M15.5 4.5l4 4-9 9H6.5l-2-2a1.6 1.6 0 0 1 0-2.3z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M10 9l5 5M11 19.5h8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span>امسح</span></button>
      </div>`;
    const q = <T extends HTMLElement>(s: string) => st.querySelector(s) as T;
    this.slate = q('.tr-slate');
    this.guideEl = q<HTMLCanvasElement>('.tr-guide');
    this.inkEl = q<HTMLCanvasElement>('.tr-ink');
    this.gctx = this.guideEl.getContext('2d')!;
    this.ictx = this.inkEl.getContext('2d')!;
    this.tools = q('.tr-tools');
    this.doneBtn = q('.tr-btn.done');
    this.shell.press(this.doneBtn, () => this.check(true), st);
    this.shell.press(q('.tr-btn.clear'), () => this.wipe(), st);
    this.shell.listen(this.inkEl, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.shell.listen(this.inkEl, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.shell.listen(this.inkEl, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.shell.listen(this.inkEl, 'pointercancel', (e) => this.onUp(e as PointerEvent));
    this.shell.listen(window, 'resize', () => this.target && this.fit());
    this.shell.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    // lessons go in teaching order; the harder stages mix the look-alikes up
    const L = opts.stage.letters;
    const order = opts.stage.help === 'full' ? [...L] : [...L].sort(() => Math.random() - 0.5);
    this.seq = Array.from({ length: opts.stage.rounds }, (_, i) => order[i % order.length]);
    if (import.meta.env.DEV) (window as unknown as { __trace: TraceGame }).__trace = this;
    void this.newRound();
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.idle);
    cancelAnimationFrame(this.raf);
    this.shell.destroy();
  }

  // ---------- layout ----------

  /** Place the slate and buttons for this screen, fit the letter, and redraw guide and ink. */
  private fit() {
    const W = this.shell.stage.clientWidth || window.innerWidth;
    const H = this.shell.stage.clientHeight || window.innerHeight;
    const btn = W < 600 || H < 520 ? 76 : 88;
    let sw: number;
    let sh: number;
    let sx: number;
    let sy: number;
    const col = W > H;
    if (!col) {
      // portrait: slate under the HUD, buttons in a row beneath it
      const top = W <= 600 ? 132 : 126;
      const room = H - top - btn - 44;
      sw = Math.min(W - 32, room * 1.2);
      sh = Math.min(room, sw * 1.35);
      sx = (W - sw) / 2;
      sy = top + (room - sh) / 2;
      this.tools.style.left = `${W / 2}px`;
      this.tools.style.top = `${sy + sh + 30 + btn / 2}px`;
    } else {
      // landscape: buttons in a column beside the slate; on a short phone the slate rises next to the HUD card
      const short = H < 520;
      const top = short ? 74 : 128;
      const right = short ? 200 : 24;
      const left = 24 + btn + 30;
      const aw = W - left - right;
      const ah = H - top - 18;
      sw = Math.min(aw, ah * 1.35);
      sh = Math.min(ah, sw * 1.1);
      sx = Math.min(W - right - sw, Math.max(left, (W - sw) / 2));
      sy = top + (ah - sh) / 2;
      this.tools.style.left = `${Math.max(24 + btn / 2, sx - 30 - btn / 2)}px`;
      this.tools.style.top = `${sy + sh / 2}px`;
    }
    sw = Math.max(160, Math.round(sw));
    sh = Math.max(160, Math.round(sh));
    this.tools.classList.toggle('col', col);
    this.tools.style.setProperty('--btn', `${btn}px`);
    Object.assign(this.slate.style, { left: `${sx}px`, top: `${sy}px`, width: `${sw}px`, height: `${sh}px` });
    this.sx = sx;
    this.sy = sy;
    this.sw = sw;
    this.sh = sh;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const [cv, c] of [
      [this.guideEl, this.gctx],
      [this.inkEl, this.ictx],
    ] as const) {
      cv.width = Math.round(sw * dpr);
      cv.height = Math.round(sh * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // the letter: as big as the slate allows, its drawn box centred
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    setFont(sctx, 100);
    const m = sctx.measureText(this.target);
    const L = m.actualBoundingBoxLeft / 100;
    const R = m.actualBoundingBoxRight / 100;
    const A = m.actualBoundingBoxAscent / 100;
    const D = m.actualBoundingBoxDescent / 100;
    const bw = L + R > 0.05 ? L + R : 0.6;
    const bh = A + D > 0.05 ? A + D : 0.8;
    const fs = Math.min((sw * 0.74) / bw, (sh * 0.72) / bh, sh * 1.25);
    const x = sw / 2 - ((R - L) / 2) * fs;
    const y = sh / 2 + ((A - D) / 2) * fs;
    this.base = analyze(this.target, fs, x, y, sw, sh);
    this.inkW = Math.max(18, Math.min(46, this.base.half * this.base.cell * 1.9));
    this.drawGuide();
    this.redrawInk();
  }

  // ---------- drawing ----------

  private drawGuide() {
    const { gctx: c, base: g, sw, sh } = this;
    c.clearRect(0, 0, sw, sh);
    setFont(c, g.fs);
    if (this.filled > 0) {
      // written: the letter fills with colour from the bottom up
      const grad = c.createLinearGradient(g.x1, 0, g.x0, 0);
      RAINBOW.forEach((col, i) => grad.addColorStop(i / (RAINBOW.length - 1), col));
      c.save();
      c.beginPath();
      c.rect(0, g.y1 + 4 - (g.y1 - g.y0 + 8) * this.filled, sw, sh);
      c.clip();
      c.fillStyle = grad;
      c.fillText(this.target, g.x, g.y);
      c.restore();
      c.lineWidth = Math.max(2, g.fs * 0.008);
      c.strokeStyle = 'rgba(120, 70, 20, 0.45)';
      c.strokeText(this.target, g.x, g.y);
    } else if (this.level !== 'free') {
      c.fillStyle = this.level === 'full' ? 'rgba(120, 108, 92, 0.18)' : 'rgba(120, 108, 92, 0.24)';
      c.fillText(this.target, g.x, g.y);
      if (this.level === 'full') {
        // thick dotted outline to follow
        c.save();
        c.lineWidth = Math.max(5, g.fs * 0.018);
        c.lineCap = 'round';
        c.setLineDash([0.1, Math.max(10, g.fs * 0.04)]);
        c.strokeStyle = 'rgba(95, 84, 72, 0.7)';
        c.strokeText(this.target, g.x, g.y);
        c.restore();
      }
      if (this.level === 'dots' && g.dots.length) {
        // the body only: the child puts the dots back
        const dm = document.createElement('canvas');
        dm.width = g.gw;
        dm.height = g.gh;
        const dc = dm.getContext('2d')!;
        const img = dc.createImageData(g.gw, g.gh);
        g.dotMask.forEach((v, i) => (img.data[i * 4 + 3] = v ? 255 : 0));
        dc.putImageData(img, 0, 0);
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.drawImage(dm, 0, 0, g.gw * g.cell, g.gh * g.cell);
        c.restore();
      }
    }
    // the writing line of a copybook, behind the letter
    c.save();
    c.globalCompositeOperation = 'destination-over';
    c.strokeStyle = 'rgba(63, 150, 200, 0.4)';
    c.lineWidth = 3;
    c.setLineDash([14, 10]);
    c.beginPath();
    c.moveTo(18, g.y);
    c.lineTo(sw - 18, g.y);
    c.stroke();
    c.restore();
  }

  private toSlate(p: Pt) {
    return { x: this.base.x + p.u * this.base.fs, y: this.base.y + p.v * this.base.fs };
  }

  /** One piece of glowing rainbow ink (a dot when a and b are the same point). */
  private drawSeg(a: { x: number; y: number }, b: { x: number; y: number }, hue: number) {
    const c = this.ictx;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = this.inkW;
    c.strokeStyle = `hsl(${hue} 92% 56%)`;
    c.shadowColor = `hsl(${hue} 100% 62%)`;
    c.shadowBlur = this.inkW * 0.5;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x + (a.x === b.x && a.y === b.y ? 0.01 : 0), b.y);
    c.stroke();
    c.shadowBlur = 0;
  }

  private redrawInk() {
    this.ictx.clearRect(0, 0, this.sw, this.sh);
    for (const s of this.strokes) {
      let prev = this.toSlate(s[0]);
      this.drawSeg(prev, prev, s[0].hue);
      for (const p of s.slice(1)) {
        const q = this.toSlate(p);
        this.drawSeg(prev, q, p.hue);
        prev = q;
      }
    }
  }

  // ---------- input ----------

  private canDraw() {
    return !this.shell.paused && !this.shell.done && !this.busy && !!this.target;
  }

  private local(e: PointerEvent) {
    const r = this.inkEl.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * this.sw) / (r.width || 1), y: ((e.clientY - r.top) * this.sh) / (r.height || 1) };
  }

  private onDown(e: PointerEvent) {
    // one finger writes; a resting palm or a second finger is ignored
    if (!this.canDraw() || this.pointer !== -1) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    this.inkEl.setPointerCapture(e.pointerId);
    clearTimeout(this.idle);
    this.doneBtn.classList.remove('ready');
    const p = this.local(e);
    this.lastPx = p;
    this.trail = 0;
    this.stroke = [{ u: (p.x - this.base.x) / this.base.fs, v: (p.y - this.base.y) / this.base.fs, hue: this.hue }];
    this.strokes.push(this.stroke);
    this.drawSeg(p, p, this.hue);
    this.shell.sparkle(this.sx + p.x, this.sy + p.y, this.hue);
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId !== this.pointer || !this.stroke) return;
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) this.extend(this.local(ev));
  }

  private extend(p: { x: number; y: number }) {
    const a = this.lastPx;
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < 2) return;
    this.hue = (this.hue + d * 0.45) % 360;
    this.drawSeg(a, p, this.hue);
    this.stroke!.push({ u: (p.x - this.base.x) / this.base.fs, v: (p.y - this.base.y) / this.base.fs, hue: this.hue });
    this.lastPx = p;
    this.trail += d;
    if (this.trail > 16) {
      this.trail = 0;
      this.shell.sparkle(this.sx + p.x, this.sy + p.y, this.hue);
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    this.stroke = null;
    if (!this.canDraw()) return;
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => this.check(false), IDLE_MS);
  }

  /** Paused mid-letter: drop the finger, keep the ink. */
  private holdStroke() {
    clearTimeout(this.idle);
    this.pointer = -1;
    this.stroke = null;
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.key === 'p' || e.key === 'Escape') this.shell.setPaused(!this.shell.paused);
    else if (this.shell.paused) return;
    else if (e.key === 'Enter') this.check(true);
    else if (e.key === 'Backspace' || e.key === 'Delete') this.wipe();
    else if (e.key === 'r' || e.key === 'R') this.replay();
    else return;
    e.preventDefault();
  }

  private replay() {
    if (this.shell.paused || !this.target || this.busy) return;
    this.help = Math.max(this.help, 1);
    this.shell.pulseCard();
    void say(letterNameAudio(this.target), LETTER.get(this.target)!.name);
  }

  /** Clear the slate in a puff of sand. */
  private wipe(puff = true) {
    if (this.busy && puff) return;
    clearTimeout(this.idle);
    if (puff)
      for (const s of this.strokes) {
        const step = Math.max(3, Math.ceil(s.length / 24));
        for (let i = 0; i < s.length; i += step) {
          const p = this.toSlate(s[i]);
          this.shell.sparkle(this.sx + p.x, this.sy + p.y, 38);
        }
      }
    this.strokes = [];
    this.stroke = null;
    this.pointer = -1;
    this.ictx.clearRect(0, 0, this.sw, this.sh);
    this.doneBtn.classList.remove('ready');
  }

  // ---------- judging ----------

  /** How well the ink matches the letter, or null when there is (almost) no ink. */
  private measure(): Score | null {
    const g0 = this.base;
    if (!this.strokes.length) return null;
    // the ink on the judging grid, and the stroke centrelines (for the dots)
    const pts = this.strokes.map((s) => s.map((p) => this.toSlate(p)));
    scratch.width = g0.gw;
    scratch.height = g0.gh;
    sctx.setTransform(1 / g0.cell, 0, 0, 1 / g0.cell, 0, 0);
    sctx.lineCap = 'round';
    sctx.lineJoin = 'round';
    sctx.lineWidth = this.inkW;
    sctx.strokeStyle = '#000';
    const path: [number, number][] = [];
    for (const s of pts) {
      sctx.beginPath();
      sctx.moveTo(s[0].x, s[0].y);
      sctx.lineTo(s[0].x + 0.01, s[0].y);
      path.push([s[0].x / g0.cell, s[0].y / g0.cell]);
      for (let i = 1; i < s.length; i++) {
        sctx.lineTo(s[i].x, s[i].y);
        const n = Math.ceil(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) / g0.cell);
        for (let k = 1; k <= n; k++) path.push([(s[i - 1].x + ((s[i].x - s[i - 1].x) * k) / n) / g0.cell, (s[i - 1].y + ((s[i].y - s[i - 1].y) * k) / n) / g0.cell]);
      }
      sctx.stroke();
    }
    const px = sctx.getImageData(0, 0, g0.gw, g0.gh).data;
    const ink = new Uint8Array(g0.gw * g0.gh);
    let n = 0;
    for (let i = 0; i < ink.length; i++) if (px[i * 4 + 3] >= 100) ink[i] = 1;
    for (const v of ink) n += v;
    if (n < 6) return null;
    const reach = distanceTo(ink, g0.gw, g0.gh);
    const inkR = this.inkW / 2 / g0.cell;
    if (this.level !== 'free') return score(g0, ink, reach, path, inkR);
    // free writing: the letter may be anywhere and any size, so fit the glyph to the ink's box and try a few sizes
    let ix0 = Infinity;
    let iy0 = Infinity;
    let ix1 = -Infinity;
    let iy1 = -Infinity;
    for (const s of pts)
      for (const p of s) {
        ix0 = Math.min(ix0, p.x);
        iy0 = Math.min(iy0, p.y);
        ix1 = Math.max(ix1, p.x);
        iy1 = Math.max(iy1, p.y);
      }
    const pad = this.inkW / 2;
    const gbw = Math.max(1, g0.x1 - g0.x0);
    const gbh = Math.max(1, g0.y1 - g0.y0);
    const s0 = Math.min(1.4, Math.max(0.3, ((ix1 - ix0 + pad * 2) / gbw + (iy1 - iy0 + pad * 2) / gbh) / 2));
    const icx = (ix0 + ix1) / 2;
    const icy = (iy0 + iy1) / 2;
    const dx = (g0.x0 + g0.x1) / 2 - g0.x;
    const dy = (g0.y0 + g0.y1) / 2 - g0.y;
    let best: Score | null = null;
    for (const k of [0.85, 1, 1.18]) {
      const s = s0 * k;
      const g = analyze(this.target, g0.fs * s, icx - dx * s, icy - dy * s, this.sw, this.sh);
      const r = score(g, ink, reach, path, inkR);
      if (!best || r.coverage - r.spill > best.coverage - best.spill) best = r;
    }
    return best;
  }

  /** Look at the letter: from the «تم» button (manual) or after the finger rests (auto, which only ever passes). */
  private check(manual: boolean) {
    if (!this.canDraw()) return;
    clearTimeout(this.idle);
    const s = this.measure();
    if (!s) {
      if (manual) this.shell.bubble('اكتب الحرف بإصبعك أولًا', 2400);
      return;
    }
    const shapeOk = s.coverage >= PASS_COVER && s.spill <= PASS_SPILL;
    const dotsStage = this.o.stage.help === 'dots';
    if (!manual) {
      if (!(s.coverage >= AUTO_COVER && s.spill <= PASS_SPILL) || (s.dotsMissing && (dotsStage || this.dotsAsked))) {
        this.doneBtn.classList.toggle('ready', shapeOk);
        return;
      }
      if (s.dotsMissing) return this.askDots();
      void this.win(false);
      return;
    }
    if (shapeOk && s.dotsMissing && !dotsStage && !this.dotsAsked) return this.askDots();
    if (shapeOk && (!s.dotsMissing || !dotsStage)) void this.win(false);
    else void this.retry(shapeOk);
  }

  /** The body is there but a dot is not: remind once, then let the child add it. */
  private askDots() {
    this.dotsAsked = true;
    this.doneBtn.classList.add('ready');
    this.shell.bubble('لا تنسَ النقاط!', 2600);
    void say('trace/dots', 'لا تنسَ النقاط!');
  }

  private log(ok: boolean) {
    this.tries++;
    logAttempt({
      child: this.o.child,
      activity: 'letter-tracing',
      stage: this.o.stage.id,
      item: this.target,
      answer: ok ? 'ok' : 'retry',
      correct: ok,
      help: this.help,
      tries: this.tries,
      ms: Math.round(performance.now() - this.roundStart),
    });
  }

  /** Not yet: a soft sound, a kind word, and a little more of the letter shows. Third time it is accepted. */
  private async retry(dotsOnly: boolean) {
    if (this.tries + 1 >= MAX_TRIES) {
      this.help = 2;
      this.log(false);
      return this.win(true);
    }
    this.log(false);
    this.shell.streak = 0;
    if (!play('sfx/bump', 0.3, 1.25)) sfx.tap();
    const i = HELP.indexOf(this.level);
    if (i < HELP.length - 1) {
      this.level = HELP[i + 1];
      this.help = Math.max(this.help, 1);
      this.drawGuide();
    }
    if (dotsOnly) {
      // the letter itself was fine: keep the ink, only the dots are still to come
      this.shell.bubble('لا تنسَ النقاط!', 2600);
      await say('trace/dots', 'لا تنسَ النقاط!');
      return;
    }
    this.wipe(true);
    this.shell.bubble('قريب جدًا! جرّب مرة أخرى', 2600);
    await say('trace/again', 'قريب جدًا! جرّب مرة أخرى');
  }

  /** Written (or accepted after three tries): colour, bounce, the letter's name, then the shell's stars. */
  private async win(accepted: boolean) {
    if (!accepted) this.log(true);
    this.busy = true;
    clearTimeout(this.idle);
    const independent = this.tries === 1 && this.help === 0;
    const firstTry = this.tries === 1;
    this.doneBtn.classList.remove('ready');
    this.inkEl.classList.add('fade');
    this.slate.classList.remove('win');
    void this.slate.offsetWidth;
    this.slate.classList.add('win');
    const name = LETTER.get(this.target)!.name;
    const fill = this.fillLetter();
    if (accepted) {
      this.shell.bubble('أحسنت المحاولة! هذا هو الحرف', 2600);
      await say('trace/great', 'أحسنت المحاولة! هذا هو الحرف');
      if (this.dead) return;
    }
    await Promise.all([fill, say(letterNameAudio(this.target), name)]);
    if (this.dead) return;
    const g = this.base;
    const over = await this.shell.correct(independent, firstTry, this.sx + (g.x0 + g.x1) / 2, this.sy + (g.y0 + g.y1) / 2);
    if (this.dead) return;
    if (over) this.shell.finish(`كتبت ${this.o.stage.rounds} حروف`);
    else setTimeout(() => void this.newRound(), 450);
  }

  private fillLetter() {
    return new Promise<void>((res) => {
      const t0 = performance.now();
      const step = (t: number) => {
        if (this.dead) return res();
        this.filled = Math.min(1, Math.max(0, (t - t0) / 650));
        this.drawGuide();
        if (this.filled < 1) this.raf = requestAnimationFrame(step);
        else res();
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  // ---------- rounds ----------

  private instruction() {
    if (this.level === 'full') return 'اتبع الخط المنقّط بإصبعك';
    if (this.level === 'light') return 'اكتب فوق الحرف الباهت';
    if (this.level === 'dots') return DOTTED.has(this.target) ? 'اكتب الحرف ولا تنسَ نقاطه' : 'اكتب الحرف بإصبعك';
    return 'اكتب الحرف وحدك على اللوح';
  }

  private async newRound() {
    if (this.dead || this.shell.done) return;
    this.target = this.seq[this.shell.round];
    this.level = this.o.stage.help;
    this.tries = 0;
    this.help = 0;
    this.dotsAsked = false;
    this.filled = 0;
    this.strokes = [];
    this.inkEl.classList.remove('fade');
    this.slate.classList.remove('win');
    this.shell.setTarget(this.target);
    this.shell.pulseCard();
    this.fit();
    this.roundStart = performance.now();
    this.busy = false;
    if (!introPlayed) {
      introPlayed = true;
      this.shell.bubble('هيّا نكتب الحرف بإصبعك! اتبع الخط المنقّط', 5200);
      await say('trace/intro', 'هيّا نكتب الحرف بإصبعك! اتبع الخط المنقّط');
      if (this.dead) return;
    }
    this.shell.bubble(this.instruction(), 3200);
    await say(letterNameAudio(this.target), LETTER.get(this.target)!.name);
  }
}
