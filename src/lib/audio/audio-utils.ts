/** Small Web Audio building blocks shared by the effects (sound-engine.ts) and the music (ambience.ts). */

export const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Linear attack to `peak`, then an exponential decay to silence (no clicks either end). */
export function envelope(param: AudioParam, t: number, peak: number, attack: number, decay: number) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export function panner(ctx: AudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner !== "function") return ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

export function chain(nodes: AudioNode[], out: AudioNode) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  nodes[nodes.length - 1].connect(out);
}

/** White or pink (Paul Kellet's filter) noise, generated once per context. */
export function noiseBuffer(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (!pink) {
      data[i] = white * 0.5;
      continue;
    }
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}


/** A generated room impulse response: decaying stereo noise, darker as it fades (a soft laundromat tail). */
export function roomImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const x = i / length;
      // Low-pass that closes over time: bright early reflections, a dark tail.
      const k = 0.65 - 0.5 * x;
      lp = lp * (1 - k) + (Math.random() * 2 - 1) * k;
      data[i] = lp * Math.pow(1 - x, decay) * (i < ctx.sampleRate * 0.008 ? i / (ctx.sampleRate * 0.008) : 1);
    }
  }
  return buffer;
}

/** MIDI note number → frequency (A4 = 69 = 440 Hz). */
export const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);
