// Signal-based countdown timer service with Screen Wake Lock, WebAudio chime, and visibility sync.

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

export interface StartTimerOptions {
  beep?: boolean;
  label?: string;
  chimeHz?: number;
  onFinish?: (elapsedSec: number) => void;
}

const formatStamp = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly destroyRef = inject(DestroyRef);

  readonly running = signal(false);
  readonly label = signal('Timer');
  readonly remainingSec = signal(0);
  readonly progressPct = signal(100);
  readonly formattedTime = computed(() => formatStamp(this.remainingSec()));

  private end = 0;
  private total = 0;
  private startedAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private audio: AudioContext | null = null;
  private beepOn = true;
  private chimeHz = 784;
  private wake: WakeLockSentinel | null = null;
  private finishCb: ((elapsed: number) => void) | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      const onVis = () => {
        if (!document.hidden && this.running()) {
          this.tick();
          this.keepAwake(true);
        }
      };
      document.addEventListener('visibilitychange', onVis);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('visibilitychange', onVis);
        this.stop();
      });
    }
  }

  start(seconds: number, { beep = true, label = 'Timer', chimeHz = 784, onFinish }: StartTimerOptions = {}): void {
    this.beepOn = beep;
    this.chimeHz = chimeHz;
    this.finishCb = onFinish ?? null;
    this.label.set(label);

    if (beep && typeof AudioContext !== 'undefined') {
      try {
        this.audio ??= new AudioContext();
        this.audio.resume();
      } catch {
        this.audio = null;
      }
    }

    this.total = seconds * 1000;
    this.startedAt = Date.now();
    this.end = this.startedAt + this.total;
    this.running.set(true);
    this.tick();

    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), 250);
    this.keepAwake(true);
  }

  adjust(deltaSec: number): void {
    if (!this.running()) return;
    this.end += deltaSec * 1000;
    this.total = Math.max(this.total, this.end - Date.now());
    this.tick();
  }

  stop(): number {
    const elapsed = this.startedAt ? Math.max(0, Math.round((Date.now() - this.startedAt) / 1000)) : 0;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.startedAt = 0;
    this.finishCb = null;
    this.running.set(false);
    this.keepAwake(false);
    return elapsed;
  }

  private tick(): void {
    const rem = this.end - Date.now();
    const left = Math.ceil(rem / 1000);
    if (left <= 0) {
      const elapsed = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
      const cb = this.finishCb;
      this.stop();
      if (rem > -3000) {
        this.playChime();
        try { navigator?.vibrate?.([180, 90, 180]); } catch { }
      }
      cb?.(elapsed);
      return;
    }
    this.remainingSec.set(left);
    this.progressPct.set(this.total > 0 ? Math.max(0, Math.min(100, (rem / this.total) * 100)) : 0);
  }

  private playChime(): void {
    if (!this.beepOn || !this.audio) return;
    for (const at of [0, 0.25]) {
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.frequency.value = this.chimeHz;
      gain.gain.value = 0.14;
      osc.connect(gain).connect(this.audio.destination);
      osc.start(this.audio.currentTime + at);
      osc.stop(this.audio.currentTime + at + 0.16);
    }
  }

  private async keepAwake(on: boolean): Promise<void> {
    try {
      if (on && !this.wake && navigator?.wakeLock) {
        this.wake = await navigator.wakeLock.request('screen');
        this.wake.addEventListener?.('release', () => { this.wake = null; });
      }
      if (!on && this.wake) {
        await this.wake.release();
        this.wake = null;
      }
    } catch {
      this.wake = null;
    }
  }
}
