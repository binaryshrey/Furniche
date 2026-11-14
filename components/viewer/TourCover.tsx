'use client';
import { useEffect, useState } from 'react';
import { useViewerState } from '@/lib/sceneBridge';

// Matterport boots through a dark loading screen and sometimes its dollhouse overview before
// our code moves the camera inside. Cover all of that with the listing's own photo until the
// viewer is standing in a room for the first time, then fade away. (Later trips to the
// dollhouse or floor plan are the user's choice and stay visible.)
export default function TourCover({ sid }: { sid: string }) {
  const showingRoom = useViewerState((s) => s.showingRoom);
  const [shown, setShown] = useState(false);
  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setShown(false);
    setGone(false);
    setSlow(false);
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [sid]);
  useEffect(() => {
    if (!showingRoom || shown) return;
    // Give the first panorama a moment to paint before revealing it.
    const t = setTimeout(() => setShown(true), 700);
    return () => clearTimeout(t);
  }, [showingRoom, shown]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setGone(true), 800);
    return () => clearTimeout(t);
  }, [shown]);

  if (gone) return null;
  return (
    <div
      className="absolute inset-0 z-30 overflow-hidden bg-paper transition-opacity duration-700"
      style={{ opacity: shown ? 0 : 1, pointerEvents: shown ? 'none' : undefined }}
      role="status"
      aria-live="polite"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=1600`} alt="" className="h-full w-full scale-105 object-cover blur-[2px]" />
      <div className="absolute inset-0 bg-black/35" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-center gap-3 rounded-full bg-paper/85 px-5 py-3 text-sm backdrop-blur">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
          {slow ? 'Matterport is taking a while. Still opening the room…' : 'Opening the room in 3D…'}
        </div>
      </div>
    </div>
  );
}
