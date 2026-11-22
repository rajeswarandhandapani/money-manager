// Everything is kept in this browser's IndexedDB. Backups are encrypted before leaving it.

import { Injectable } from '@angular/core';
import { createDb, requestPersist } from '../kit/idb';
import type { LockRecord, TransactionRow } from '../domain/models';

const KV_KEYS = ['rules', 'categories', 'profiles', 'batches', 'deleted', 'budgets', 'taxonomy'] as const;
const ITERATIONS = 600000;

const b64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));

const unb64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function keyFrom(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export interface BackupPayload {
  tx?: TransactionRow[];
  rules?: unknown;
  categories?: unknown;
  profiles?: unknown;
  batches?: unknown;
  deleted?: unknown;
  budgets?: unknown;
  taxonomy?: unknown;
}

@Injectable({ providedIn: 'root' })
export class MoneyStoreService {
  // Internal id kept from the app's first name so existing data and backups still open.
  private readonly db = createDb({
    name: 'monthly-expense',
    version: 1,
    stores: [{ name: 'tx', keyPath: 'id' }, { name: 'kv' }],
  });

  allTx(): Promise<TransactionRow[]> {
    return this.db.getAll<TransactionRow>('tx');
  }

  putTx(rows: TransactionRow[]): Promise<void> {
    if (rows.length) requestPersist();
    return this.db.putMany('tx', rows);
  }

  deleteTx(ids: string[]): Promise<void> {
    if (!ids.length) return Promise.resolve();
    return this.db.run('tx', 'readwrite', tx => {
      const store = tx.objectStore('tx');
      for (const id of ids) store.delete(id);
    });
  }

  getKv<T>(key: string): Promise<T | undefined> {
    return this.db.getKv<T>(key);
  }

  setKv<T>(key: string, value: T): Promise<void> {
    return this.db.setKv(key, value);
  }

  async exportAll(): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { tx: await this.allTx() };
    for (const k of KV_KEYS) data[k] = await this.getKv(k);
    return data;
  }

  /** Clears every record. This device's lock stays, so erasing or restoring can't remove it. */
  eraseAll(): Promise<void> {
    return this.db.run(['tx', 'kv'], 'readwrite', t => {
      t.objectStore('tx').clear();
      const kv = t.objectStore('kv');
      const lockReq = kv.get('lock') as IDBRequest<LockRecord | undefined>;
      lockReq.onsuccess = () => {
        kv.clear();
        if (lockReq.result) kv.put(lockReq.result, 'lock');
      };
    });
  }

  async replaceAll(data: BackupPayload): Promise<void> {
    await this.eraseAll();
    await this.putTx(data.tx || []);
    const map = data as Record<string, unknown>;
    for (const k of KV_KEYS) {
      if (map[k] !== undefined) await this.setKv(k, map[k]);
    }
  }

  async encryptBackup(data: Record<string, unknown>, passphrase: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(passphrase, salt, ITERATIONS, 'encrypt');
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(JSON.stringify(data)),
    );
    return JSON.stringify({
      app: 'monthly-expense',
      version: 1,
      iterations: ITERATIONS,
      salt: b64(salt),
      iv: b64(iv),
      data: b64(new Uint8Array(cipher)),
    });
  }

  async decryptBackup(text: string, passphrase: string): Promise<BackupPayload> {
    let file: Record<string, unknown>;
    try {
      file = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error('That file is not a Money Manager backup.');
    }
    if (!file || file['app'] !== 'monthly-expense' || !file['data']) {
      throw new Error('That file is not a Money Manager backup.');
    }
    try {
      const salt = unb64(String(file['salt']));
      const iterations = Number(file['iterations']);
      const iv = unb64(String(file['iv']));
      const payload = unb64(String(file['data']));
      const key = await keyFrom(passphrase, salt, iterations, 'decrypt');
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        payload as BufferSource,
      );
      return JSON.parse(new TextDecoder().decode(plain)) as BackupPayload;
    } catch {
      throw new Error('Wrong passphrase, or the backup file is damaged.');
    }
  }
}
