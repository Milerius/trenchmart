// Minimal deterministic DSP toolkit for the promo soundtrack. Everything is synthesized
// from oscillators and seeded noise, so there are no third-party samples to license.

export const SR = 48000;

export type Mono = Float32Array;
export type Stereo = { L: Float32Array; R: Float32Array };

export const stereo = (seconds: number): Stereo => {
  const n = Math.ceil(seconds * SR);
  return { L: new Float32Array(n), R: new Float32Array(n) };
};

export const mono = (seconds: number): Mono => new Float32Array(Math.ceil(seconds * SR));

export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
export const db = (d: number) => 10 ** (d / 20);

/** mulberry32: seeded PRNG so every render is bit-identical. */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Mix a mono source into a stereo bus at `t` seconds with equal-power pan (-1..1). */
export const place = (bus: Stereo, src: Mono, t: number, gain = 1, pan = 0) => {
  const start = Math.round(t * SR);
  const a = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(a) * gain * Math.SQRT2;
  const gr = Math.sin(a) * gain * Math.SQRT2;
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j < 0 || j >= bus.L.length) continue;
    bus.L[j] += src[i] * gl;
    bus.R[j] += src[i] * gr;
  }
};

export const placeStereo = (bus: Stereo, src: Stereo, t: number, gain = 1) => {
  const start = Math.round(t * SR);
  for (let i = 0; i < src.L.length; i++) {
    const j = start + i;
    if (j < 0 || j >= bus.L.length) continue;
    bus.L[j] += src.L[i] * gain;
    bus.R[j] += src.R[i] * gain;
  }
};

export const polyblep = (t: number, dt: number) => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};

/** RBJ biquad with per-call coefficient updates for automated cutoffs. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private type: 'lp' | 'hp' | 'bp' | 'peak',
    freq: number,
    q = 0.707,
    private gainDb = 0,
  ) {
    this.set(freq, q);
  }
  set(freq: number, q = 0.707) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (this.type === 'lp') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (this.type === 'hp') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (this.type === 'bp') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else {
      const A = 10 ** (this.gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  p(x: number) {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export const filter = (src: Mono, f: Biquad) => {
  for (let i = 0; i < src.length; i++) src[i] = f.p(src[i]);
  return src;
};

/** Filter with a cutoff that follows `cutoff(tSeconds)`, updated every 32 samples. */
export const sweep = (
  src: Mono,
  type: 'lp' | 'hp' | 'bp',
  cutoff: (t: number) => number,
  q = 0.707,
) => {
  const f = new Biquad(type, cutoff(0), q);
  for (let i = 0; i < src.length; i++) {
    if (i % 32 === 0) f.set(cutoff(i / SR), q);
    src[i] = f.p(src[i]);
  }
  return src;
};

export const sweepStereo = (bus: Stereo, type: 'lp' | 'hp', cutoff: (t: number) => number) => {
  sweep(bus.L, type, cutoff);
  sweep(bus.R, type, cutoff);
};

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(
    n: number,
    private fb: number,
    private damp: number,
  ) {
    this.buf = new Float32Array(n);
  }
  p(x: number) {
    const y = this.buf[this.i];
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.fb;
    this.i = (this.i + 1) % this.buf.length;
    return y;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(n: number) {
    this.buf = new Float32Array(n);
  }
  p(x: number) {
    const b = this.buf[this.i];
    this.buf[this.i] = x + b * 0.5;
    this.i = (this.i + 1) % this.buf.length;
    return b - x;
  }
}

/** Freeverb-style stereo reverb; returns the wet signal only. */
export const reverb = (src: Stereo, room = 0.8, damp = 0.3): Stereo => {
  const k = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const fb = 0.7 + 0.28 * room;
  const out = { L: new Float32Array(src.L.length), R: new Float32Array(src.R.length) };
  for (const [ch, spread] of [
    ['L', 0],
    ['R', 23],
  ] as const) {
    const cs = combs.map((n) => new Comb(Math.round((n + spread) * k), fb, damp));
    const as = aps.map((n) => new Allpass(Math.round((n + spread) * k)));
    const inp = src[ch];
    const o = out[ch];
    for (let i = 0; i < inp.length; i++) {
      const x = (inp[i] + (ch === 'L' ? src.R[i] : src.L[i])) * 0.015;
      let y = 0;
      for (const c of cs) y += c.p(x);
      for (const a of as) y = a.p(y);
      o[i] = y;
    }
  }
  return out;
};

/** Ping-pong delay; returns the wet signal only. */
export const pingPong = (src: Stereo, time: number, fb = 0.4): Stereo => {
  const d = Math.round(time * SR);
  const out = { L: new Float32Array(src.L.length), R: new Float32Array(src.R.length) };
  for (let i = 0; i < src.L.length; i++) {
    const l = i >= d ? out.R[i - d] * fb + src.L[i - d] : 0;
    const r = i >= d ? out.L[i - d] * fb + src.R[i - d] : 0;
    out.L[i] = l;
    out.R[i] = r;
  }
  return out;
};

export const addInto = (dst: Stereo, src: Stereo, gain = 1) => {
  for (let i = 0; i < dst.L.length; i++) {
    dst.L[i] += src.L[i] * gain;
    dst.R[i] += src.R[i] * gain;
  }
};

export const applyGain = (bus: Stereo, g: (t: number) => number) => {
  for (let i = 0; i < bus.L.length; i++) {
    const v = g(i / SR);
    bus.L[i] *= v;
    bus.R[i] *= v;
  }
};

export const softClip = (bus: Stereo, drive = 1) => {
  const n = Math.tanh(drive);
  for (let i = 0; i < bus.L.length; i++) {
    bus.L[i] = Math.tanh(bus.L[i] * drive) / n;
    bus.R[i] = Math.tanh(bus.R[i] * drive) / n;
  }
};

export const peak = (bus: Stereo) => {
  let p = 0;
  for (let i = 0; i < bus.L.length; i++) p = Math.max(p, Math.abs(bus.L[i]), Math.abs(bus.R[i]));
  return p;
};

export const normalize = (bus: Stereo, target = 0.5) => {
  const p = peak(bus) || 1;
  applyGain(bus, () => target / p);
};

/** 32-bit float WAV. */
export const wav = (bus: Stereo): Buffer => {
  const n = bus.L.length;
  const data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) {
    data.writeFloatLE(bus.L[i], i * 8);
    data.writeFloatLE(bus.R[i], i * 8 + 4);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 8, 28);
  h.writeUInt16LE(8, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};
