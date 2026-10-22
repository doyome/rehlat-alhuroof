// «مكتبة راية» — a cosy library corner: the child reads a short story on an open book (and can
// listen to it), then answers its questions one by one with three big choices. A small «القصة»
// tab peeks back at the story (help 1); a wrong choice shakes and is crossed out, and after two
// misses the right answer glows (help 2). Never timed: speed is not judged.

import { play, preloadAudio, say, stopVoice } from '../audio';
import { GameShell } from '../core/shell';
import { logAttempt } from '../progress';
import { G4_LINES, storyAudio, type QuizItem, type Story } from '../data/g4';
import './style.css';

const BASE = import.meta.env.BASE_URL;

export interface ReadingOptions {
  child: string;
  story: Story;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

const LINES = ['g4/read-intro', 'g4/read-wrong'] as const;
const AUDIO = [
  ...LINES,
  ...[1, 2, 3, 4, 5].map((i) => `race/cheer${i}`),
  'race/combo3',
  'race/combo5',
  'race/stage-done',
  ...['correct', 'star', 'combo', 'fanfare', 'applause', 'yay', 'fireworks', 'bump', 'plop', 'whoosh'].map((s) => `sfx/${s}`),
];

/** The question's narration key (a recording may be added later; until then the browser voice reads it). */
const questionAudio = (story: Story, i: number) => `${storyAudio(story)}-q${i + 1}`;

/** Audio (with the story narration, if recorded), fonts and Raya's picture. */
export function preloadReading(story: Story) {
  const font = (f: string, t?: string) => document.fonts.load(f, t).catch(() => []);
  return Promise.all([
    preloadAudio([...AUDIO, storyAudio(story)]),
    font('400 28px "Noto Naskh Arabic"', 'قصة'),
    font('700 28px "Noto Naskh Arabic"', 'قصة'),
    font('800 24px "Baloo Bhaijaan 2"', 'مكتبة'),
    ...['raya_body', 'raya_face'].map(
      (n) =>
        new Promise<void>((res) => {
          const im = new Image();
          im.onload = im.onerror = () => res();
          im.src = `${BASE}assets/chars/${n}.png`;
        }),
    ),
  ]);
}

const line = (k: (typeof LINES)[number]) => say(k, G4_LINES[k]);
const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const BADGES = ['أ', 'ب', 'ج'];
let introPlayed = false;

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type View = 'story' | 'quiz' | 'peek';

export class ReadingGame {
  private o: ReadingOptions;
  private story: Story;
  private shell: GameShell;
  private el: Record<string, HTMLElement> = {};
  private view: View = 'story';
  private listening = false;
  private listenId = 0;
  // question
  private qi = -1;
  private q: QuizItem | null = null;
  private opts: string[] = [];
  private optEls: HTMLButtonElement[] = [];
  private tried = new Set<number>();
  private tries = 0;
  private misses = 0;
  private help = 0;
  private qStart = 0;
  private busy = false;
  private resumers: (() => void)[] = [];

  constructor(root: HTMLElement, opts: ReadingOptions) {
    this.o = opts;
    this.story = opts.story;
    this.shell = new GameShell({
      root,
      kind: 'reading',
      child: opts.child,
      stageId: opts.story.id,
      rounds: opts.story.questions.length,
      doneTitle: 'قارئ ماهر!',
      onExit: opts.onExit,
      onRestart: opts.onRestart,
      onNext: opts.onNext,
      onPause: (p) => this.onPause(p),
      onReplay: () => this.replay(),
    });
    this.build();
    this.setView('story');
    if (import.meta.env.DEV) (window as unknown as { __reading: ReadingGame }).__reading = this;
    void this.start();
  }

  destroy() {
    this.listenId++;
    this.resumers = [];
    this.shell.destroy();
  }

  private async start() {
    if (introPlayed) return;
    introPlayed = true;
    await wait(500);
    if (this.shell.done || this.listening) return;
    this.shell.bubble(G4_LINES['g4/read-intro'], 4200);
    await line('g4/read-intro');
  }

  // ---------- scene ----------

