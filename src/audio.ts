// Voices and effects are ElevenLabs recordings in assets/audio (decoded once, played through
// Web Audio for instant response). Browser TTS and synthesized tones only cover missing files.

const BASE = import.meta.env.BASE_URL;

let ctx: AudioContext | undefined;
const buffers = new Map<string, AudioBuffer | null>();
export const settings = { music: true, voice: true, sfx: true };

function ac() {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  return ctx;
}

// iPad Safari leaves the context 'interrupted' after a lock or a call; the next touch wakes it
for (const ev of ['pointerdown', 'touchend', 'keydown'] as const) {
  window.addEventListener(ev, () => ctx && ctx.state !== 'running' && void ctx.resume().catch(() => undefined), { passive: true });
}

let arVoice: SpeechSynthesisVoice | undefined;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  arVoice = vs.find((v) => v.lang.startsWith('ar') && /hoda|naayf|salma|hamed|zariyah/i.test(v.name)) ?? vs.find((v) => v.lang.startsWith('ar'));
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

async function load(key: string): Promise<AudioBuffer | null> {
  if (buffers.has(key)) return buffers.get(key)!;
  try {
    const r = await fetch(`${BASE}assets/audio/${key}.mp3`);
    const ok = r.ok && (r.headers.get('content-type') ?? '').includes('audio');
    const buf = ok ? await ac().decodeAudioData(await r.arrayBuffer()) : null;
    buffers.set(key, buf);
    return buf;
  } catch {
    buffers.set(key, null);
    return null;
  }
}

export function preloadAudio(keys: string[]) {
  return Promise.all(keys.map(load));
}

function playBuffer(buf: AudioBuffer, gain: number, rate = 1, dest?: AudioNode) {
  const a = ac();
  const src = a.createBufferSource();
  const g = a.createGain();
  src.buffer = buf;
  src.playbackRate.value = rate;
  g.gain.value = gain;
  src.connect(g).connect(dest ?? a.destination);
  src.start();
  return src;
}

/** Play an effect file; returns false when the file is missing so callers can fall back. */
export function play(key: string, gain = 1, rate = 1) {
  if (!settings.sfx) return true;
  const buf = buffers.get(key);
  if (!buf) {
    void load(key);
    return false;
  }
  // effects step back while someone is speaking, so the letter is always the clearest sound
  playBuffer(buf, voiceSrc ? gain * 0.35 : gain, rate);
  return true;
}

let voiceSrc: AudioBufferSourceNode | null = null;
const voiceListeners = new Set<(speaking: boolean) => void>();
export const onVoice = (fn: (speaking: boolean) => void) => {
  voiceListeners.add(fn);
  return () => voiceListeners.delete(fn);
};

/** Speak a line (one voice at a time). Resolves when it finishes. `text` is the TTS fallback. */
export async function say(key: string, text: string): Promise<void> {
  if (!settings.voice) return;
  const buf = await load(key);
  voiceSrc?.stop();
  voiceSrc = null;
  if (buf) {
    const src = playBuffer(buf, 1);
    voiceSrc = src;
    voiceListeners.forEach((f) => f(true));
    return new Promise((res) => {
      const end = () => {
        clearTimeout(guard);
        if (voiceSrc === src) {
          voiceSrc = null;
          voiceListeners.forEach((f) => f(false));
        }
        res();
      };
      // iPad Safari can suspend or interrupt the audio context (lock screen, a notification, a call);
      // then `ended` never fires and every game waiting on the voice would freeze, so a timer backs it up
      const guard = setTimeout(end, buf.duration * 1000 + 700);
      src.onended = end;
    });
  }
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = arVoice?.lang ?? 'ar-SA';
  if (arVoice) u.voice = arVoice;
  u.rate = 0.85;
  return new Promise((res) => {
    // cancel() or a missing voice can skip `end`; never leave a game waiting
    const guard = setTimeout(res, 1500 + text.length * 180);
    u.onend = u.onerror = () => {
      clearTimeout(guard);
      res();
    };
    speechSynthesis.speak(u);
  });
}

