// Optional lock for one device, using a passkey (Face ID, fingerprint or the device passcode).

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { hashCode, newRecoveryCode } from '../domain/lock-crypto';
import type { LockRecord } from '../domain/models';
import { MoneyStoreService } from './money-store.service';

export const LOCK_AFTER_MINUTES = 3;
const LOCK_AFTER_MS = LOCK_AFTER_MINUTES * 60 * 1000;
const random = (size: number): Uint8Array => crypto.getRandomValues(new Uint8Array(size));

@Injectable({ providedIn: 'root' })
export class LockService {
  private readonly store = inject(MoneyStoreService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly record = signal<LockRecord | null>(null);
  readonly supported = signal(false);
  readonly locked = signal(false);
  readonly message = signal('');
  readonly busy = signal(false);

  readonly isOn = computed(() => Boolean(this.record()?.credentialId));

  private usedRecovery = false;
  private hiddenAt = 0;
  private finished: (() => void) | null = null;
  private visBound = false;

  async init(): Promise<void> {
    const saved = (await this.store.getKv<LockRecord>('lock')) || null;
    this.record.set(saved);
    const sup = Boolean(
      await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false),
    );
    this.supported.set(sup);

    if (!this.visBound && typeof document !== 'undefined') {
      this.visBound = true;
      const onVis = () => {
        if (document.hidden) {
          this.hiddenAt = Date.now();
          return;
        }
        if (this.isOn() && !this.locked() && this.hiddenAt && Date.now() - this.hiddenAt >= LOCK_AFTER_MS) {
          this.showLock();
        }
      };
      document.addEventListener('visibilitychange', onVis);
      this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVis));
    }
  }

  untilUnlocked(): Promise<void> {
    if (!this.isOn()) return Promise.resolve();
    this.showLock();
    return new Promise(resolve => {
      this.finished = resolve;
    });
  }

  private showLock(): void {
    this.usedRecovery = false;
    this.message.set('');
    this.busy.set(false);
    this.locked.set(true);
    if (typeof document !== 'undefined') document.body.classList.add('locked');
  }

  private openApp(): void {
    this.locked.set(false);
    this.busy.set(false);
    this.message.set('');
    if (typeof document !== 'undefined') document.body.classList.remove('locked');
    this.finished?.();
    this.finished = null;
  }

  generateRecoveryCode(): string {
    return newRecoveryCode();
  }

  async createPasskey(): Promise<ArrayBuffer> {
    const userId = this.record()?.userId || random(16);
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Money Manager' },
        user: { id: userId as BufferSource, name: 'Money Manager', displayName: 'Money Manager' },
        challenge: random(32) as BufferSource,
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error('Passkey creation cancelled');
    const next: LockRecord = { userId };
    this.record.set(next);
    await this.store.setKv('lock', next);
    return cred.rawId;
  }

  async turnOn(credentialId: ArrayBuffer, code: string): Promise<void> {
    const rec = this.record();
    if (!rec) return;
    const salt = random(16);
    const next: LockRecord = {
      userId: rec.userId,
      credentialId,
      salt,
      hash: await hashCode(code, salt),
    };
    this.record.set(next);
    await this.store.setKv('lock', next);
  }

  private async askDevice(): Promise<void> {
    const rec = this.record();
    if (!rec?.credentialId) throw new Error('No credential');
    await navigator.credentials.get({
      publicKey: {
        challenge: random(32) as BufferSource,
        allowCredentials: [{ type: 'public-key', id: rec.credentialId }],
        userVerification: 'required',
      },
    });
  }

  async turnOff(): Promise<void> {
    const rec = this.record();
    if (!rec) return;
    if (!this.usedRecovery) await this.askDevice();
    const next: LockRecord = { userId: rec.userId };
    this.record.set(next);
    await this.store.setKv('lock', next);
  }

  async unlockWithPasskey(): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    try {
      await this.askDevice();
      this.openApp();
    } catch {
      this.message.set('That didn’t work. Tap Unlock to try again.');
      this.busy.set(false);
    }
  }

  async unlockWithRecoveryCode(code: string): Promise<void> {
    const rec = this.record();
    if (!rec?.salt || !rec?.hash) return;
    if ((await hashCode(code, rec.salt)) === rec.hash) {
      this.usedRecovery = true;
      this.openApp();
    } else {
      this.message.set('That code doesn’t match.');
    }
  }
}
