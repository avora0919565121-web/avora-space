import { commands } from "vitest/browser";

/**
 * 112-A · 4 — every measurement lands as a small JSON next to the table that quotes it
 * (`docs/reliability/do-112a/<name>.json`), so "đạt / không đạt" always points at a number.
 * `commands.writeFile` resolves from the web/ root; the test server may write in ../docs only.
 */
export const MEASURE_DIR = "../docs/reliability/do-112a";

export async function recordMeasure(name: string, data: Record<string, unknown>): Promise<void> {
  await commands.writeFile(`${MEASURE_DIR}/${name}.json`, `${JSON.stringify({ measuredAt: new Date().toISOString(), ...data }, null, 2)}\n`);
}

/** What every golden test's people are called (see `uid()` in the tests): `xxxxxxxx-0000-4000-8000-…`. */
const GOLDEN_ID = /-0000-4000-8000-/;

/**
 * Removes what earlier golden tests left on this device — only their own keys and outbox items.
 *
 * 112-A · 6 (root cause of a second flake): vitest runs test files side by side in iframes of ONE
 * origin, so localStorage, sessionStorage and IndexedDB are shared by every file running at that
 * moment. Clearing them wholesale (as a first version of this helper did) wiped the saved place,
 * tab memory and hints of `navigation-rules` / `resume-place` mid-test and failed dozens of them.
 * Golden tests use fresh user ids, so nothing here needs more than its own leftovers.
 */
export async function freshDevice(): Promise<void> {
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (const key of Object.keys(store)) if (GOLDEN_ID.test(key)) store.removeItem(key);
  }
  // Not deleteDatabase: the app keeps its outbox connections open, so a delete would stay blocked
  // and hold every later open behind it (the next app copy's outbox would never start).
  await new Promise<void>((resolve) => {
    const request = indexedDB.open("avora-outbox", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("items")) request.result.createObjectStore("items", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("items", "readwrite");
      const cursorRequest = tx.objectStore("items").openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) return;
        if (GOLDEN_ID.test(String((cursor.value as { userId?: unknown }).userId ?? ""))) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    };
    request.onerror = () => resolve();
  });
}