export function stopVoice() {
  voiceSrc?.stop();
  voiceSrc = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number) {
  const a = ac();
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  correct() {
    if (!settings.sfx) return;
    if (play('sfx/correct', 0.8)) {
      setTimeout(() => play('sfx/star', 0.7), 180);
      return;
    }
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.18, i * 0.08));
  },
  bump() {
    if (!settings.sfx) return;
    if (play('sfx/bump', 0.9)) return;
    tone(220, 0.25, 'sine', 0.25, 0, 120);
    tone(330, 0.2, 'triangle', 0.08, 0.05, 180);
  },
  whoosh() {
    if (!settings.sfx) return;
    if (play('sfx/whoosh', 0.7)) return;
    const a = ac();
    const len = a.sampleRate * 0.4;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
    const s = a.createBufferSource();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    f.type = 'bandpass';
    f.frequency.value = 900;
    g.gain.value = 0.12;
    s.buffer = buf;
    s.connect(f).connect(g).connect(a.destination);
    s.start();
  },
  /** Light tyre squeal for a quick lane change. */
  squeal() {
    if (!settings.sfx) return;
    if (play('sfx/screech', 0.45, 1.1)) return;
    const a = ac();
    const t = a.currentTime;
    const len = a.sampleRate * 0.5;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 18;
    bp.frequency.setValueAtTime(2300, t);
    bp.frequency.linearRampToValueAtTime(1700, t + 0.45);
    const o = a.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1900, t);
    o.frequency.linearRampToValueAtTime(1500, t + 0.45);
    const lfo = a.createOscillator();
    const lg = a.createGain();
    lfo.frequency.value = 38;
    lg.gain.value = 60;
    lfo.connect(lg).connect(o.frequency);
    const og = a.createGain();
    og.gain.value = 0.25;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
    src.connect(bp).connect(g);
    o.connect(og).connect(bp);
    g.connect(a.destination);
    src.start(t);
    o.start(t);
    lfo.start(t);
    src.stop(t + 0.5);
    o.stop(t + 0.5);
    lfo.stop(t + 0.5);
  },
  tap() {
    if (!settings.sfx) return;
    tone(880, 0.08, 'sine', 0.08);
  },
  fanfare() {
    if (!settings.sfx) return;
    if (play('sfx/fanfare', 0.8)) {
      setTimeout(() => play('sfx/applause', 0.9), 400);
      return;
    }
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, 'triangle', 0.15, i * 0.11));
  },
};

/** Engine: looped recording whose pitch follows the speed and revs on demand; ducks under speech. */
export class Engine {
  private src?: AudioBufferSourceNode;
  private o?: OscillatorNode;
  private g?: GainNode;
  private base = 0.55;
  private revUntil = 0;
  private revAmt = 0;
  private speed = 0;
  private offVoice = onVoice((speaking) => this.g?.gain.setTargetAtTime(speaking ? this.base * 0.25 : this.base, ac().currentTime, 0.1));
  start() {
    if (!settings.sfx || this.src || this.o) return;
    const a = ac();
    this.g = a.createGain();
    this.g.gain.value = this.base;
    this.g.connect(a.destination);
    const buf = buffers.get('sfx/engine2') ?? buffers.get('sfx/engine');
    if (buf) {
      this.src = a.createBufferSource();
      this.src.buffer = buf;
      this.src.loop = true;
      this.src.loopStart = 0.25;
      this.src.loopEnd = Math.max(0.5, buf.duration - 0.25);
      this.src.connect(this.g);
      this.src.start(0, 0.25);
      return;
    }
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    this.o = a.createOscillator();
    this.o.type = 'sawtooth';
    this.o.frequency.value = 55;
    this.g.gain.value = 0.025;
    this.o.connect(f).connect(this.g);
    this.o.start();
  }
  /** A short burst of revs (countdown, turbo). */
  rev(amount: number) {
    this.revAmt = amount;
    this.revUntil = performance.now() + 700;
    this.apply();
  }
  setSpeed(v: number) {
    this.speed = v;
    this.apply();
  }
  private apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const rev = performance.now() < this.revUntil ? this.revAmt : 0;
    this.src?.playbackRate.setTargetAtTime(0.7 + this.speed * 0.06 + rev * 0.5, t, rev ? 0.08 : 0.3);
    this.o?.frequency.setTargetAtTime(45 + this.speed * 6 + rev * 40, t, 0.2);
  }
  stop() {
    this.src?.stop();
    this.o?.stop();
    this.src = undefined;
    this.o = undefined;
    this.g?.disconnect();
  }
  dispose() {
    this.stop();
    this.offVoice();
  }
}

/** Background music loop; ducks under speech and can be switched off from the pause menu. */
export class Music {
  private src?: AudioBufferSourceNode;
  private g?: GainNode;
  private level = 1;
  private on = true;
  private offVoice = onVoice((speaking) => this.g?.gain.setTargetAtTime(this.target(speaking), ac().currentTime, 0.2));
  constructor(
    private key: string,
    private base = 0.32,
  ) {}
  private target(speaking = false) {
    return this.on && settings.music ? this.base * this.level * (speaking ? 0.3 : 1) : 0;
  }
  start() {
    if (this.src) return;
    const buf = buffers.get(this.key);
    if (!buf) return;
    const a = ac();
    this.g = a.createGain();
    this.g.gain.value = 0;
    this.g.gain.setTargetAtTime(this.target(), a.currentTime, 0.6);
    this.g.connect(a.destination);
    this.src = a.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;
    this.src.connect(this.g);
    this.src.start();
  }
  duck(level: number) {
    this.level = level;
    this.g?.gain.setTargetAtTime(this.target(), ac().currentTime, 0.4);
  }
  pause() {
    this.g?.gain.setTargetAtTime(0, ac().currentTime, 0.1);
  }
  resume() {
    this.g?.gain.setTargetAtTime(this.target(), ac().currentTime, 0.3);
  }
  toggle() {
    this.on = !this.on;
    this.g?.gain.setTargetAtTime(this.target(), ac().currentTime, 0.2);
    return this.on;
  }
  dispose() {
    this.src?.stop();
    this.src = undefined;
    this.g?.disconnect();
    this.offVoice();
  }
}
