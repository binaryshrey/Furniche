// Panos the tour can't visit, per home, as the tour reported them (see MatterportHost). The
// sky-to-house flight asks the server for its entry photo without these, so it ends where the
// tour can actually open. Browser storage only: a convenience, not something to rely on.
const key = (sid: string) => `furniche-skip:${sid}`;

export function skippedPanos(sid: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key(sid)) ?? '[]');
  } catch {
    return [];
  }
}

export function rememberSkipped(sid: string, ids: string[]) {
  try {
    localStorage.setItem(key(sid), JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}

export const entryUrl = (sid: string) => {
  const skip = skippedPanos(sid);
  return `/api/models/${sid}/entry${skip.length ? `?skip=${skip.join(',')}` : ''}`;
};
