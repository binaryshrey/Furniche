'use client';
import { useEffect, useState } from 'react';
import { IMPORT_KEY, type PagePayload } from '@/components/shop/ImportLink';
import { useStore } from '@/lib/store';

// Landing page for the "Add to Furniche" bookmarklet. The product data arrives in the URL hash
// (never sent to a server), is parked in localStorage, and the shopper goes back to their room,
// where the importer picks it up.
export default function ImportFromPage() {
  const [message, setMessage] = useState('Reading the product…');

  useEffect(() => {
    let payload: PagePayload | null = null;
    try {
      payload = JSON.parse(decodeURIComponent(window.location.hash.slice(1)));
    } catch {
      /* not a bookmarklet link */
    }
    if (!payload?.url) {
      setMessage('No product came through. Open a product page and click Add to Furniche again.');
      return;
    }
    try {
      localStorage.setItem(IMPORT_KEY, JSON.stringify(payload));
    } catch {
      setMessage('This browser blocked local storage, so the product could not be handed over.');
      return;
    }
    // Back to the room the shopper worked on most recently.
    const designs = Object.values(useStore.getState().designs).filter((d) => !d.sid.startsWith('out:'));
    const latest = designs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    window.location.replace(latest ? `/space/${latest.sid}` : '/explore');
  }, []);

  return <div className="grid min-h-screen place-items-center px-6 text-center text-sm text-muted">{message}</div>;
}
