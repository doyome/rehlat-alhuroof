import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/700.css';
import '@fontsource/baloo-bhaijaan-2/600.css';
import '@fontsource/baloo-bhaijaan-2/800.css';
import './style.css';
import './map.css';
import { STAGES } from './data/race';
import { FISH_STAGES } from './data/fish';
import { TRACE_STAGES } from './data/trace';
import { FIRSTSOUND_STAGES } from './data/firstsound';
import { FACTORY_STAGES } from './data/factory';
import { DICTATION_STAGES } from './data/dictation';
import { stageResult } from './progress';
import { RaceGame, preloadRace, type RaceMode } from './race/game';
import { FishGame, preloadFish } from './fish/game';
import { TraceGame, preloadTrace } from './trace/game';
import { FirstSoundGame, preloadFirstSound } from './firstsound/game';
import { FactoryGame, preloadFactory } from './factory/game';
import { DictationGame, preloadDictation } from './dictation/game';

const BASE = import.meta.env.BASE_URL;

const PLAYERS = [
  { id: 'salem', name: 'سالم' },
  { id: 'raya', name: 'راية' },
  { id: 'shamma', name: 'شمّا' },
];

const app = document.getElementById('app')!;
try {
  localStorage.removeItem('rehla.reduced');
} catch {
  /* ignore */
}

const pref = (k: string, d: string) => {
  try {
    return localStorage.getItem(`rehla.${k}`) ?? d;
  } catch {
    return d;
  }
};
const setPref = (k: string, v: string) => {
  try {
    localStorage.setItem(`rehla.${k}`, v);
  } catch {
    /* ignore */
  }
};

/** What every game needs from the platform; each island adds its own stage. */
interface Common {
  child: string;
  onExit: () => void;
  onRestart: () => void;
  onNext: () => void;
}

interface Island {
  id: string;
  title: string;
  place: string;
  /** one line telling the parent what the island trains */
  skill: string;
  stages: { id: string; title: string }[];
  art: (child: string) => string;
  start: (i: number, c: Common) => Promise<{ destroy(): void }>;
}

const sticker = (id: string, cls = '') => `<img class="stk ${cls}" src="${BASE}assets/words/${id}.png" alt="">`;
const known = (child: string) => (PLAYERS.some((p) => p.id === child) ? child : 'salem');

// The islands in learning order: write the letter, recognise it, read it with harakat,
// hear it at the start of a word, build words, then write words from dictation.
const ISLANDS: Island[] = [
  {
    id: 'trace',
    title: 'مشغل الحروف',
    place: 'جزيرة القلم',
    skill: 'كتابة الحروف بالإصبع',
    stages: TRACE_STAGES,
    art: () => `<div class="art-slate"><b>ب</b><b>ج</b><b>س</b><span class="pen">✏️</span></div>`,
    start: async (i, c) => {
      await loading(preloadTrace());
      return new TraceGame(app, { ...c, stage: TRACE_STAGES[i] });
    },
  },
  {
    id: 'fish',
    title: 'الصيّاد',
    place: 'بحر الحروف',
    skill: 'التعرّف على الحروف بالشكل والسمع',
    stages: FISH_STAGES,
    art: (child) =>
      `<div class="art-photo" style="background-image:url('${BASE}assets/fish/scene.jpg')"><img class="boat" src="${BASE}assets/fish/boat_${known(child)}.png" alt=""></div>`,
    start: async (i, c) => {
      await loading(preloadFish(c.child));
      return new FishGame(app, { ...c, stage: FISH_STAGES[i] });
    },
  },
  {
    id: 'race',
    title: 'سباق الحركات',
    place: 'وادي الحركات',
    skill: 'قراءة الحرف مع الفتحة والضمة والكسرة',
    stages: STAGES,
    art: (child) => `<div class="art-photo" style="background-image:url('${BASE}assets/race/cover_${known(child)}.jpg')"></div>`,
    start: async (i, c) => {
      await loading(preloadRace(STAGES[i]));
      return new RaceGame(app, { ...c, stage: STAGES[i], mode: state.mode, reducedMotion: false });
    },
  },
  {
    id: 'first',
    title: 'مكتب البريد',
    place: 'مدينة الأصوات',
    skill: 'سماع أول صوت في الكلمة',
    stages: FIRSTSOUND_STAGES,
    art: () => `<div class="art-post"><span class="box">📮</span>${sticker('zarf', 'a')}${sticker('samaka', 'b')}${sticker('qitta', 'c')}</div>`,
    start: async (i, c) => {
      await loading(preloadFirstSound());
      return new FirstSoundGame(app, { ...c, stage: FIRSTSOUND_STAGES[i] });
    },
  },
  {
    id: 'factory',
    title: 'مصنع الكلمات',
    place: 'جبل التركيب',
    skill: 'تركيب الكلمة من حروفها',
    stages: FACTORY_STAGES,
    art: () =>
      `<div class="art-factory"><span class="gear g1">⚙️</span><span class="gear g2">⚙️</span>${sticker('sayyara', 'a')}${sticker('tuffaha', 'b')}<b>سَ ـيّـ ـا ر ة</b></div>`,
    start: async (i, c) => {
      await loading(preloadFactory(FACTORY_STAGES[i]));
      return new FactoryGame(app, { ...c, stage: FACTORY_STAGES[i] });
    },
  },
  {
    id: 'dict',
    title: 'تحدّي الإملاء',
    place: 'قلعة الإملاء',
    skill: 'كتابة الكلمة كاملة بعد سماعها',
    stages: DICTATION_STAGES,
    art: () => `<div class="art-dict">${sticker('kitab', 'a')}${sticker('risha', 'b')}<b>إملاء</b></div>`,
    start: async (i, c) => {
      await loading(preloadDictation());
      return new DictationGame(app, { ...c, stage: DICTATION_STAGES[i] });
    },
  },
];
const ISLAND = new Map(ISLANDS.map((s) => [s.id, s]));