  private build() {
    const st = this.story;
    const s = this.shell.stage;
    s.innerHTML = `
      <div class="rd-scene" dir="rtl">
        <div class="rd-shelves"></div>
        <div class="rd-lamp"></div>
        <i class="rd-mote m1"></i><i class="rd-mote m2"></i><i class="rd-mote m3"></i><i class="rd-mote m4"></i><i class="rd-mote m5"></i>
        <img class="rd-raya" src="${BASE}assets/chars/raya_body.png" alt="" draggable="false">
        <div class="rd-main">
          <div class="rd-book">
            <div class="rd-sign"><img src="${BASE}assets/chars/raya_face.png" alt=""><b>مكتبة راية</b></div>
            <i class="rd-ribbon"></i>
            <section class="rd-page rd-story">
              <h1 class="rd-title">${esc(st.title)}</h1>
              <div class="rd-text">${st.text.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
              <div class="rd-actions">
                <button class="rd-btn rd-listen"><span class="ic">🔊</span><span class="lb">استمع للقصة</span><span class="bars"><i></i><i></i><i></i><i></i></span></button>
                <button class="rd-btn rd-go"></button>
              </div>
            </section>
            <section class="rd-page rd-quiz">
              <div class="rd-qhead">
                <span class="rd-chip"></span>
                <button class="rd-peek">📖 القصة</button>
              </div>
              <div class="rd-qcard"><p class="rd-q"></p></div>
              <div class="rd-options"></div>
            </section>
          </div>
        </div>
      </div>`;
    const q = (sel: string) => s.querySelector(sel) as HTMLElement;
    this.el = {
      scene: q('.rd-scene'),
      book: q('.rd-book'),
      text: q('.rd-text'),
      listen: q('.rd-listen'),
      listenLabel: q('.rd-listen .lb'),
      listenIcon: q('.rd-listen .ic'),
      go: q('.rd-go'),
      chip: q('.rd-chip'),
      qcard: q('.rd-qcard'),
      q: q('.rd-q'),
      options: q('.rd-options'),
      raya: q('.rd-raya'),
    };
    this.shell.press(this.el.listen, () => this.toggleListen(), s);
    this.shell.press(this.el.go, () => (this.view === 'peek' ? this.closePeek() : this.ready()), s);
    this.shell.press(q('.rd-peek'), () => this.peek(), s);
    this.shell.listen(this.el.options, 'pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.rd-opt');
      if (!b) return;
      e.preventDefault();
      if (!this.shell.paused) this.choose(Number(b.dataset.k));
    });
    this.shell.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
  }

  private setView(v: View) {
    const changed = v !== this.view;
    this.view = v;
    const b = this.el.book;
    b.dataset.view = v;
    this.el.go.textContent = v === 'peek' ? 'عودة إلى السؤال ◀' : 'أنا جاهز للأسئلة ◀';
    this.el.go.classList.toggle('back', v === 'peek');
    this.shell.setTarget(v === 'quiz' ? `سؤال ${this.qi + 1}` : 'اقرأ القصة');
    if (changed) {
      b.classList.remove('flip');
      void b.offsetWidth;
      b.classList.add('flip');
      play('sfx/whoosh', 0.5);
    }
    if (v !== 'quiz') this.el.text.scrollTop = 0;
  }

  // ---------- listening ----------

  private fullText() {
    return [this.story.title, ...this.story.text].join('\n');
  }

  private async toggleListen() {
    if (this.shell.done) return;
    if (this.listening) {
      this.listenId++;
      stopVoice();
      this.setListening(false);
      return;
    }
    const id = ++this.listenId;
    this.setListening(true);
    await say(storyAudio(this.story), this.fullText());
    if (id === this.listenId) this.setListening(false);
  }

  private setListening(on: boolean) {
    this.listening = on;
    this.el.listen.classList.toggle('on', on);
    this.el.listenIcon.textContent = on ? '⏹' : '🔊';
    this.el.listenLabel.textContent = on ? 'إيقاف' : 'استمع للقصة';
    this.el.book.classList.toggle('narrating', on);
  }

  private stopListening() {
    if (!this.listening) return;
    this.listenId++;
    stopVoice();
    this.setListening(false);
  }

  private replay() {
    if (this.shell.paused || this.shell.done) return;
    this.shell.pulseCard();
    if (this.view === 'quiz' && this.q) void say(questionAudio(this.story, this.qi), this.q.q);
    else void this.toggleListen();
  }

  // ---------- flow ----------

  private ready() {
    if (this.shell.done || this.view !== 'story') return;
    this.stopListening();
    this.showQuestion(0);
  }

  private peek() {
    if (this.shell.done || this.view !== 'quiz' || this.busy) return;
    this.help = Math.max(this.help, 1);
    this.setView('peek');
  }

  private closePeek() {
    if (this.view !== 'peek') return;
    this.stopListening();
    this.setView('quiz');
  }

  private showQuestion(i: number) {
    const q = this.story.questions[i];
    this.qi = i;
    this.q = q;
    this.tried.clear();
    this.tries = 0;
    this.misses = 0;
    this.help = 0;
    this.busy = false;
    let order = shuffle(q.options);
    // a fresh order for each question, and not always the same place for the right answer
    if (q.options.length > 1 && order[0] === q.options[0] && Math.random() < 0.5) order = shuffle(q.options);
    this.opts = order;
    this.el.chip.textContent = `السؤال ${i + 1} من ${this.story.questions.length}`;
    this.el.q.textContent = q.q;
    this.el.options.innerHTML = order
      .map((t, k) => `<button class="rd-opt o${k}" data-k="${k}" style="--i:${k}"><span class="badge">${BADGES[k] ?? k + 1}</span><span class="tx">${esc(t)}</span></button>`)
      .join('');
    this.optEls = [...this.el.options.querySelectorAll<HTMLButtonElement>('.rd-opt')];
    this.el.qcard.classList.remove('in');
    void this.el.qcard.offsetWidth;
    this.el.qcard.classList.add('in');
    this.setView('quiz');
    this.qStart = performance.now();
  }

  private async choose(k: number) {
    const q = this.q;
    if (!q || this.busy || this.shell.done || this.view !== 'quiz' || this.tried.has(k)) return;
    const b = this.optEls[k];
    const chosen = this.opts[k];
    this.tries++;
    const right = chosen === q.options[0];
    this.log(right, chosen);
    if (right) return void this.success(b);

    this.misses++;
    this.tried.add(k);
    this.shell.wrong();
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('wrong', 'shake');
    if (this.misses >= 2) {
      this.help = 2;
      const r = this.opts.indexOf(q.options[0]);
      this.optEls[r]?.classList.add('hint');
    }
    if (this.misses === 1) {
      this.shell.bubble(G4_LINES['g4/read-wrong'], 3000);
      void line('g4/read-wrong');
    }
  }

  private async success(b: HTMLElement) {
    const round = this.qi;
    this.busy = true;
    const independent = this.misses === 0 && this.help === 0;
    const firstTry = this.misses === 0;
    b.classList.remove('hint');
    b.classList.add('right');
    this.el.options.classList.add('answered');
    play('sfx/star', 0.7);
    const r = this.shell.root.getBoundingClientRect();
    const p = b.getBoundingClientRect();
    const x = p.left - r.left + p.width / 2;
    const y = p.top - r.top + p.height / 2;
    this.el.raya.classList.remove('cheer');
    void this.el.raya.offsetWidth;
    this.el.raya.classList.add('cheer');
    const over = await this.shell.correct(independent, firstTry, x, y);
    if (this.shell.done || round !== this.qi) return;
    if (over) {
      this.shell.finish(`قرأت قصة «${this.story.title}»`);
      return;
    }
    await this.whenRunning();
    this.el.qcard.classList.add('out');
    this.el.options.classList.add('out');
    await wait(380);
    this.el.qcard.classList.remove('out');
    this.el.options.classList.remove('out', 'answered');
    this.showQuestion(this.qi + 1);
  }

  private log(correct: boolean, answer: string) {
    logAttempt({
      child: this.o.child,
      activity: 'reading',
      stage: this.story.id,
      item: this.q!.q,
      answer,
      correct,
      help: this.help,
      tries: this.tries,
      ms: Math.round(performance.now() - this.qStart),
    });
  }

  // ---------- input ----------

  private onKey(e: KeyboardEvent) {
    if (e.repeat || this.shell.done) return;
    if (e.key === 'Escape') this.shell.setPaused(!this.shell.paused);
    else if (this.shell.paused) return;
    else if (this.view === 'quiz' && ['1', '2', '3'].includes(e.key)) void this.choose(Number(e.key) - 1);
    else if (this.view !== 'quiz' && e.key === ' ') void this.toggleListen();
    else if (e.key === 'Enter') {
      if (this.view === 'story') this.ready();
      else if (this.view === 'peek') this.closePeek();
      else return;
    } else return;
    e.preventDefault();
  }

  // ---------- pause ----------

  private onPause(p: boolean) {
    this.shell.root.classList.toggle('paused', p);
    if (p) {
      // the shell stops the voice; the button must show it stopped too
      this.listenId++;
      this.setListening(false);
    } else {
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
