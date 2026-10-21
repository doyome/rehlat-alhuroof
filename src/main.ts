import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/700.css';
import '@fontsource/baloo-bhaijaan-2/600.css';
import '@fontsource/baloo-bhaijaan-2/800.css';
import './style.css';
import { STAGES } from './data/race';
import { FISH_STAGES } from './data/fish';
import { stageResult } from './progress';
import { RaceGame, preloadRace, type RaceMode } from './race/game';
import { FishGame, preloadFish } from './fish/game';

const BASE = import.meta.env.BASE_URL;

const PLAYERS = [
  { id: 'salem', name: 'سالم' },
  { id: 'raya', name: 'راية' },
  { id: 'shamma', name: 'شمّا' },
];

type GameId = 'race' | 'fish';
const GAMES: Record<GameId, { title: string; place: string; stages: { id: string; title: string }[]; img: string }> = {
  race: { title: 'سباق الحركات', place: 'وادي الحركات', stages: STAGES, img: `${BASE}assets/race/patrol_rear.png` },
  fish: { title: 'الصيّاد', place: 'بحر الحروف', stages: FISH_STAGES, img: `${BASE}assets/fish/boat_salem.png` },
};

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

const state = {
  child: pref('child', 'salem'),
  game: (pref('game', 'race') === 'fish' ? 'fish' : 'race') as GameId,
  mode: pref('mode', 'calm') as RaceMode,
  // reduce-motion belongs to the parent settings (not built yet); the kids' screen never switches it on
  reduced: false,
};

let game: RaceGame | FishGame | null = null;

function home() {
  game?.destroy();
  game = null;
  app.className = 'home';
  const g = GAMES[state.game];
  const starsFor = (id: string) => {
    const r = stageResult(state.child, id);
    if (!r) return '';
    return `<span class="mini-stars" dir="ltr">${'★'.repeat(Math.round((r.bestFirstTry / r.rounds) * 3)).padEnd(3, '☆')}</span>`;
  };
  const firstOpen = g.stages.findIndex((s) => !stageResult(state.child, s.id)?.completed);
  const known = PLAYERS.some((p) => p.id === state.child);
  const boat = known ? `${BASE}assets/fish/boat_${state.child}.png` : GAMES.fish.img;
  const cover = `${BASE}assets/race/cover_${known ? state.child : 'salem'}.jpg`;
  app.innerHTML = `
    <div class="home-bg ${state.game}"></div>
    <main class="home-main">
      <header>
        <h1>رحلة الحروف</h1>
        <p>${g.place} · ${g.title}</p>
      </header>
      <section>
        <h2>من يلعب؟</h2>
        <div class="players">
          ${PLAYERS.map(
            (p) => `<button class="player ${p.id === state.child ? 'sel' : ''}" data-id="${p.id}">
              <img src="${BASE}assets/chars/${p.id}_face.png" alt=""><span>${p.name}</span></button>`,
          ).join('')}
        </div>
      </section>
      <section>
        <h2>اختر اللعبة</h2>
        <div class="games">
          <button class="game-card race ${state.game === 'race' ? 'sel' : ''}" data-game="race" style="background-image:url('${cover}')">
            <span>${GAMES.race.title}</span></button>
          <button class="game-card fish ${state.game === 'fish' ? 'sel' : ''}" data-game="fish">
            <img src="${boat}" alt=""><span>${GAMES.fish.title}</span></button>
        </div>
      </section>
      <section>
        <h2>المراحل</h2>
        <ol class="stages">
          ${g.stages
            .map((s, i) => {
              const done = stageResult(state.child, s.id)?.completed;
              const cur = i === (firstOpen === -1 ? 0 : firstOpen);
              return `<li><button class="stage ${done ? 'done' : ''} ${cur ? 'cur' : ''}" data-i="${i}">
              <b class="num" dir="ltr">${i + 1}</b>
              <span class="st-title">${s.title}</span>
              ${done ? `<span class="badge">✓ مكتملة</span>${starsFor(s.id)}` : cur ? '<span class="badge go">ابدأ ◀</span>' : ''}
            </button></li>`;
            })
            .join('')}
        </ol>
      </section>
      ${
        state.game === 'race'
          ? `<section class="opts">
        <div class="seg">
          <button data-mode="calm" class="${state.mode === 'calm' ? 'sel' : ''}">تدريب هادئ</button>
          <button data-mode="race" class="${state.mode === 'race' ? 'sel' : ''}">سباق</button>
        </div>
      </section>`
          : ''
      }
    </main>
    <img class="home-hero" src="${BASE}assets/chars/${state.child}_body.png" alt="">`;

  app.querySelectorAll<HTMLButtonElement>('.player').forEach((b) =>
    b.addEventListener('click', () => {
      state.child = b.dataset.id!;
      setPref('child', state.child);
      home();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('.game-card').forEach((b) =>
    b.addEventListener('click', () => {
      state.game = b.dataset.game as GameId;
      setPref('game', state.game);
      home();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) =>
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode as RaceMode;
      setPref('mode', state.mode);
      home();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('.stage').forEach((b) =>
    b.addEventListener('click', () => (state.game === 'race' ? playRace(Number(b.dataset.i)) : playFish(Number(b.dataset.i)))),
  );
}

async function loading(work: Promise<unknown>) {
  app.className = 'loading';
  app.innerHTML = '<div class="loader">…</div>';
  await Promise.all([work, document.fonts.load('700 40px "Noto Naskh Arabic"')]);
  game?.destroy();
}

async function playRace(i: number) {
  await loading(preloadRace());
  game = new RaceGame(app, {
    child: state.child,
    stage: STAGES[i],
    mode: state.mode,
    reducedMotion: state.reduced,
    onExit: home,
    onRestart: () => playRace(i),
    onNext: () => (i + 1 < STAGES.length ? playRace(i + 1) : home()),
  });
}

async function playFish(i: number) {
  await loading(preloadFish(state.child));
  game = new FishGame(app, {
    child: state.child,
    stage: FISH_STAGES[i],
    onExit: home,
    onRestart: () => playFish(i),
    onNext: () => (i + 1 < FISH_STAGES.length ? playFish(i + 1) : home()),
  });
}

home();
