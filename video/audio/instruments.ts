import { Biquad, filter, midiHz, mono, Mono, polyblep, rng, SR, sweep } from './dsp';

const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) * d));

const noiseSrc = (seed: number) => {
  const r = rng(seed);
  return () => r() * 2 - 1;
};

/* ---------- drums ---------- */

export const kick = (punch = 1): Mono => {
  const out = mono(0.5);
  const n = noiseSrc(1);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = 46 + 120 * Math.exp(-t * 32) * punch;
    ph += f / SR;
    const body = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 6.5);
    const click = n() * Math.exp(-t * 500) * 0.35;
    out[i] = Math.tanh((body + click) * 2.2) * 0.9;
  }
  return out;
};

/** 808: pitch-dropped sine with saturation so its harmonics survive phone speakers. */
export const sub808 = (midi: number, dur: number, drive = 2.4): Mono => {
  const out = mono(dur + 0.05);
  const f0 = midiHz(midi);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = f0 * (1 + 0.9 * Math.exp(-t * 45));
    ph += f / SR;
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.05) : 1;
    const a = Math.min(1, t / 0.003) * Math.exp(-t * 1.6) * rel;
    out[i] = (Math.tanh(Math.sin(2 * Math.PI * ph) * drive) / Math.tanh(drive)) * a;
  }
  return out;
};

export const clap = (seed = 3): Mono => {
  const out = mono(0.45);
  const n = noiseSrc(seed);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let e = Math.exp(-t * 16) * 0.55;
    for (const o of [0, 0.011, 0.022]) if (t >= o) e = Math.max(e, Math.exp(-(t - o) * 190));
    out[i] = n() * e;
  }
  filter(out, new Biquad('bp', 1500, 0.9));
  filter(out, new Biquad('hp', 600));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += 185 / SR;
    out[i] = out[i] * 2.2 + Math.sin(2 * Math.PI * ph) * Math.exp(-t * 30) * 0.35;
  }
  return out;
};

export const hat = (open = false, seed = 5): Mono => {
  const out = mono(open ? 0.35 : 0.08);
  const n = noiseSrc(seed);
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const ph = ratios.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let metal = 0;
    ratios.forEach((r, k) => {
      ph[k] = (ph[k] + (r * 400) / SR) % 1;
      metal += ph[k] < 0.5 ? 1 : -1;
    });
    out[i] = (n() * 0.7 + (metal / 6) * 0.5) * env(t, 0.0008, open ? 9 : 75);
  }
  filter(out, new Biquad('hp', 7000));
  filter(out, new Biquad('peak', 10000, 1, 4));
  return out;
};

export const crash = (len = 2.4, seed = 7): Mono => {
  const out = mono(len);
  const n = noiseSrc(seed);
  for (let i = 0; i < out.length; i++) out[i] = n() * env(i / SR, 0.002, 2.2);
  filter(out, new Biquad('hp', 4000));
  return out;
};

/** Low boom with a pitch fall, for drops and the logo hit. */
export const boom = (len = 1.8): Mono => {
  const out = mono(len);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += (38 + 70 * Math.exp(-t * 6)) / SR;
    out[i] = Math.tanh(Math.sin(2 * Math.PI * ph) * 2) * env(t, 0.004, 2.4);
  }
  return out;
};

export const riser = (len: number, seed = 11): Mono => {
  const out = mono(len);
  const n = noiseSrc(seed);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = t / len;
    ph += (220 * 2 ** (p * 3)) / SR;
    out[i] = (n() * 0.8 + Math.sin(2 * Math.PI * ph) * 0.25) * p ** 2.2;
  }
  return sweep(out, 'bp', (t) => 300 * 2 ** ((t / len) * 4.3), 1.4);
};

/* ---------- tonal ---------- */

export const saw = (f: number, len: number, detune = 0): Mono => {
  const out = mono(len);
  const fr = f * 2 ** (detune / 1200);
  const dt = fr / SR;
  let ph = (((detune % 1) + 1) % 1) * 0.5 + 0.25;
  for (let i = 0; i < out.length; i++) {
    out[i] = 2 * ph - 1 - polyblep(ph, dt);
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
  return out;
};

/** Three detuned saws per note, slow attack, lowpassed. */
export const padNote = (midi: number, len: number, cutoff: number, seed = 1): Mono => {
  const r = rng(seed + midi);
  const out = mono(len + 0.6);
  for (const d of [-9, 0, 9]) {
    const s = saw(midiHz(midi), len + 0.6, d + (r() - 0.5) * 3);
    for (let i = 0; i < out.length; i++) out[i] += s[i] / 3;
  }
  filter(out, new Biquad('lp', cutoff, 0.8));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const a = Math.min(1, t / 0.25);
    const rel = t > len ? Math.max(0, 1 - (t - len) / 0.6) : 1;
    out[i] *= a * rel;
  }
  return out;
};

export const pluck = (midi: number, len = 0.4): Mono => {
  const out = mono(len);
  const f = midiHz(midi);
  const dt = f / SR;
  let ph = 0;
  let ph2 = 0;
  for (let i = 0; i < out.length; i++) {
    const s = 2 * ph - 1 - polyblep(ph, dt);
    const sq = ph2 < 0.5 ? 1 : -1;
    out[i] = (s * 0.7 + sq * 0.3) * env(i / SR, 0.002, 11);
    ph = (ph + dt) % 1;
    ph2 = (ph2 + dt * 2.001) % 1;
  }
  return sweep(out, 'lp', (t) => 500 + 5000 * Math.exp(-t * 20), 1.2);
};

