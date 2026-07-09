"use client";
/**
 * Lightweight game-sound synthesizer built on the Web Audio API.
 *
 * No audio files: every sound is generated live from oscillators/noise, so it
 * works offline and adds nothing to the bundle. Browsers block audio until a
 * user gesture, so call `sound.ensure()` from a click/tap handler first.
 *
 * All source nodes route through a master GainNode, so muting instantly
 * silences even sounds that are already scheduled/playing.
 */
const MUTE_KEY = "poker_muted";

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  /** Create/resume the audio context + master gain. Safe to call repeatedly. */
  ensure(): void {
    if (typeof window === "undefined") return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      /* audio unavailable — silently ignore */
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    // Ramp the master gain so in-flight sounds are silenced immediately too.
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(m ? 0 : 1, t + 0.02);
    }
  }

  private out(): AudioNode | null {
    return this.master ?? this.ctx?.destination ?? null;
  }

  private tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.2, offset = 0): void {
    const dest = this.out();
    if (!this.ctx || this.muted || !dest) return;
    const t = this.ctx.currentTime + offset;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, highpass: number, offset = 0): void {
    const dest = this.out();
    if (!this.ctx || this.muted || !dest) return;
    const t = this.ctx.currentTime + offset;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = highpass;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur);
  }

  // --- Named game sounds ---------------------------------------------------
  /** It's your turn: gentle two-tone rising chime. */
  turn(): void {
    this.tone(660, 0.14, "sine", 0.28);
    this.tone(990, 0.18, "sine", 0.24, 0.13);
  }

  /** A new hand begins: a short riffle-shuffle then a soft chord. */
  newHand(): void {
    this.noise(0.28, 0.18, 1200);
    this.tone(392, 0.12, "triangle", 0.16, 0.22);
    this.tone(587, 0.16, "triangle", 0.16, 0.3);
  }

  /** Deal `n` cards: quick card-flick flicks, slightly spaced. */
  dealCards(n: number): void {
    for (let i = 0; i < Math.max(1, n); i++) this.noise(0.05, 0.22, 2600, i * 0.09);
  }

  /** Chips pushed in (bet/raise/call). */
  chips(): void {
    this.noise(0.06, 0.2, 3200);
    this.noise(0.06, 0.16, 2400, 0.05);
  }

  check(): void {
    this.tone(320, 0.09, "sine", 0.18);
  }

  fold(): void {
    this.tone(240, 0.16, "sawtooth", 0.12);
  }

  /** Countdown tick in the final stretch of the think timer. */
  tick(): void {
    this.tone(1040, 0.05, "square", 0.14);
  }

  /** All-in: a dramatic rising sweep + low boom so it stands out from a normal bet. */
  allin(): void {
    // rising tension
    this.tone(300, 0.16, "sawtooth", 0.16);
    this.tone(500, 0.16, "sawtooth", 0.16, 0.12);
    this.tone(760, 0.22, "square", 0.18, 0.24);
    // low boom to punctuate
    this.tone(90, 0.4, "sine", 0.3, 0.28);
  }

  /** You won the hand: a three-note fanfare with a burst of applause. */
  win(): void {
    this.tone(523, 0.12, "sine", 0.22);
    this.tone(659, 0.12, "sine", 0.22, 0.12);
    this.tone(784, 0.24, "sine", 0.24, 0.24);
    this.applause();
  }

  /** Clapping: many short, randomly-spaced filtered-noise claps (~1.3s). */
  private applause(): void {
    const claps = 30;
    for (let i = 0; i < claps; i++) {
      const offset = 0.12 + Math.random() * 1.2;
      const gain = 0.05 + Math.random() * 0.09;
      this.noise(0.03, gain, 2000 + Math.random() * 2800, offset);
    }
  }
}

export const sound = new SoundManager();

// --- Mute preference store (works with useSyncExternalStore, no hydration
// mismatch: the server snapshot is always false). ----------------------------
const listeners = new Set<() => void>();

export function subscribeMuted(cb: () => void): () => void {
  listeners.add(cb);
  // Honour the external-store contract across tabs: when another tab changes
  // the preference, re-notify (and keep the audio engine in sync).
  const onStorage = (e: StorageEvent) => {
    if (e.key === MUTE_KEY) {
      sound.setMuted(e.newValue === "1");
      cb();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function getMutedSnapshot(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function getMutedServerSnapshot(): boolean {
  return false;
}

export function setMutedPref(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  sound.setMuted(m);
  listeners.forEach((l) => l());
}
