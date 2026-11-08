// Everything is kept in this browser's IndexedDB. Backups are encrypted before leaving it.

// Internal id, kept from the app's first name so existing data and backups still open.
const DB = 'monthly-expense';
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('tx', { keyPath: 'id' });
        req.result.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    const out = work(t);
    if (out) out.onsuccess = () => { result = out.result; };
  });
}

export const allTx = () => run('tx', 'readonly', t => t.objectStore('tx').getAll());
export const putTx = rows => run('tx', 'readwrite', t => { const s = t.objectStore('tx'); rows.forEach(r => s.put(r)); });
export const deleteTx = ids => run('tx', 'readwrite', t => { const s = t.objectStore('tx'); ids.forEach(id => s.delete(id)); });
export const getKv = key => run('kv', 'readonly', t => t.objectStore('kv').get(key));
export const setKv = (key, value) => run('kv', 'readwrite', t => { t.objectStore('kv').put(value, key); });

const KV_KEYS = ['rules', 'categories', 'profiles', 'batches', 'deleted'];

export async function exportAll() {
  const data = { tx: await allTx() };
  for (const k of KV_KEYS) data[k] = await getKv(k);
  return data;
}

export const eraseAll = () => run(['tx', 'kv'], 'readwrite', t => { t.objectStore('tx').clear(); t.objectStore('kv').clear(); });

export async function replaceAll(data) {
  await eraseAll();
  await putTx(data.tx || []);
  for (const k of KV_KEYS) if (data[k] !== undefined) await setKv(k, data[k]);
}

const ITERATIONS = 600000;
const b64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function keyFrom(passphrase, salt, iterations, usage) {
  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, raw, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function encryptBackup(data, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt, ITERATIONS, 'encrypt');
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return JSON.stringify({ app: 'monthly-expense', version: 1, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(cipher)) });
}

export async function decryptBackup(text, passphrase) {
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('That file is not a Money Manager backup.'); }
  if (file.app !== 'monthly-expense' || !file.data) throw new Error('That file is not a Money Manager backup.');
  try {
    const key = await keyFrom(passphrase, unb64(file.salt), file.iterations, 'decrypt');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Wrong passphrase, or the backup file is damaged.');
  }
}
