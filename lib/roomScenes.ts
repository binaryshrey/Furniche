'use client';
import type { RoomScene } from './designOps';
import { senseRoom } from './scanSense';
import { useViewerState } from './sceneBridge';
import type { ModelGeometry } from './types';

// Windows and built-ins the scan shows in each room, for placing pieces clear of them. Needs the
// scan mesh, so it runs in the browser; rooms the scan can't read are left out.
export function roomScenes(geometry: ModelGeometry | null, roomIds?: string[]): Record<string, RoomScene> {
  if (!geometry) return {};
  // A defurnished model's mesh still holds the seller's furniture, so its "fixtures" aren't fixed.
  const fixtures = !useViewerState.getState().hasDefurnish;
  const out: Record<string, RoomScene> = {};
  for (const room of geometry.rooms) {
    if (roomIds && !roomIds.includes(room.id)) continue;
    try {
      const s = senseRoom(room, { fixtures });
      if (s) out[room.id] = { windows: s.windows.map((w) => ({ a: w.a, b: w.b })), fixtures: s.fixtures };
    } catch {
      /* scan not loaded for this room */
    }
  }
  return out;
}
