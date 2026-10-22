// 에셋 없이 WebAudio로 만드는 섬의 소리: 파도, 빗소리, 바람, 천둥, 새소리, 모닥불
export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ocean!: GainNode;
  private rain!: GainNode;
  private wind!: GainNode;
  private fire!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private nextChirp = 0;
  private nextCrackle = 0;
  private quake: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private state = { rain: 0, wind: 0.2, day: 1, fire: 0, sea: 1 };

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // 브라운 노이즈 성분
      data[i] = white * 0.5 + last * 3;
    }

    const src = (filter: BiquadFilterNode, gain: GainNode) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = 0.8 + Math.random() * 0.4;
      s.connect(filter).connect(gain).connect(this.master);
      s.start();
    };

    // 파도: 저역 통과 노이즈를 천천히 숨 쉬듯
    this.ocean = ctx.createGain();
    this.ocean.gain.value = 0.3;
    const oceanF = ctx.createBiquadFilter();
    oceanF.type = "lowpass";
    oceanF.frequency.value = 420;
    src(oceanF, this.ocean);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.16;
    lfo.connect(lfoGain).connect(this.ocean.gain);
    lfo.start();

    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    const rainF = ctx.createBiquadFilter();
    rainF.type = "bandpass";
    rainF.frequency.value = 2600;
    rainF.Q.value = 0.5;
    src(rainF, this.rain);

    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    const windF = ctx.createBiquadFilter();
    windF.type = "bandpass";
    windF.frequency.value = 380;
    windF.Q.value = 1.4;
    src(windF, this.wind);

    this.fire = ctx.createGain();
    this.fire.gain.value = 0;
    this.fire.connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.2);
  }

  /** 매 프레임 근처 */
  update(s: { rain: number; wind: number; day: number; fire: number; sea: number }) {
    this.state = s;
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    this.ocean.gain.setTargetAtTime(0.18 + 0.22 * s.sea, t, 0.5);
    this.rain.gain.setTargetAtTime(s.rain * 0.45, t, 0.8);
    this.wind.gain.setTargetAtTime(Math.max(0, s.wind - 0.3) * 0.5, t, 1);
    if (s.day > 0.5 && s.rain < 0.2 && t > this.nextChirp) {
      this.nextChirp = t + 2 + Math.random() * 7;
      this.chirp();
    }
    if (s.fire > 0.05 && t > this.nextCrackle) {
      this.nextCrackle = t + 0.05 + Math.random() * 0.35;
      this.crackle(s.fire);
    }
  }

  private chirp() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = 1 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      const t0 = t + i * 0.16;
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t0 + 0.08);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.025, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.15);
    }
  }

  private crackle(level: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1500 + Math.random() * 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12 * level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.04);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 2, 0.1);
  }

  /** 지진의 낮은 울림 (매 프레임 세기를 넘긴다) */
  rumble(level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.quake) {
      if (level < 0.02) return;
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 70;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.master);
      s.start();
      this.quake = { src: s, gain: g };
    }
    this.quake.gain.gain.setTargetAtTime(this.muted ? 0 : level * 1.4, ctx.currentTime, 0.15);
    if (level < 0.005 && this.quake.gain.gain.value < 0.01) {
      this.quake.src.stop();
      this.quake = null;
    }
  }

  thunder(distance: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + Math.min(3, distance / 40);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 160;
    const g = ctx.createGain();
    const vol = Math.max(0.2, 1 - distance / 120);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * vol, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random(), 3);
  }

  pop(freq = 600, vol = 0.08) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  chime() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    [880, 1108, 1318].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t0 = t + i * 0.09;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + 1.3);
    });
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
