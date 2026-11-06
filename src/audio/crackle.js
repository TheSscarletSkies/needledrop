// Synthesised vinyl ambience: surface hiss + random pops, needle-drop thump and lift click.
// Everything is generated with Web Audio — no samples to license.
export class Vinyl {
  ctx = null;
  level = 0.5;

  #ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.level;
    this.master.connect(this.ctx.destination);

    // 6 s loop of crackle.
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(2, sr * 6, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let brown = 0;
      for (let i = 0; i < d.length; i++) {
        brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.995;
        d[i] = brown * 0.5 + (Math.random() * 2 - 1) * 0.004;
      }
      // pops
      const pops = 40 + Math.random() * 30;
      for (let p = 0; p < pops; p++) {
        const at = Math.floor(Math.random() * (d.length - 400));
        const amp = Math.random() ** 3 * 0.6 + 0.03;
        const len = 20 + Math.random() * 180;
        for (let j = 0; j < len; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / (len / 4));
      }
    }
    this.crackleBuf = buf;
    this.surface = this.ctx.createGain();
    this.surface.gain.value = 0;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    this.surface.connect(hp).connect(this.master);
    this.src = this.ctx.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;
    this.src.connect(this.surface);
    this.src.start();
    return true;
  }

  // Must be called from a user gesture once, to unlock audio.
  unlock() { if (this.#ensure() && this.ctx.state === 'suspended') this.ctx.resume(); }

  setLevel(v) { this.level = v; if (this.master) this.master.gain.value = v; }

  surfaceOn(on) {
    if (!this.#ensure()) return;
    const g = this.surface.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(on ? 0.35 : 0, this.ctx.currentTime, on ? 0.15 : 0.05);
  }

  #burst(duration, freq, gain) {
    if (!this.#ensure()) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.crackleBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 4, duration + 0.05);
    // low thump
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(35, t + duration);
    og.gain.setValueAtTime(gain * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  drop() { this.#burst(0.25, 900, 2.2); }
  lift() { this.#burst(0.08, 2500, 0.6); }
}
