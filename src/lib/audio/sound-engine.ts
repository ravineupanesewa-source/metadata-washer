"use client";

import { useSyncExternalStore } from "react";
import { Ambience } from "./ambience";
import { chain, envelope, noiseBuffer, panner, rand, roomImpulse } from "./audio-utils";
import type { Cue, Mood } from "./sound-cues";

/**
 * The app's sound effects, synthesized live with the Web Audio API: no audio files to
 * download, no licences, and every browser (iOS included) plays them. Synthesis also
 * lets the wash react like a real machine: the motor's pitch climbs as the drum spins
 * up, the water sloshes at the drum's rate, and the drain gurgles as it empties.
 *
 * Mixing rules: quiet UI levels, soft attacks (no clicks), exponential decays, and a
 * master compressor so overlapping sounds never clip. Nothing plays until the user has
 * interacted with the page (browser autoplay policy), when muted, or in a hidden tab.
 *
 * Signal flow:
 *
 *   effects ─┬────────────────────────┐
 *            └─ send 0.14 ─┐          ├─ master (mute) → compressor → speakers
 *   music ───┬─────────────┼──────────┤
 *            └─ send 0.5 ──┴─ room reverb ┘
 *
 * One shared room reverb puts the clicks, the washer and the music in the same space.
 * The speaker button mutes everything; the Music switch only the background bed.
 */

const PREF_KEY = "cleanframe.sound";
const MUSIC_KEY = "cleanframe.music";
const MASTER_LEVEL = 0.8;
const MUSIC_LEVEL = 0.42;
const REVERB_RETURN = 0.32;

type Ctx = AudioContext;
const now = (ctx: Ctx) => ctx.currentTime;

/* ================================================================ preference === */

let enabled = true;
let music = true;
const listeners = new Set<() => void>();
function readPref(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}
function writePref(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Not persisted; still applies to this page view.
  }
}
if (typeof window !== "undefined") {
  enabled = readPref(PREF_KEY);
  music = readPref(MUSIC_KEY);
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** All sound (effects and music). */
export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled, () => true);
}

export function setSoundEnabled(next: boolean) {
  enabled = next;
  writePref(PREF_KEY, next);
  engine.applyEnabled();
  listeners.forEach((l) => l());
}

/** The background music only (still silent while all sound is off). */
export function useMusicEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => music, () => true);
}

export function setMusicEnabled(next: boolean) {
  music = next;
  writePref(MUSIC_KEY, next);
  engine.applyEnabled();
  listeners.forEach((l) => l());
}

/* ================================================================ the engine === */

class SoundEngine {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  /** Effects bus. */
  private out!: GainNode;
  private musicBus!: GainNode;
  private ambience: Ambience | null = null;
  private mood: Mood = "idle";
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private wash: Wash | null = null;
  private unlockInstalled = false;

