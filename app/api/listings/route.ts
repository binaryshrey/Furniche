import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), 'data', 'listings.json'), 'utf8');
    return new NextResponse(raw, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return NextResponse.json(
      { error: 'data/listings.json is missing. Run: python3 scripts/build_listings.py', homes: [], apartments: [] },
      { status: 500 },
    );
  }
}
