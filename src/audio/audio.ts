/**
 * Synthesized audio: every sound effect and every song is generated at runtime
 * with the Web Audio API. Melodies are produced procedurally from a seed and a
 * set of music-theory constraints, so nothing resembles an existing tune.
 *
 * If Web Audio is unavailable (or blocked until a user gesture), all calls are
 * safe no-ops and the music clock falls back to simulation time, so rhythm
 * gameplay still works silently.
 */
import { Rng } from '../core/rng.ts';

export type SfxName =
  | 'jump' | 'land' | 'hit' | 'hurt' | 'coin' | 'floppy' | 'shoot' | 'explode' | 'select' | 'confirm' | 'back'
  | 'boost' | 'powerup' | 'warn' | 'chaos' | 'levelup' | 'block' | 'perfect' | 'miss' | 'bark' | 'door' | 'heartbeat' | 'transition' | 'unlock' | 'step'
  | 'kick' | 'cheer' | 'whistle' | 'graze' | 'bomb' | 'perk' | 'card' | 'slam';

export type TrackId = 'title' | 'hub' | 'rampage' | 'shmup' | 'neon' | 'neon_night' | 'mall' | 'beatdown' | 'beatdown_bh' | 'rhythm' | 'penalty' | 'blocks' | 'bolt' | 'bolt_boss' | 'hs1' | 'hs2' | 'hs3' | 'command' | 'arcade' | 'halloween' | 'winter' | 'ending' | 'none';

interface TrackDef {
  bpm: number;
  root: number; // MIDI note
  scale: number[];
  lead: OscillatorType;
  bass: OscillatorType;
  drums: 'none' | 'four' | 'rock' | 'break' | 'sparse';
  density: number; // 0..1 how busy the lead is
  seed: number;
  pad?: boolean;
  swing?: number;
}

const MAJ = [0, 2, 4, 5, 7, 9, 11];
const MIN = [0, 2, 3, 5, 7, 8, 10];
const DOR = [0, 2, 3, 5, 7, 9, 10];
const PHR = [0, 1, 3, 5, 7, 8, 10];
const PENT = [0, 3, 5, 7, 10];

export const TRACKS: Record<Exclude<TrackId, 'none'>, TrackDef> = {
  title: { bpm: 118, root: 57, scale: DOR, lead: 'square', bass: 'triangle', drums: 'rock', density: 0.6, seed: 11 },
  hub: { bpm: 96, root: 60, scale: MAJ, lead: 'triangle', bass: 'triangle', drums: 'sparse', density: 0.45, seed: 23, pad: true },
  rampage: { bpm: 132, root: 62, scale: MAJ, lead: 'square', bass: 'square', drums: 'rock', density: 0.7, seed: 37 },
  shmup: { bpm: 156, root: 64, scale: MIN, lead: 'sawtooth', bass: 'square', drums: 'break', density: 0.8, seed: 41 },
  neon: { bpm: 148, root: 59, scale: DOR, lead: 'sawtooth', bass: 'sawtooth', drums: 'four', density: 0.65, seed: 53 },
  neon_night: { bpm: 148, root: 58, scale: PHR, lead: 'square', bass: 'sawtooth', drums: 'break', density: 0.4, seed: 59 },
  mall: { bpm: 68, root: 45, scale: PHR, lead: 'sine', bass: 'triangle', drums: 'none', density: 0.18, seed: 67, pad: true },
  beatdown: { bpm: 140, root: 55, scale: MIN, lead: 'square', bass: 'sawtooth', drums: 'rock', density: 0.75, seed: 71 },
  beatdown_bh: { bpm: 164, root: 56, scale: PHR, lead: 'sawtooth', bass: 'square', drums: 'break', density: 0.85, seed: 73 },
  rhythm: { bpm: 120, root: 57, scale: PENT, lead: 'square', bass: 'sawtooth', drums: 'four', density: 0.7, seed: 89 },
  penalty: { bpm: 138, root: 60, scale: MAJ, lead: 'square', bass: 'triangle', drums: 'rock', density: 0.6, seed: 103 },
  blocks: { bpm: 132, root: 62, scale: PENT, lead: 'square', bass: 'triangle', drums: 'four', density: 0.66, seed: 151 },
  bolt: { bpm: 144, root: 59, scale: MAJ, lead: 'square', bass: 'sawtooth', drums: 'rock', density: 0.78, seed: 157 },
  bolt_boss: { bpm: 156, root: 57, scale: MIN, lead: 'square', bass: 'sawtooth', drums: 'break', density: 0.82, seed: 163 },
  hs1: { bpm: 152, root: 57, scale: MIN, lead: 'square', bass: 'sawtooth', drums: 'four', density: 0.72, seed: 111 },
  hs2: { bpm: 126, root: 55, scale: PHR, lead: 'sawtooth', bass: 'square', drums: 'break', density: 0.6, seed: 113 },
  hs3: { bpm: 172, root: 59, scale: DOR, lead: 'square', bass: 'sawtooth', drums: 'break', density: 0.88, seed: 127 },
  command: { bpm: 112, root: 52, scale: DOR, lead: 'triangle', bass: 'sawtooth', drums: 'rock', density: 0.5, seed: 131, pad: true },
  arcade: { bpm: 124, root: 62, scale: PENT, lead: 'square', bass: 'triangle', drums: 'four', density: 0.62, seed: 137 },
  halloween: { bpm: 84, root: 50, scale: PHR, lead: 'sine', bass: 'triangle', drums: 'sparse', density: 0.3, seed: 139, pad: true },
  winter: { bpm: 90, root: 67, scale: MAJ, lead: 'triangle', bass: 'sine', drums: 'sparse', density: 0.4, seed: 149, pad: true },
  ending: { bpm: 84, root: 60, scale: MAJ, lead: 'triangle', bass: 'sine', drums: 'sparse', density: 0.5, seed: 97, pad: true },
};

