import { midi, panner, rand } from "./audio-utils";
import type { Mood } from "./sound-cues";

/**
 * The background bed: a slow, generative pad in D major with soap-bubble plucks on top.
 * Synthesized live, so it never repeats exactly, costs nothing to download and needs no
 * licence. It sits well under the effects (about -34 dB RMS; effects land 10-15 dB above it) and follows the washer:
 *
 *   idle  → full, warm pad; bubbles drift by every few seconds
 *   wash  → ducks and darkens so the motor and water carry the moment
 *   clean → brightens and blooms, with a little flurry of bubbles
 *   fault → drops low and dark until the user moves on
 *
 * Voices are scheduled ahead on the audio clock (a look-ahead timer), so timing never
 * depends on the main thread being idle.
 */

interface Chord {
  /** Bass note (MIDI). */
  root: number;
  /** Pad voicing (MIDI): close, mid-register, no thirds doubled. */
  pad: number[];
  /** Notes the bubbles may pick (MIDI), all consonant with the pad. */
  bubbles: number[];
}

// I – vi – IV – V in D, with added 9ths/7ths for a soft, airy colour (Dmaj9 Bm9 Gmaj9 A6/9).
const CHORDS: Chord[] = [
  { root: 38, pad: [62, 66, 69, 73, 76], bubbles: [78, 81, 85, 86, 88, 90] },
  { root: 35, pad: [59, 62, 66, 69, 73], bubbles: [78, 81, 83, 85, 86, 90] },
  { root: 43, pad: [59, 62, 66, 69, 74], bubbles: [79, 81, 83, 86, 90, 91] },
  { root: 45, pad: [61, 64, 66, 69, 71], bubbles: [76, 78, 81, 83, 85, 88] },
];

const CHORD_SECONDS = 9;
const ATTACK = 3.2;
const RELEASE = 4.5;
const LOOKAHEAD = 2;
const PAD_PEAK = 0.016;
const BASS_PEAK = 0.05;

interface MoodShape {
  level: number;
  cutoff: number;
  /** Mean seconds between bubbles. */
  bubbleGap: number;
}

const MOODS: Record<Mood, MoodShape> = {
  idle: { level: 1, cutoff: 1300, bubbleGap: 3.2 },
  wash: { level: 0.38, cutoff: 650, bubbleGap: 9 },
  clean: { level: 1.05, cutoff: 2600, bubbleGap: 1.2 },
  fault: { level: 0.3, cutoff: 480, bubbleGap: 30 },
};

