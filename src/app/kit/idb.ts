// Typed lightweight IndexedDB wrapper factory. All data stays local to this browser.

export interface StoreDef {
  name: string;
  keyPath?: string;
}

export interface DbConfig {
  name: string;
  version?: number;
  stores?: StoreDef[];
}

export interface KitDb {
  open: () => Promise<IDBDatabase>;
  run: <T = void>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => IDBRequest<T> | void,
  ) => Promise<T>;
  getAll: <T>(store: string) => Promise<T[]>;
  get: <T>(store: string, key: IDBValidKey) => Promise<T | undefined>;
  put: <T>(store: string, value: T) => Promise<void>;
  putMany: <T>(store: string, list: T[]) => Promise<void>;
  del: (store: string, key: IDBValidKey) => Promise<void>;
  clear: (store: string) => Promise<void>;
  getKv: <T>(key: IDBValidKey, store?: string) => Promise<T | undefined>;
  setKv: <T>(key: IDBValidKey, value: T, store?: string) => Promise<void>;
  eraseAll: () => Promise<void>;
}

export function createDb({
  name,
  version = 1,
  stores = [{ name: 'items', keyPath: 'id' }, { name: 'kv' }],
}: DbConfig): KitDb {
  let dbp: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of stores) {
            if (db.objectStoreNames.contains(s.name)) continue;
            db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onclose = () => { dbp = null; };
          db.onversionchange = () => { db.close(); dbp = null; };
          resolve(db);
        };
        req.onerror = () => { dbp = null; reject(req.error); };
        req.onblocked = () => { dbp = null; reject(new Error('Database blocked')); };
      });
    }
    return dbp;
  }

  async function run<T = void>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => IDBRequest<T> | void,
  ): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeNames, mode);
      let result: T;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      const out = work(t);
      if (out) out.onsuccess = () => { result = out.result; };
    });
  }

  const allNames = stores.map(s => s.name);

  return {
    open,
    run,
    getAll: <T>(store: string) => run<T[]>(store, 'readonly', t => t.objectStore(store).getAll() as IDBRequest<T[]>),
    get: <T>(store: string, key: IDBValidKey) => run<T | undefined>(store, 'readonly', t => t.objectStore(store).get(key) as IDBRequest<T | undefined>),
    put: <T>(store: string, value: T) => run<void>(store, 'readwrite', t => { t.objectStore(store).put(value); }),
    putMany: <T>(store: string, list: T[]) => run<void>(store, 'readwrite', t => {
      const os = t.objectStore(store);
      list.forEach(row => os.put(row));
    }),
    del: (store: string, key: IDBValidKey) => run<void>(store, 'readwrite', t => { t.objectStore(store).delete(key); }),
    clear: (store: string) => run<void>(store, 'readwrite', t => { t.objectStore(store).clear(); }),
    getKv: <T>(key: IDBValidKey, store = 'kv') => run<T | undefined>(store, 'readonly', t => t.objectStore(store).get(key) as IDBRequest<T | undefined>),
    setKv: <T>(key: IDBValidKey, value: T, store = 'kv') => run<void>(store, 'readwrite', t => { t.objectStore(store).put(value, key); }),
    eraseAll: () => run<void>(allNames, 'readwrite', t => {
      allNames.forEach(s => t.objectStore(s).clear());
    }),
  };
}

let persisted = false;
export function requestPersist(): void {
  if (persisted) return;
  persisted = true;
  navigator?.storage?.persist?.().catch(() => { });
}