const state = {
  child: pref('child', 'salem'),
  /** the island whose stations are open, or '' for the map */
  island: ISLAND.has(pref('island', '')) ? pref('island', '') : '',
  /** the island played last, glowing on the map */
  last: pref('game', 'race'),
  mode: pref('mode', 'calm') as RaceMode,
};

let game: { destroy(): void } | null = null;

function progress(is: Island) {
  let done = 0;
  let stars = 0;
  for (const s of is.stages) {
    const r = stageResult(state.child, s.id);
    if (!r?.completed) continue;
    done++;
    stars += Math.round((r.bestFirstTry / r.rounds) * 3);
  }
  return { done, stars, total: is.stages.length };
}

function playerChips() {
  return `<div class="players">
    ${PLAYERS.map(
      (p) => `<button class="player ${p.id === state.child ? 'sel' : ''}" data-id="${p.id}">
        <img src="${BASE}assets/chars/${p.id}_face.png" alt=""><span>${p.name}</span></button>`,
    ).join('')}
  </div>`;
}

function home() {
  game?.destroy();
  game = null;
  if (state.island) return islandScreen(ISLAND.get(state.island)!);
  app.className = 'home map';
  const all = ISLANDS.map(progress);
  const totalStars = all.reduce((a, p) => a + p.stars, 0);
  app.innerHTML = `
    <div class="sea"><i></i><i></i><i></i></div>
    <main class="home-main">
      <header>
        <h1>رحلة الحروف</h1>
        <p class="total"><span dir="ltr">★ ${totalStars}</span> نجمة</p>
      </header>
      <h2>من يلعب؟</h2>
      ${playerChips()}
      <h2>خريطة الجزر</h2>
      <ol class="islands">
        ${ISLANDS.map((is, k) => {
          const p = all[k];
          const pct = Math.round((p.done / p.total) * 100);
          return `<li><button class="island ${is.id} ${is.id === state.last ? 'last' : ''}" data-island="${is.id}">
            <span class="isl-num" dir="ltr">${k + 1}</span>
            <span class="isl-art">${is.art(state.child)}</span>
            <span class="isl-info">
              <b class="isl-title">${is.title}</b>
              <small>${is.place}</small>
              <span class="bar"><i style="width:${pct}%"></i></span>
              <span class="isl-count"><span dir="ltr">${p.done}/${p.total}</span> محطة · <span dir="ltr">★ ${p.stars}</span></span>
            </span>
          </button></li>`;
        }).join('')}
        <li><div class="island soon">
          <span class="isl-art"><div class="art-vs">
            <img src="${BASE}assets/chars/salem_face.png" alt=""><b>VS</b><img src="${BASE}assets/chars/raya_face.png" alt="">
          </div></span>
          <span class="isl-info"><b class="isl-title">ساحة التحدّي</b><small>لاعبان على شاشة وحدة · قريبًا</small></span>
        </div></li>
      </ol>
    </main>
    <img class="home-hero" src="${BASE}assets/chars/${state.child}_body.png" alt="">`;

  bindPlayers();
  app.querySelectorAll<HTMLButtonElement>('.island[data-island]').forEach((b) =>
    b.addEventListener('click', () => {
      state.island = b.dataset.island!;
      setPref('island', state.island);
      home();
    }),
  );
  // keep the island the child played last in view when coming back from a game
  app.querySelector('.island.last')?.scrollIntoView({ block: 'center' });
}