export class Ambience {
  private readonly bus: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private readonly bubbleIn: GainNode;
  private readonly fixed: AudioNode[] = [];
  private readonly fixedSources: AudioScheduledSourceNode[] = [];
  private readonly live = new Set<AudioScheduledSourceNode>();
  private readonly timer: ReturnType<typeof setInterval>;
  private chord = 0;
  private nextChord: number;
  private nextBubble: number;
  private mood: Mood = "idle";
  private brightTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    mood: Mood,
  ) {
    const t = ctx.currentTime + 0.05;

    // Bus: fades in slowly so the music arrives rather than starts.
    this.bus = this.keep(ctx.createGain());
    this.bus.gain.setValueAtTime(0.0001, t);
    this.bus.connect(out);

    // Pad filter: one low-pass for every pad voice, drifting slowly so the pad breathes.
    this.padFilter = this.keep(ctx.createBiquadFilter());
    this.padFilter.type = "lowpass";
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.bus);
    const drift = this.keepSource(ctx.createOscillator());
    drift.frequency.value = 0.045;
    const driftDepth = this.keep(ctx.createGain());
    driftDepth.gain.value = 260;
    drift.connect(driftDepth).connect(this.padFilter.detune);
    // (detune is in cents: ±260 c ≈ ±16 % around the mood's cutoff.)

    // Bubbles: dry plus a dotted-eighth echo (at ~64 bpm) that darkens on each repeat.
    this.bubbleIn = this.keep(ctx.createGain());
    this.bubbleIn.connect(this.bus);
    const delay = this.keep(ctx.createDelay(2));
    delay.delayTime.value = 0.7;
    const feedback = this.keep(ctx.createGain());
    feedback.gain.value = 0.38;
    const tone = this.keep(ctx.createBiquadFilter());
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    const wet = this.keep(ctx.createGain());
    wet.gain.value = 0.55;
    this.bubbleIn.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(wet).connect(this.bus);

    this.fixedSources.forEach((s) => s.start(t));
    this.nextChord = t;
    this.nextBubble = t + 2.5;
    this.setMood(mood, true);
    this.timer = setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  setMood(mood: Mood, initial = false) {
    if (this.stopped || (mood === this.mood && !initial)) return;
    this.mood = mood;
    const t = this.ctx.currentTime;
    const shape = MOODS[mood];
    // Arrive gently on first start; otherwise follow the wash within a second or so.
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(Math.max(0.0001, shape.level), t, initial ? 2.2 : mood === "wash" ? 0.5 : 1.2);
    this.padFilter.frequency.cancelScheduledValues(t);
    this.padFilter.frequency.setTargetAtTime(shape.cutoff, t, initial ? 0.1 : 0.8);
    this.nextBubble = Math.min(this.nextBubble, t + shape.bubbleGap);
    if (this.brightTimer) clearTimeout(this.brightTimer);
    this.brightTimer = null;
    if (mood === "clean") {
      // The bloom settles back to the resting colour after a few seconds.
      this.brightTimer = setTimeout(() => {
        if (this.mood !== "clean" || this.stopped) return;
        const now = this.ctx.currentTime;
        this.padFilter.frequency.setTargetAtTime(MOODS.idle.cutoff, now, 2);
        this.bus.gain.setTargetAtTime(MOODS.idle.level, now, 2);
      }, 6000);
    }
  }

  /** Fade out over about `fade` seconds and release every node. */
  stop(fade = 1.2) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    if (this.brightTimer) clearTimeout(this.brightTimer);
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(0.0001, t, fade / 4);
    const end = t + fade + 0.1;
    for (const s of [...this.live, ...this.fixedSources]) {
      try {
        s.stop(end);
      } catch {
        // Already finished.
      }
    }
    setTimeout(() => this.fixed.forEach((n) => n.disconnect()), (fade + 0.4) * 1000);
  }

  /* --------------------------------------------------------------- scheduling --- */

  private schedule() {
    if (this.stopped) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextChord < horizon) {
      this.playChord(CHORDS[this.chord]!, this.nextChord);
      this.chord = (this.chord + 1) % CHORDS.length;
      this.nextChord += CHORD_SECONDS;
    }
    while (this.nextBubble < horizon) {
      this.bubble(this.nextBubble);
      const gap = MOODS[this.mood].bubbleGap;
      this.nextBubble += gap * rand(0.5, 1.5);
    }
  }

  private playChord(chord: Chord, t: number) {
    // Each chord swells in, holds, and fades under the next one (they overlap by RELEASE).
    const end = t + CHORD_SECONDS + RELEASE;
    chord.pad.forEach((note, i) => {
      const pan = (i / (chord.pad.length - 1)) * 0.7 - 0.35;
      for (const cents of [-7, 7]) {
        this.voice({ freq: midi(note), cents, type: "triangle", at: t + i * 0.12, until: end, peak: PAD_PEAK, pan, out: this.padFilter });
      }
    });
    this.voice({ freq: midi(chord.root), cents: 0, type: "sine", at: t, until: end, peak: BASS_PEAK, pan: 0, out: this.bus });
  }

  private voice(o: { freq: number; cents: number; type: OscillatorType; at: number; until: number; peak: number; pan: number; out: AudioNode }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.value = o.freq;
    osc.detune.value = o.cents;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, o.at);
    gain.gain.linearRampToValueAtTime(o.peak, o.at + ATTACK);
    gain.gain.setValueAtTime(o.peak, o.until - RELEASE);
    gain.gain.setTargetAtTime(0, o.until - RELEASE, RELEASE / 4);
    const pan = panner(ctx, o.pan);
    osc.connect(gain).connect(pan).connect(o.out);
    this.track(osc, [osc, gain, pan]);
    osc.start(o.at);
    osc.stop(o.until + 0.2);
  }

  /** A soap bubble: a soft sine "plink" with a glassy overtone, somewhere in the stereo field. */
  private bubble(t: number) {
    const ctx = this.ctx;
    const notes = CHORDS[(this.chord + CHORDS.length - 1) % CHORDS.length]!.bubbles;
    const freq = midi(notes[Math.floor(Math.random() * notes.length)]!);
    const peak = rand(0.012, 0.024);
    const pan = panner(ctx, rand(-0.75, 0.75));
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const over = ctx.createGain();
    over.gain.value = 0.18;
    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.setValueAtTime(freq * 1.004, t);
    a.frequency.exponentialRampToValueAtTime(freq, t + 0.05); // a tiny "bloop" into pitch
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = freq * 3.01;
    a.connect(gain);
    b.connect(over).connect(gain);
    gain.connect(pan).connect(this.bubbleIn);
    this.track(a, [a, gain, pan]);
    this.track(b, [b, over]);
    a.start(t);
    b.start(t);
    a.stop(t + 1.7);
    b.stop(t + 1.7);
  }

  /* ------------------------------------------------------------------ helpers --- */

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]) {
    this.live.add(source);
    source.onended = () => {
      this.live.delete(source);
      nodes.forEach((n) => n.disconnect());
    };
  }
  private keep<T extends AudioNode>(n: T): T {
    this.fixed.push(n);
    return n;
  }
  private keepSource<T extends AudioScheduledSourceNode>(n: T): T {
    this.fixedSources.push(n);
    return this.keep(n);
  }
}
