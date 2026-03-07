/**
 * Store local cue image data (data URLs) in IndexedDB so the project JSON stays small.
 * In the project we save only "local:<cueId>"; the actual image is stored here (browser only, not Supabase).
 */

const DB_NAME = 'frameflow_local_cues';
const STORE_NAME = 'cue_data';
const LOCAL_REF_PREFIX = 'local:';

export function isLocalRef(src: string): boolean {
  return (src || '').trim().startsWith(LOCAL_REF_PREFIX);
}

export function getLocalCueIdFromRef(src: string): string | null {
  const t = (src || '').trim();
  if (!t.startsWith(LOCAL_REF_PREFIX)) return null;
  return t.slice(LOCAL_REF_PREFIX.length) || null;
}

export function toLocalRef(cueId: string): string {
  return LOCAL_REF_PREFIX + cueId;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}

export function setLocalCueData(cueId: string, dataUrl: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ id: cueId, dataUrl });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      })
  );
}

export function getLocalCueData(cueId: string): Promise<string | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(cueId);
        req.onsuccess = () => {
          db.close();
          resolve(req.result?.dataUrl ?? null);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      })
  );
}

/** Convert blob URL to data URL so we can store it in IndexedDB. */
export function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  return fetch(blobUrl)
    .then((r) => r.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read blob'));
          reader.readAsDataURL(blob);
        })
    );
}