  /** Call once on the client: the context starts on the user's first interaction. */
  installUnlock() {
    if (this.unlockInstalled || typeof window === "undefined") return;
    this.unlockInstalled = true;
    const unlock = () => {
      this.ensure();
      ["pointerdown", "keydown", "touchend"].forEach((e) => window.removeEventListener(e, unlock, true));
    };
    ["pointerdown", "keydown", "touchend"].forEach((e) => window.addEventListener(e, unlock, true));
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (enabled) void this.ctx.resume();
    });
  }

  private ensure(): Ctx | null {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
      return this.ctx;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor({ latencyHint: "interactive" });
    // Master: level → gentle compressor/limiter → speakers.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = enabled ? MASTER_LEVEL : 0;
    this.master.connect(comp).connect(ctx.destination);
    // Shared room: a generated 2.4 s impulse, fed by both buses.
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx, 2.4, 2.6);
    const roomReturn = ctx.createGain();
    roomReturn.gain.value = REVERB_RETURN;
    room.connect(roomReturn).connect(this.master);
    this.out = ctx.createGain();
    this.out.connect(this.master);
    const fxSend = ctx.createGain();
    fxSend.gain.value = 0.14;
    this.out.connect(fxSend).connect(room);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MUSIC_LEVEL;
    this.musicBus.connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.5;
    this.musicBus.connect(musicSend).connect(room);
    this.white = noiseBuffer(ctx, 1, false);
    this.pink = noiseBuffer(ctx, 3, true);
    this.ctx = ctx;
    this.syncMusic();
    return ctx;
  }

  applyEnabled() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.master.gain.setTargetAtTime(enabled ? MASTER_LEVEL : 0, now(ctx), 0.05);
    if (!enabled) this.wash?.stop(now(ctx), 0.15);
    this.syncMusic();
  }

  /** The music follows the wash (see moodFor). */
  setMood(mood: Mood) {
    this.mood = mood;
    this.ambience?.setMood(mood);
  }

  /** Start or stop the background bed to match the preferences. */
  private syncMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = enabled && music;
    if (want && !this.ambience) this.ambience = new Ambience(ctx, this.musicBus, this.mood);
    if (!want && this.ambience) {
      this.ambience.stop();
      this.ambience = null;
    }
  }

  play(cue: Cue) {
    if (!enabled || typeof window === "undefined") return;
    const ctx = this.ensure();
    if (!ctx || ctx.state === "closed") return;
    const t = now(ctx) + 0.01;
    switch (cue) {
      case "drop":
        return this.drop(t);
      case "start":
        return this.start(t);
      case "doorOpen":
        return this.doorOpen(t);
      case "doorClose":
        return this.doorClose(t);
      case "washStart":
        this.wash?.stop(t, 0.05);
        this.wash = new Wash(ctx, this.out, this.pink, this.white, t);
        return;
      case "drain":
        return this.wash?.drain(t);
      case "rinse":
        return this.wash?.rinse(t);
      case "washStop":
        this.wash?.stop(t, 0.35);
        this.wash = null;
        return;
      case "sparkle":
        return this.sparkle(t + 0.25, 1);
      case "fault":
        return this.fault(t);
      case "cancel":
        return this.cancel(t);
      case "download":
        return this.download(t);
      case "thanks":
        this.sparkle(t, 1.25);
        return this.confettiCrackle(t + 0.05);
      case "dragEnter":
        return this.dragEnter(t);
      case "dragLeave":
        return this.whoosh(t, { from: 2200, to: 380, dur: 0.32, peak: 0.05 });
      case "pick":
        return this.tap(t, 1);
      case "reject":
        return this.reject(t);
      case "remove":
        return this.remove(t);
      case "clear":
        return this.clear(t);
      case "reveal":
        return this.reveal(t);
      case "zip":
        return this.zip(t);
      case "dialogOpen":
        this.whoosh(t, { from: 500, to: 2600, dur: 0.22, peak: 0.04 });
        return this.tone({ type: "sine", from: 2349, at: t + 0.12, dur: 0.18, peak: 0.018, pan: 0.2 });
      case "dialogClose":
        this.whoosh(t, { from: 2400, to: 450, dur: 0.18, peak: 0.032 });
        return this.tone({ type: "sine", from: 1175, at: t + 0.06, dur: 0.12, peak: 0.014, pan: -0.2 });
      case "toggleOn":
        this.tap(t, 1.2);
        return this.tone({ type: "sine", from: 880, to: 1320, at: t + 0.015, dur: 0.07, peak: 0.05 });
      case "toggleOff":
        this.tap(t, 0.8);
        return this.tone({ type: "sine", from: 740, to: 440, at: t + 0.015, dur: 0.07, peak: 0.045 });
      case "select":
        this.tap(t, 1.1);
        return this.tone({ type: "sine", from: 1568, at: t + 0.01, dur: 0.06, peak: 0.03 });
      case "copy":
        this.tone({ type: "sine", from: 1318.5, at: t, dur: 0.05, peak: 0.04 });
        return this.tone({ type: "sine", from: 1975.5, at: t + 0.06, dur: 0.09, peak: 0.035 });
    }
  }

  /* ---------------------------------------------------------------- recipes --- */

  /** Photo pinned to the line: a soft plip and a peg clip. */
  private drop(t: number) {
    this.tone({ type: "sine", from: 1150, to: 420, at: t, dur: 0.11, peak: 0.16 });
    this.burst({ at: t, dur: 0.015, peak: 0.05, filter: "highpass", freq: 3200 });
    this.tone({ type: "triangle", from: 760, to: 700, at: t + 0.09, dur: 0.05, peak: 0.06 });
  }

  /** The big button: a mechanical ka-chunk and a dial tick. */
  private start(t: number) {
    this.burst({ at: t, dur: 0.025, peak: 0.22, filter: "bandpass", freq: 1800, q: 1.2 });
    this.tone({ type: "sine", from: 150, to: 58, at: t + 0.01, dur: 0.14, peak: 0.34 });
    this.tone({ type: "triangle", from: 1760, to: 1700, at: t + 0.06, dur: 0.03, peak: 0.04 });
  }

  /** Latch click, a breath of hinge, and the air moving as the door swings. */
  private doorOpen(t: number) {
    this.burst({ at: t, dur: 0.012, peak: 0.16, filter: "highpass", freq: 2600 });
    this.burst({ at: t + 0.02, dur: 0.35, peak: 0.07, attack: 0.08, filter: "bandpass", freq: 500, toFreq: 2200, q: 0.8, pink: true });
  }

  /** The door thuds shut against its seal. */
  private doorClose(t: number) {
    this.tone({ type: "sine", from: 98, to: 52, at: t, dur: 0.2, peak: 0.42 });
    this.burst({ at: t, dur: 0.06, peak: 0.2, filter: "lowpass", freq: 420, pink: true });
    this.burst({ at: t + 0.05, dur: 0.012, peak: 0.08, filter: "highpass", freq: 2400 });
  }

  /** "Squeaky clean": a rising bell arpeggio with a little shimmer on top. */
  private sparkle(t: number, size: number) {
    const notes = [1046.5, 1318.5, 1568, 2093]; // C6 E6 G6 C7
    notes.forEach((f, i) => {
      const at = t + i * 0.075;
      const pan = (i / (notes.length - 1)) * 0.8 - 0.4;
      this.tone({ type: "sine", from: f, at, dur: 0.7 * size, peak: 0.075, attack: 0.003, pan });
      // Bell partial (2.76×) for a struck-metal shimmer rather than a plain beep.
      this.tone({ type: "sine", from: f * 2.76, at, dur: 0.25 * size, peak: 0.018, attack: 0.002, pan });
    });
    this.burst({ at: t + 0.15, dur: 0.35 * size, peak: 0.025, attack: 0.05, filter: "highpass", freq: 6500 });
  }

  /** A jam: two buzzer pulses (beating detuned squares) and a dull clunk. */
  private fault(t: number) {
    this.doorClose(t);
    for (const at of [t + 0.12, t + 0.42]) {
      for (const f of [110, 116.5]) this.tone({ type: "square", from: f, at, dur: 0.18, peak: 0.05, attack: 0.008, lowpass: 900, hold: true });
    }
  }

  /** Stopped mid-wash: a switch-off click and a falling tone. */
  private cancel(t: number) {
    this.burst({ at: t, dur: 0.015, peak: 0.12, filter: "bandpass", freq: 1500 });
    this.tone({ type: "triangle", from: 320, to: 110, at: t + 0.02, dur: 0.28, peak: 0.08 });
  }

  /** A cleaned file saved: a light upward pop. */
  private download(t: number) {
    this.tone({ type: "sine", from: 520, to: 1180, at: t, dur: 0.09, peak: 0.11 });
    this.burst({ at: t, dur: 0.01, peak: 0.04, filter: "highpass", freq: 3000 });
  }

  /** Confetti: a scatter of tiny paper ticks. */
  private confettiCrackle(t: number) {
    for (let i = 0; i < 18; i++) {
      this.burst({ at: t + rand(0, 0.7), dur: 0.008, peak: rand(0.015, 0.04), filter: "highpass", freq: rand(3000, 7000), pan: rand(-0.7, 0.7) });
    }
  }

  /** Files hovering over the washer: an airy swell up into the drum and a low, expectant bloom. */
  private dragEnter(t: number) {
    this.whoosh(t, { from: 380, to: 2600, dur: 0.5, peak: 0.075, attack: 0.28 });
    this.tone({ type: "sine", from: 73.4, to: 98, at: t, dur: 0.6, peak: 0.12, attack: 0.2 });
    // A lavender shimmer: a ninth (E6 + F#6) fading in on top.
    this.tone({ type: "sine", from: 1318.5, at: t + 0.18, dur: 0.5, peak: 0.016, attack: 0.12, pan: -0.3 });
    this.tone({ type: "sine", from: 1480, at: t + 0.24, dur: 0.5, peak: 0.014, attack: 0.12, pan: 0.3 });
  }

  /** A soft tactile key press; `pitch` scales its brightness. */
  private tap(t: number, pitch: number) {
    this.burst({ at: t, dur: 0.008, peak: 0.07, filter: "bandpass", freq: 2600 * pitch, q: 1.5 });
    this.tone({ type: "sine", from: 620 * pitch, to: 420 * pitch, at: t, dur: 0.035, peak: 0.05 });
  }

  /** The washer won't take it: two soft, falling rubbery "bonks". */
  private reject(t: number) {
    this.tone({ type: "triangle", from: 247, to: 196, at: t, dur: 0.12, peak: 0.1, lowpass: 1100 });
    this.tone({ type: "triangle", from: 185, to: 139, at: t + 0.13, dur: 0.18, peak: 0.1, lowpass: 900 });
  }

  /** A photo unpegged from the line: a quick swish and a falling pop. */
  private remove(t: number) {
    this.whoosh(t, { from: 2800, to: 900, dur: 0.16, peak: 0.05 });
    this.tone({ type: "sine", from: 760, to: 230, at: t + 0.05, dur: 0.12, peak: 0.1 });
    this.burst({ at: t + 0.05, dur: 0.01, peak: 0.04, filter: "highpass", freq: 3200 });
  }

  /** The whole line cleared: a long sweep down with the pegs popping off one after another. */
  private clear(t: number) {
    this.whoosh(t, { from: 3000, to: 280, dur: 0.55, peak: 0.075, attack: 0.05 });
    [0, 0.07, 0.13, 0.18].forEach((d, i) => {
      this.tone({ type: "sine", from: 900 - i * 120, to: 300 - i * 30, at: t + d, dur: 0.08, peak: 0.06, pan: -0.5 + i * 0.33 });
    });
  }

  /** Results slide in: a rising sweep and a soft D-major bloom (the music's home chord). */
  private reveal(t: number) {
    this.whoosh(t, { from: 450, to: 3200, dur: 0.35, peak: 0.05, attack: 0.18 });
    [587.3, 740, 880, 1108.7].forEach((f, i) => {
      this.tone({ type: "sine", from: f, at: t + 0.16 + i * 0.03, dur: 0.9, peak: 0.028, attack: 0.03, pan: -0.3 + i * 0.2 });
    });
  }

  /** "Download all": a zipper ratchet (ticks speeding up and rising) while the ZIP is built; the download pop follows. */
  private zip(t: number) {
    let at = t;
    for (let i = 0; i < 16; i++) {
      const k = i / 15;
      this.burst({ at, dur: 0.006, peak: 0.03 + k * 0.025, filter: "bandpass", freq: 1800 + k * 3200, q: 3, pan: -0.4 + k * 0.8 });
      at += 0.032 - k * 0.02;
    }
  }

  /** Air moving: band-passed noise sweeping between two frequencies. */
  private whoosh(t: number, o: { from: number; to: number; dur: number; peak: number; attack?: number }) {
    this.burst({ at: t, dur: o.dur, peak: o.peak, attack: o.attack ?? o.dur * 0.35, filter: "bandpass", freq: o.from, toFreq: o.to, q: 1.1, pink: true });
  }

  /* -------------------------------------------------------------- primitives --- */

  private tone(o: {
    type: OscillatorType;
    from: number;
    to?: number;
    at: number;
    dur: number;
    peak: number;
    attack?: number;
    pan?: number;
    lowpass?: number;
    /** Square-ish envelope (sustain, then a short release) instead of a decay. */
    hold?: boolean;
  }) {
    const ctx = this.ctx!;
    const attack = o.attack ?? 0.004;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, o.at);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.at + o.dur);
    const gain = ctx.createGain();
    if (o.hold) {
      gain.gain.setValueAtTime(0, o.at);
      gain.gain.linearRampToValueAtTime(o.peak, o.at + attack);
      gain.gain.setValueAtTime(o.peak, o.at + o.dur - 0.02);
      gain.gain.linearRampToValueAtTime(0, o.at + o.dur);
    } else {
      envelope(gain.gain, o.at, o.peak, attack, o.dur);
    }
    const nodes: AudioNode[] = [osc];
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lowpass;
      nodes.push(f);
    }
    nodes.push(gain);
    if (o.pan) nodes.push(panner(ctx, o.pan));
    chain(nodes, this.out);
    osc.start(o.at);
    osc.stop(o.at + attack + o.dur + 0.05);
    osc.onended = () => nodes.forEach((n) => n.disconnect());
  }

  private burst(o: {
    at: number;
    dur: number;
    peak: number;
    filter: BiquadFilterType;
    freq: number;
    toFreq?: number;
    q?: number;
    attack?: number;
    pink?: boolean;
    pan?: number;
  }) {
    const ctx = this.ctx!;
    const attack = o.attack ?? 0.002;
    const src = ctx.createBufferSource();
    src.buffer = o.pink ? this.pink : this.white;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.frequency.setValueAtTime(o.freq, o.at);
    if (o.toFreq) filter.frequency.exponentialRampToValueAtTime(o.toFreq, o.at + o.dur);
    filter.Q.value = o.q ?? 0.7;
    const gain = ctx.createGain();
    envelope(gain.gain, o.at, o.peak, attack, o.dur);
    const nodes: AudioNode[] = [src, filter, gain];
    if (o.pan) nodes.push(panner(ctx, o.pan));
    chain(nodes, this.out);
    src.start(o.at, rand(0, src.buffer.duration - o.dur - attack - 0.1));
    src.stop(o.at + attack + o.dur + 0.05);
    src.onended = () => nodes.forEach((n) => n.disconnect());
  }
}