/** Two-operator FM bell. */
export const bell = (f: number, len = 1.2, index = 2.2, decay = 3.5): Mono => {
  const out = mono(len);
  let pc = 0;
  let pm = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    pm += (f * 3.5) / SR;
    pc += f / SR;
    const mod = Math.sin(2 * Math.PI * pm) * index * Math.exp(-t * 6);
    out[i] = Math.sin(2 * Math.PI * pc + mod) * env(t, 0.002, decay);
  }
  return out;
};

export const sine = (f: (t: number) => number, len: number, decay: number, attack = 0.002) => {
  const out = mono(len);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += f(t) / SR;
    out[i] = Math.sin(2 * Math.PI * ph) * env(t, attack, decay);
  }
  return out;
};

/* ---------- UI sounds ---------- */

export const uiClick = (seed = 21): Mono => {
  const out = mono(0.06);
  const n = noiseSrc(seed);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph += (2400 - 900 * Math.min(1, t * 80)) / SR;
    out[i] = n() * Math.exp(-t * 900) * 0.6 + Math.sin(2 * Math.PI * ph) * Math.exp(-t * 120) * 0.5;
  }
  return filter(out, new Biquad('hp', 500));
};

export const keyTick = (seed: number): Mono => {
  const r = rng(seed);
  const out = mono(0.03);
  const n = noiseSrc(seed + 1);
  for (let i = 0; i < out.length; i++) out[i] = n() * Math.exp((-i / SR) * 600);
  return filter(out, new Biquad('bp', 2500 + r() * 2500, 2));
};

export const whoosh = (len = 0.35, up = true, seed = 31): Mono => {
  const out = mono(len);
  const n = noiseSrc(seed);
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length;
    out[i] = n() * Math.sin(Math.PI * p) ** 2;
  }
  return sweep(
    out,
    'bp',
    (t) => (up ? 500 * 2 ** ((t / len) * 3) : 4000 * 2 ** (-(t / len) * 3)),
    1.6,
  );
};

export const thud = (): Mono => {
  const out = sine((t) => 70 + 120 * Math.exp(-t * 40), 0.18, 22);
  const c = uiClick(41);
  for (let i = 0; i < c.length; i++) out[i] += c[i] * 0.4;
  return out;
};

export const glitch = (len = 0.55, seed = 51): Mono => {
  const r = rng(seed);
  const out = mono(len);
  let i = 0;
  while (i < out.length) {
    const seg = Math.floor(SR * (0.012 + r() * 0.05));
    const f = 80 + r() * 1400;
    const on = r() > 0.25;
    const crush = 1 + Math.floor(r() * 24);
    let ph = 0;
    let held = 0;
    for (let k = 0; k < seg && i < out.length; k++, i++) {
      ph = (ph + f / SR) % 1;
      if (k % crush === 0) held = (ph < 0.5 ? 1 : -1) * 0.6 + (r() * 2 - 1) * 0.4;
      out[i] = on ? held * (1 - (i / out.length) * 0.6) : 0;
    }
  }
  return filter(out, new Biquad('lp', 6000));
};

export const beep = (midi: number, len = 0.12): Mono => {
  const f = midiHz(midi);
  const out = mono(len);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    ph = (ph + f / SR) % 1;
    const s = Math.sin(2 * Math.PI * ph) * 0.8 + (ph < 0.5 ? 0.2 : -0.2);
    out[i] = s * env(t, 0.002, 30);
  }
  return out;
};

export const chime = (midis: number[], gap = 0.07, len = 1.4): Mono => {
  const out = mono(len + gap * midis.length);
  midis.forEach((m, k) => {
    const b = bell(midiHz(m), len, 1.4, 3);
    const off = Math.round(k * gap * SR);
    for (let i = 0; i < b.length; i++) out[off + i] += b[i] / midis.length;
  });
  return out;
};

export const coin = (seed: number): Mono => {
  const r = rng(seed);
  const f = 2600 + r() * 1400;
  const out = mono(0.18);
  let ph = 0;
  let ph2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const ff = t < 0.04 ? f : f * 1.335;
    ph += ff / SR;
    ph2 += (ff * 2.76) / SR;
    out[i] = (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(2 * Math.PI * ph2)) * env(t, 0.001, 28);
  }
  return out;
};

export const lockClunk = (): Mono => {
  const out = mono(0.5);
  const n = noiseSrc(61);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const t2 = Math.max(0, t - 0.045);
    p1 += (95 + 160 * Math.exp(-t * 50)) / SR;
    p2 += 620 / SR;
    out[i] =
      Math.sin(2 * Math.PI * p1) * Math.exp(-t * 18) * 0.8 +
      n() * Math.exp(-t * 300) * 0.5 +
      (t >= 0.045
        ? n() * Math.exp(-t2 * 400) * 0.4 + Math.sin(2 * Math.PI * p2) * Math.exp(-t2 * 25) * 0.25
        : 0);
  }
  return out;
};

export const whir = (len: number): Mono => {
  const out = mono(len);
  const n = noiseSrc(71);
  const dt0 = 1 / SR;
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = t / len;
    const f = 140 * 2 ** (p * 3.2);
    ph = (ph + f * dt0) % 1;
    const stutter = Math.sin(2 * Math.PI * t * (8 + p * 22)) > -0.2 ? 1 : 0.35;
    out[i] =
      (2 * ph - 1 + n() * 0.25) * stutter * (0.25 + 0.75 * p) * Math.min(1, (len - t) / 0.03);
  }
  return sweep(out, 'lp', (t) => 900 * 2 ** ((t / len) * 2.6), 1.1);
};

export const pop = (): Mono => sine((t) => 520 + 700 * Math.min(1, t * 30), 0.1, 40, 0.001);
