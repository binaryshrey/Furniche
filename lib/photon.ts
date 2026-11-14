import 'server-only';

// Photon 2.0 beta: the same Furniche agent over iMessage (and any channel the project adds).
// Inbound messages are polled (no public webhook URL needed on localhost); replies go back into
// the same Space from the agent's line. API: https://api.photon.codes/v1, Bearer pho_sk_ key.
const API = 'https://api.photon.codes/v1';

export function photonAvailable(): boolean {
  return !!(process.env.PHOTON_API_KEY && process.env.PHOTON_PROJECT_ID);
}

async function api<T = any>(method: 'GET' | 'POST', p: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}/projects/${process.env.PHOTON_PROJECT_ID}${p}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.PHOTON_API_KEY}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Photon ${method} ${p} ${res.status}: ${json?.detail ?? json?.title ?? json?.message ?? text.slice(0, 200)}`);
  return json as T;
}

export type Inbound = { id: string; text: string; from: string; spaceId: string; agentUserId: string; at: string; platform: string };

// Text messages people sent the agent since `since` (ISO), oldest first.
export async function receivedSince(since: string): Promise<Inbound[]> {
  const q = new URLSearchParams({ direction: 'received', createdSince: since, order: 'asc', pageSize: '50' });
  const res = await api<{ items: any[] }>('GET', `/messages?${q}`);
  return (res.items ?? [])
    .filter((m) => m.content?.type === 'text' && m.content.text?.trim() && m.sentBy?.kind !== 'agent')
    .map((m) => ({
      id: m.id,
      text: m.content.text as string,
      from: m.sentBy?.handle ?? m.sentBy?.id ?? 'someone',
      spaceId: m.space?.id,
      agentUserId: m.receivedBy?.id,
      at: m.createdAt,
      platform: m.platform,
    }))
    .filter((m) => m.spaceId && m.agentUserId);
}

export async function reply(to: Inbound, text: string): Promise<void> {
  await api(
    'POST',
    '/messages',
    { spaceId: to.spaceId, senderId: to.agentUserId, parentMessageId: to.id, content: { type: 'text', format: 'plain', text: text.slice(0, 1800) } },
    { 'idempotency-key': `furniche-reply-${to.id}` },
  );
}