function islandScreen(is: Island) {
  app.className = `home isle ${is.id}`;
  const p = progress(is);
  const starsFor = (id: string) => {
    const r = stageResult(state.child, id);
    if (!r) return '';
    return `<span class="mini-stars" dir="ltr">${'★'.repeat(Math.round((r.bestFirstTry / r.rounds) * 3)).padEnd(3, '☆')}</span>`;
  };
  const firstOpen = is.stages.findIndex((s) => !stageResult(state.child, s.id)?.completed);
  app.innerHTML = `
    <div class="sea"><i></i><i></i><i></i></div>
    <main class="home-main">
      <button class="back">→ الخريطة</button>
      <div class="isle-banner">
        <span class="isl-art">${is.art(state.child)}</span>
        <div class="isle-head">
          <h1>${is.title}</h1>
          <p>${is.place} · ${is.skill}</p>
          <span class="isl-count"><span dir="ltr">${p.done}/${p.total}</span> محطة · <span dir="ltr">★ ${p.stars}</span></span>
        </div>
      </div>
      ${
        is.id === 'race'
          ? `<div class="opts"><div class="seg">
          <button data-mode="calm" class="${state.mode === 'calm' ? 'sel' : ''}">تدريب هادئ</button>
          <button data-mode="race" class="${state.mode === 'race' ? 'sel' : ''}">سباق</button>
        </div></div>`
          : ''
      }
      <h2>المحطات</h2>
      <ol class="stages">
        ${is.stages
          .map((s, i) => {
            const done = stageResult(state.child, s.id)?.completed;
            const cur = i === (firstOpen === -1 ? 0 : firstOpen);
            return `<li><button class="stage ${done ? 'done' : ''} ${cur ? 'cur' : ''}" data-i="${i}">
            <b class="num" dir="ltr">${i + 1}</b>
            <span class="st-title">${s.title}</span>
            ${done ? `<span class="badge">✓</span>${starsFor(s.id)}` : cur ? '<span class="badge go">ابدأ ◀</span>' : ''}
          </button></li>`;
          })
          .join('')}
      </ol>
    </main>
    <img class="home-hero" src="${BASE}assets/chars/${state.child}_body.png" alt="">`;

  app.querySelector('.back')!.addEventListener('click', () => {
    state.island = '';
    setPref('island', '');
    home();
  });
  app.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) =>
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode as RaceMode;
      setPref('mode', state.mode);
      home();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('.stage').forEach((b) => b.addEventListener('click', () => play(is, Number(b.dataset.i))));
  // later stations: bring the next one into view; early ones keep the island banner on screen
  if (firstOpen > 2) app.querySelector('.stage.cur')?.scrollIntoView({ block: 'center' });
}

function bindPlayers() {
  app.querySelectorAll<HTMLButtonElement>('.player').forEach((b) =>
    b.addEventListener('click', () => {
      state.child = b.dataset.id!;
      setPref('child', state.child);
      home();
    }),
  );
}

async function loading(work: Promise<unknown>) {
  app.className = 'loading';
  app.innerHTML = '<div class="loader">…</div>';
  await Promise.all([work, document.fonts.load('700 40px "Noto Naskh Arabic"')]);
  game?.destroy();
}

async function play(is: Island, i: number) {
  state.last = is.id;
  setPref('game', is.id);
  game = await is.start(i, {
    child: state.child,
    onExit: home,
    onRestart: () => void play(is, i),
    onNext: () => (i + 1 < is.stages.length ? void play(is, i + 1) : home()),
  });
}

home();