interface Song {
  lead: (number | null)[]; // 64 steps (4 bars of 16ths), semitone offsets or null
  bass: (number | null)[];
  chords: number[]; // per bar, scale-degree index
}

/** Pure function: builds a 4-bar loop from a track definition. Exported for tests. */
export function composeSong(def: TrackDef): Song {
  const rng = new Rng(def.seed * 7919);
  const progs = [[0, 5, 3, 4], [0, 3, 4, 3], [0, 6, 5, 4], [0, 2, 5, 4], [5, 3, 0, 4]];
  const chords = rng.pick(progs);
  const deg = (d: number) => {
    const n = def.scale.length;
    const oct = Math.floor(d / n);
    return def.scale[((d % n) + n) % n] + 12 * oct;
  };
  // Lead: a motif of 16 steps, varied per bar (call & response).
  const motif: (number | null)[] = [];
  let pos = rng.int(2, 5);
  for (let i = 0; i < 16; i++) {
    const strong = i % 4 === 0;
    if (rng.chance(strong ? Math.min(1, def.density + 0.25) : def.density * 0.6)) {
      pos += rng.pick([-2, -1, -1, 0, 1, 1, 2, 3, -3]);
      pos = Math.max(0, Math.min(def.scale.length * 2, pos));
      motif.push(pos);
    } else motif.push(null);
  }
  const lead: (number | null)[] = [];
  for (let bar = 0; bar < 4; bar++) {
    const shift = chords[bar];
    for (let i = 0; i < 16; i++) {
      let d = motif[i];
      if (d !== null && bar === 3 && i >= 12) d = null; // breathe at the end of the phrase
      if (d !== null && bar % 2 === 1 && i >= 8) d = d + (rng.chance(0.5) ? 1 : -1);
      lead.push(d === null ? null : 12 + deg(d + Math.floor(shift / 2)));
    }
  }
  const bass: (number | null)[] = [];
  for (let bar = 0; bar < 4; bar++) {
    const r = deg(chords[bar]);
    for (let i = 0; i < 16; i++) {
      if (def.drums === 'none') bass.push(i === 0 ? r - 12 : null);
      else if (def.bpm > 140) bass.push(i % 2 === 0 ? (i % 8 === 6 ? r - 12 + 7 : r - 12) : null);
      else bass.push(i % 4 === 0 ? r - 12 : i % 4 === 3 && rng.chance(0.4) ? r - 12 + 7 : null);
    }
  }
  return { lead, bass, chords };
}

