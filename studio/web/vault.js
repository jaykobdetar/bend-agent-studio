let opening;
function db() {
  return (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('bend-studio-recordings', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('clips', {keyPath: 'id'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function query(mode, act) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('clips', mode),
      request = act(tx.objectStore('clips'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? Error('Storage unavailable'));
  });
}
export const listClips = () => query('readonly', (s) => s.getAll());
export const saveClip = (x) => query('readwrite', (s) => s.put(x));
export const deleteClip = (k) => query('readwrite', (s) => s.delete(k));
