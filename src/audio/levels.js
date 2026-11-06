// Listens to what Needledrop is playing, so the speakers can move with it.
// Desktop app: captures the window's own audio (YouTube + local files; on Windows, all system audio)
// via getDisplayMedia, which the main process answers without sharing any screen.
// Browser: taps the local-file <audio> element directly. Spotify/Apple Music on macOS play in their
// own apps, which we can't hear, so the speakers stay still for them rather than faking it.
export class Levels {
  bass = 0;
  mid = 0;
  live = false;
  #analyser = null;
  #bins = null;
  #started = false;

  async startFromWindow() {
    if (this.#started) return;
    this.#started = true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      const audio = stream.getAudioTracks();
      if (!audio.length) return;
      const ctx = new AudioContext();
      this.#connect(ctx, ctx.createMediaStreamSource(new MediaStream(audio)));
    } catch (e) {
      console.warn('Speakers can’t hear playback:', e.message);
    }
  }

  // Browser fallback for local files. Routing an element through Web Audio means we also have to
  // send it on to the speakers ourselves.
  startFromElement(el) {
    if (this.#started) return;
    this.#started = true;
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el);
    src.connect(ctx.destination);
    this.#connect(ctx, src);
  }

  #connect(ctx, src) {
    this.#analyser = ctx.createAnalyser();
    this.#analyser.fftSize = 2048;
    this.#analyser.smoothingTimeConstant = 0.5;
    this.#bins = new Uint8Array(this.#analyser.frequencyBinCount);
    src.connect(this.#analyser);
    this.hz = ctx.sampleRate / this.#analyser.fftSize;
    this.live = true;
  }

  // Bass (≈40–160 Hz) drives the woofers, mids (≈1–4 kHz) the tweeters. Fast attack, slow release,
  // like a real cone that's pushed and springs back.
  update(dt) {
    if (!this.#analyser) return;
    this.#analyser.getByteFrequencyData(this.#bins);
    const band = (lo, hi) => {
      let sum = 0, n = 0;
      for (let i = Math.floor(lo / this.hz); i <= Math.ceil(hi / this.hz); i++) { sum += this.#bins[i]; n++; }
      return n ? sum / n / 255 : 0;
    };
    const b = Math.max(0, band(40, 160) - 0.25) / 0.75;
    const m = Math.max(0, band(1000, 4000) - 0.2) / 0.8;
    const follow = (cur, next) => cur + (next - cur) * (1 - Math.exp(-(next > cur ? 30 : 7) * dt));
    this.bass = follow(this.bass, b);
    this.mid = follow(this.mid, m);
  }
}