const SFX: Record<SfxName, { type: OscillatorType | 'noise'; f0: number; f1: number; dur: number; vol: number; extra?: Array<[number, number]> }> = {
  jump: { type: 'square', f0: 280, f1: 620, dur: 0.12, vol: 0.25 },
  land: { type: 'noise', f0: 600, f1: 200, dur: 0.06, vol: 0.2 },
  hit: { type: 'square', f0: 220, f1: 80, dur: 0.1, vol: 0.35 },
  hurt: { type: 'sawtooth', f0: 400, f1: 60, dur: 0.3, vol: 0.35 },
  coin: { type: 'square', f0: 990, f1: 990, dur: 0.06, vol: 0.2, extra: [[1320, 0.06]] },
  floppy: { type: 'triangle', f0: 523, f1: 523, dur: 0.1, vol: 0.35, extra: [[659, 0.08], [784, 0.08], [1046, 0.2]] },
  shoot: { type: 'square', f0: 900, f1: 300, dur: 0.08, vol: 0.18 },
  explode: { type: 'noise', f0: 1200, f1: 60, dur: 0.5, vol: 0.45 },
  select: { type: 'square', f0: 660, f1: 660, dur: 0.04, vol: 0.15 },
  confirm: { type: 'square', f0: 523, f1: 523, dur: 0.06, vol: 0.2, extra: [[784, 0.1]] },
  back: { type: 'square', f0: 392, f1: 262, dur: 0.1, vol: 0.18 },
  boost: { type: 'sawtooth', f0: 120, f1: 900, dur: 0.4, vol: 0.25 },
  powerup: { type: 'square', f0: 392, f1: 392, dur: 0.07, vol: 0.25, extra: [[523, 0.07], [659, 0.07], [784, 0.07], [1046, 0.15]] },
  warn: { type: 'square', f0: 880, f1: 880, dur: 0.08, vol: 0.2, extra: [[0, 0.06], [880, 0.08]] },
  chaos: { type: 'sawtooth', f0: 60, f1: 1400, dur: 0.6, vol: 0.25 },
  levelup: { type: 'triangle', f0: 523, f1: 523, dur: 0.08, vol: 0.35, extra: [[659, 0.08], [784, 0.08], [1046, 0.08], [1318, 0.25]] },
  block: { type: 'square', f0: 150, f1: 150, dur: 0.05, vol: 0.25 },
  perfect: { type: 'triangle', f0: 1046, f1: 1046, dur: 0.05, vol: 0.2 },
  miss: { type: 'sawtooth', f0: 140, f1: 90, dur: 0.12, vol: 0.18 },
  bark: { type: 'square', f0: 520, f1: 300, dur: 0.07, vol: 0.3, extra: [[480, 0.09]] },
  door: { type: 'noise', f0: 300, f1: 900, dur: 0.25, vol: 0.2 },
  heartbeat: { type: 'sine', f0: 70, f1: 40, dur: 0.12, vol: 0.5, extra: [[0, 0.08], [65, 0.12]] },
  transition: { type: 'sawtooth', f0: 1600, f1: 40, dur: 0.7, vol: 0.25 },
  unlock: { type: 'square', f0: 784, f1: 784, dur: 0.08, vol: 0.25, extra: [[988, 0.08], [1175, 0.2]] },
  step: { type: 'noise', f0: 400, f1: 300, dur: 0.03, vol: 0.06 },
  kick: { type: 'noise', f0: 520, f1: 140, dur: 0.09, vol: 0.4, extra: [[110, 0.05]] },
  cheer: { type: 'noise', f0: 700, f1: 1700, dur: 0.55, vol: 0.2, extra: [[1500, 0.25]] },
  whistle: { type: 'sine', f0: 2300, f1: 2300, dur: 0.1, vol: 0.22, extra: [[0, 0.04], [2700, 0.16]] },
  graze: { type: 'sine', f0: 1500, f1: 2300, dur: 0.035, vol: 0.09 },
  bomb: { type: 'noise', f0: 380, f1: 40, dur: 0.7, vol: 0.5, extra: [[70, 0.25]] },
  perk: { type: 'triangle', f0: 587, f1: 587, dur: 0.07, vol: 0.3, extra: [[740, 0.07], [880, 0.07], [1175, 0.18]] },
  card: { type: 'square', f0: 523, f1: 523, dur: 0.05, vol: 0.18, extra: [[784, 0.05], [1046, 0.12]] },
  slam: { type: 'sawtooth', f0: 110, f1: 38, dur: 0.32, vol: 0.45, extra: [[60, 0.12]] },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: TrackId = 'none';
  private song: Song | null = null;
  private def: TrackDef | null = null;
  private trackStart = 0;
  private nextStep = 0;
  /** Audio-clock time at which the song was frozen for a pause, if it is. */
  private heldAt: number | null = null;
  private stepIndex = 0;
  private tempoScale = 1;
  private simClock = 0;
  private lastCues = new Map<string, number>();
  enabled = true;
  volumes = { master: 0.8, music: 0.6, sfx: 0.8, muted: false, musicOn: true };
  /** Chaos warnings and big moments briefly pull the music down so the cue is heard. */
  private ducked = false;
  duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    this.applyVolumes();
  }

  /** Detune applied to the current song in semitones (used by chaos/boss variations). */
  transpose = 0;

  /** Must be called from a user gesture to satisfy autoplay policies. */
  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
          ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) { this.enabled = false; return; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 20000;
        this.musicBus = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.musicBus.connect(this.filter);
        this.filter.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
        if (this.track !== 'none') this.restartTrack();
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
    } catch {
      this.enabled = false;
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolumes(v: { master: number; music: number; sfx: number; muted: boolean; musicOn: boolean }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }
  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.muted ? 0 : this.volumes.master, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.volumes.musicOn ? this.volumes.music * 0.35 * (this.ducked ? 0.45 : 1) : 0, t, this.ducked ? 0.08 : 0.25);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx * 0.6, t, 0.02);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  /**
   * Freeze or thaw the song clock for pausing. The audio hardware clock keeps
   * running, so thawing shifts the song's origin by the time spent paused;
   * otherwise rhythm notes would all "pass" during a pause.
   */
  hold(on: boolean): void {
    if (!this.ctx) return;
    if (on && this.heldAt === null) this.heldAt = this.ctx.currentTime;
    else if (!on && this.heldAt !== null) {
      const d = this.ctx.currentTime - this.heldAt;
      this.trackStart += d;
      this.nextStep += d;
      this.heldAt = null;
    }
  }

  /** Muffle the music (pause menus, horror, underwater-ish moments). */
  muffle(on: boolean): void {
    if (!this.ctx || !this.filter) return;
    this.filter.frequency.setTargetAtTime(on ? 700 : 20000, this.ctx.currentTime, 0.15);
  }

  sfx(name: SfxName, pitch = 1): void {
    if (!this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    // Rate-limit identical cues so swarms of events stay pleasant.
    const now = this.ctx.currentTime;
    const last = this.lastCues.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastCues.set(name, now);
    const s = SFX[name];
    let t = now;
    this.blip(s.type, s.f0 * pitch, s.f1 * pitch, t, s.dur, s.vol, this.sfxBus);
    t += s.dur;
    for (const [f, d] of s.extra ?? []) {
      if (f > 0) this.blip(s.type, f * pitch, f * pitch, t, d, s.vol, this.sfxBus);
      t += d;
    }
  }

  private blip(type: OscillatorType | 'noise', f0: number, f1: number, t: number, dur: number, vol: number, bus: AudioNode): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(bus);
    if (type === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      src.connect(bp);
      bp.connect(g);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    } else {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, f0), t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  // ---- Music ------------------------------------------------------------

  /** Start a song. `force` restarts it even if it is already playing (needed for beat-synced modes). */
  play(track: TrackId, tempoScale = 1, force = false): void {
    if (!force && track === this.track && Math.abs(tempoScale - this.tempoScale) < 1e-6) return;
    this.track = track;
    this.tempoScale = tempoScale;
    this.restartTrack();
  }

  /** Swap songs with an audible "genre shift" cue (tape-stop sweep). */
  shiftTo(track: TrackId, tempoScale = 1): void {
    this.sfx('transition');
    this.play(track, tempoScale);
  }

  private restartTrack(): void {
    this.simClock = 0;
    this.heldAt = null;
    if (this.track === 'none') {
      this.song = null;
      this.def = null;
      return;
    }
    this.def = TRACKS[this.track];
    this.song = composeSong(this.def);
    this.heldAt = null;
    if (this.ctx) {
      this.trackStart = this.ctx.currentTime + 0.05;
      this.nextStep = this.trackStart;
      this.stepIndex = 0;
    }
  }

  get bpm(): number {
    return (this.def?.bpm ?? 120) * this.tempoScale;
  }

  /**
   * Seconds since the current song started. Uses the audio hardware clock when
   * sound is running (sample-accurate for rhythm gameplay), else simulation time.
   */
  musicTime(): number {
    if (this.ctx && this.ctx.state === 'running' && this.track !== 'none') return Math.max(0, (this.heldAt ?? this.ctx.currentTime) - this.trackStart);
    return this.simClock;
  }

  /** Call every simulation step. Schedules upcoming notes (lookahead scheduler). */
  update(dt: number): void {
    if (!(this.ctx && this.ctx.state === 'running')) {
      this.simClock += dt;
      return;
    }
    if (this.track === 'none') {
      this.simClock += dt;
      return;
    }
    this.simClock = this.musicTime();
    if (!this.song || !this.def || !this.musicBus) return;
    const stepDur = 60 / this.bpm / 4;
    const horizon = this.ctx.currentTime + 0.12;
    // If we fell far behind (tab was suspended), skip ahead instead of bursting notes.
    if (this.nextStep < this.ctx.currentTime - 0.25) {
      const skip = Math.ceil((this.ctx.currentTime - this.nextStep) / stepDur);
      this.nextStep += skip * stepDur;
      this.stepIndex += skip;
    }
    while (this.nextStep < horizon) {
      this.scheduleStep(this.stepIndex, this.nextStep, stepDur);
      this.nextStep += stepDur;
      this.stepIndex++;
    }
  }

  private scheduleStep(i: number, t: number, stepDur: number): void {
    const s = this.song!;
    const d = this.def!;
    const bus = this.musicBus!;
    const k = i % 64;
    const root = d.root + this.transpose;
    const swing = d.swing && k % 2 === 1 ? stepDur * d.swing : 0;
    const lead = s.lead[k];
    if (lead !== null) this.blip(d.lead, midi(root + lead), midi(root + lead), t + swing, stepDur * 1.6, 0.16, bus);
    const bass = s.bass[k];
    if (bass !== null) this.blip(d.bass, midi(root + bass), midi(root + bass), t, stepDur * (d.drums === 'none' ? 14 : 1.8), 0.22, bus);
    if (d.pad && k % 16 === 0) {
      const chordRoot = d.scale[s.chords[Math.floor(k / 16)] % d.scale.length];
      for (const iv of [0, 4, 7]) this.blip('triangle', midi(root + chordRoot + iv), midi(root + chordRoot + iv), t, stepDur * 15, 0.05, bus);
    }
    const st = k % 16;
    switch (d.drums) {
      case 'four':
        if (st % 4 === 0) this.kick(t);
        if (st % 4 === 2) this.hat(t, 0.07);
        if (st === 4 || st === 12) this.snare(t);
        break;
      case 'rock':
        if (st === 0 || st === 8 || st === 10) this.kick(t);
        if (st === 4 || st === 12) this.snare(t);
        if (st % 2 === 0) this.hat(t, 0.05);
        break;
      case 'break':
        if (st === 0 || st === 6 || st === 10) this.kick(t);
        if (st === 4 || st === 12 || st === 15) this.snare(t);
        this.hat(t, st % 2 ? 0.03 : 0.06);
        break;
      case 'sparse':
        if (st === 0) this.kick(t);
        if (st === 8) this.hat(t, 0.06);
        break;
      case 'none':
        if (k === 0 || k === 40) this.blip('sine', midi(root - 24 + 1), midi(root - 24), t, stepDur * 8, 0.12, bus);
        break;
    }
  }
  private kick(t: number): void {
    this.blip('sine', 150, 40, t, 0.12, 0.5, this.musicBus!);
  }
  private snare(t: number): void {
    this.blip('noise', 2500, 1200, t, 0.1, 0.25, this.musicBus!);
  }
  private hat(t: number, v: number): void {
    this.blip('noise', 9000, 8000, t, 0.03, v, this.musicBus!);
  }
}