/* =============================================================== wash loop === */

/**
 * The running machine: motor hum (pitch follows the drum's spin), water slosh pulsing at
 * the drum's rate, a fill gush at the start, and bubbles. drain()/rinse() reshape it;
 * stop() fades everything and releases every node.
 */
class Wash {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly motor: OscillatorNode[] = [];
  private readonly whine: OscillatorNode;
  private readonly motorGain: GainNode;
  private readonly sloshGain: GainNode;
  private readonly lfo: OscillatorNode;
  private bubbleRate = 7; // per second
  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly out: GainNode,
    pink: AudioBuffer,
    private readonly white: AudioBuffer,
    t: number,
  ) {
    // Motor: two slightly detuned saws, low-passed into a hum; spins up over ~2 s.
    const motorFilter = this.node(ctx.createBiquadFilter());
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 260;
    motorFilter.Q.value = 1.4;
    this.motorGain = this.node(ctx.createGain());
    this.motorGain.gain.setValueAtTime(0, t);
    this.motorGain.gain.setTargetAtTime(0.075, t, 0.25);
    motorFilter.connect(this.motorGain).connect(out);
    for (const detune of [1, 1.006]) {
      const osc = this.source(ctx.createOscillator());
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(34 * detune, t);
      osc.frequency.setTargetAtTime(68 * detune, t + 0.3, 0.6);
      osc.connect(motorFilter);
      this.motor.push(osc);
    }
    // A faint high whine that rises with the motor.
    this.whine = this.source(ctx.createOscillator());
    this.whine.type = "sine";
    this.whine.frequency.setValueAtTime(34 * 7, t);
    this.whine.frequency.setTargetAtTime(68 * 7, t + 0.3, 0.6);
    const whineGain = this.node(ctx.createGain());
    whineGain.gain.value = 0.006;
    this.whine.connect(whineGain).connect(out);

    // Water slosh: looping pink noise, band-passed, its level pulsing with the drum.
    const water = this.source(ctx.createBufferSource());
    water.buffer = pink;
    water.loop = true;
    const waterFilter = this.node(ctx.createBiquadFilter());
    waterFilter.type = "bandpass";
    waterFilter.frequency.value = 650;
    waterFilter.Q.value = 0.7;
    this.sloshGain = this.node(ctx.createGain());
    this.sloshGain.gain.setValueAtTime(0, t);
    this.sloshGain.gain.setTargetAtTime(0.06, t + 0.2, 0.4);
    water.connect(waterFilter).connect(this.sloshGain).connect(out);
    this.lfo = this.source(ctx.createOscillator());
    this.lfo.frequency.setValueAtTime(1.1, t);
    this.lfo.frequency.setTargetAtTime(2.3, t + 0.3, 0.6);
    const depth = this.node(ctx.createGain());
    depth.gain.value = 0.04;
    this.lfo.connect(depth).connect(this.sloshGain.gain);

    // Fill: a gush of water that opens up and settles.
    const fill = this.source(ctx.createBufferSource());
    fill.buffer = pink;
    const fillFilter = this.node(ctx.createBiquadFilter());
    fillFilter.type = "lowpass";
    fillFilter.frequency.setValueAtTime(500, t);
    fillFilter.frequency.exponentialRampToValueAtTime(2400, t + 0.9);
    const fillGain = this.node(ctx.createGain());
    envelope(fillGain.gain, t, 0.15, 0.08, 1.3);
    fill.connect(fillFilter).connect(fillGain).connect(out);

    // Start everything together; stop() may only be scheduled after start().
    this.sources.forEach((s) => s.start(t));
    fill.stop(t + 1.5);

    // Bubbles, scattered in time and across the stereo field.
    this.timer = setInterval(() => {
      if (Math.random() < this.bubbleRate * 0.08) this.bubble();
    }, 80);
  }

  /** Clean result: the motor winds down and the water drains with a gurgle. */
  drain(t: number) {
    if (this.stopped) return;
    for (const osc of this.motor) osc.frequency.setTargetAtTime(30, t, 0.4);
    this.whine.frequency.setTargetAtTime(30 * 7, t, 0.4);
    this.motorGain.gain.setTargetAtTime(0.035, t, 0.4);
    this.sloshGain.gain.setTargetAtTime(0.015, t + 0.2, 0.35);
    this.lfo.frequency.setTargetAtTime(0.8, t, 0.4);
    // Gurgle: resonant noise whose centre wobbles like water swirling down a drain.
    const ctx = this.ctx;
    const src = this.source(ctx.createBufferSource());
    src.buffer = this.white;
    src.loop = true;
    const filter = this.node(ctx.createBiquadFilter());
    filter.type = "bandpass";
    filter.frequency.value = 320;
    filter.Q.value = 7;
    const wobble = this.source(ctx.createOscillator());
    wobble.frequency.value = 6.5;
    const wobbleDepth = this.node(ctx.createGain());
    wobbleDepth.gain.value = 140;
    wobble.connect(wobbleDepth).connect(filter.frequency);
    const gain = this.node(ctx.createGain());
    envelope(gain.gain, t, 0.16, 0.15, 1.1);
    src.connect(filter).connect(gain).connect(this.out);
    src.start(t);
    wobble.start(t);
    // A last rush of bubbles, then quiet.
    this.bubbleRate = 14;
    setTimeout(() => (this.bubbleRate = 2), 500);
  }

  /** Nothing to remove: the water simply settles. */
  rinse(t: number) {
    if (this.stopped) return;
    this.sloshGain.gain.setTargetAtTime(0.02, t, 0.4);
    this.motorGain.gain.setTargetAtTime(0.04, t, 0.4);
    this.bubbleRate = 3;
  }

  /** Fade out over `fade` seconds and release everything. */
  stop(t: number, fade: number) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    for (const osc of this.motor) osc.frequency.setTargetAtTime(18, t, fade);
    this.motorGain.gain.setTargetAtTime(0, t, fade / 3);
    this.sloshGain.gain.cancelScheduledValues(t);
    this.sloshGain.gain.setTargetAtTime(0, t, fade / 3);
    const end = t + fade * 2 + 0.1;
    for (const s of this.sources) {
      try {
        s.stop(end);
      } catch {
        // Already stopped (the one-shot fill).
      }
    }
    setTimeout(() => this.nodes.forEach((n) => n.disconnect()), (end - this.ctx.currentTime) * 1000 + 100);
  }

  private bubble() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const from = rand(380, 700);
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(from * rand(1.8, 2.6), t + rand(0.03, 0.06));
    const gain = ctx.createGain();
    envelope(gain.gain, t, rand(0.012, 0.035), 0.004, rand(0.04, 0.08));
    const pan = panner(ctx, rand(-0.6, 0.6));
    osc.connect(gain).connect(pan).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.12);
    osc.onended = () => [osc, gain, pan].forEach((n) => n.disconnect());
  }

  private node<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  private source<T extends AudioScheduledSourceNode>(n: T): T {
    this.sources.push(n);
    return this.node(n);
  }
}

export const engine = new SoundEngine();

/** Play a cue (no-op on the server, before the first interaction, or when muted). */
export function playSound(cue: Cue) {
  engine.play(cue);
}
