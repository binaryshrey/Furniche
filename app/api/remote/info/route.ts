import os from 'node:os';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// The address a phone should open. On a public host that is just this site; on a laptop running
// `next dev`, "localhost" means nothing to the phone, so use this machine's address on the local
// network (the phone must be on the same Wi-Fi).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const [hostname, port] = host.split(':');
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(hostname);
  if (!local) return NextResponse.json({ base: `${proto}://${host}`, lan: false });

  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  // Prefer typical home/office ranges over VPN or container bridges.
  const pick = addrs.find((a) => /^192\.168\./.test(a)) ?? addrs.find((a) => /^10\./.test(a)) ?? addrs.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ?? addrs[0];
  if (!pick) return NextResponse.json({ base: null, lan: true, error: 'This computer has no network address the phone can reach.' });
  return NextResponse.json({ base: `http://${pick}${port ? `:${port}` : ''}`, lan: true, all: addrs });
}
