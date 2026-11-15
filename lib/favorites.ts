// Saved listings (the heart on each card), kept in the browser as a list of listing ids.
export const FAVORITES_KEY = 'furniche-favorites';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

// Storage can be missing or blocked (private windows), and the saved text can be damaged: both
// just mean "nothing saved yet" and never throw.
export function loadFavorites(store?: Store): Set<string> {
  try {
    const raw = (store ?? localStorage).getItem(FAVORITES_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(favs: Set<string>, store?: Store) {
  try {
    (store ?? localStorage).setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {
    /* storage unavailable or over quota: the hearts still work until the page closes */
  }
}
