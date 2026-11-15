'use client';
import { useEffect } from 'react';

// Registers the worker in public/mp-sw.js, which keeps Matterport model files in local storage
// so a home loads quickly the next time (including when flying in from the 3D city). It does
// nothing where service workers are unavailable.
export default function MatterportCache() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/mp-sw.js').catch(() => {});
  }, []);
  return null;
}
