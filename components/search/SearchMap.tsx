'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import type { Spot } from './spots';

export type { Spot };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// A price tag with an arrow pointing at the building. Built as a DivIcon so it is styled in CSS.
function pin(spot: Spot, active: boolean): L.DivIcon {
  const first = spot.items[0];
  const count = spot.items.length > 1 ? `<em>${spot.items.length}</em>` : '';
  return L.divIcon({
    className: 'fn-pin-anchor',
    html: `<div class="fn-pin${active ? ' is-active' : ''}"><span>${esc(first.priceLabel)}</span>${count}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function FitTo({ spots }: { spots: Spot[] }) {
  const map = useMap();
  useEffect(() => {
    if (!spots.length) return;
    const b = L.latLngBounds(spots.map((s) => [s.lat, s.lon] as [number, number]));
    // Leave room at the bottom for the carousel that overlays the map.
    map.fitBounds(b, { paddingTopLeft: [40, 90], paddingBottomRight: [40, 240], maxZoom: 16 });
  }, [spots, map]);
  return null;
}

function PanTo({ spot }: { spot: Spot | null }) {
  const map = useMap();
  useEffect(() => {
    if (spot && !map.getBounds().pad(-0.15).contains([spot.lat, spot.lon])) map.panTo([spot.lat, spot.lon], { animate: true });
  }, [spot, map]);
  return null;
}

export default function SearchMap({
  spots,
  activeKey,
  focus,
  onPick,
  onHover,
}: {
  spots: Spot[];
  activeKey: string | null;
  focus: Spot | null;
  onPick: (spot: Spot) => void;
  onHover: (key: string | null) => void;
}) {
  const icons = useMemo(() => new Map(spots.map((s) => [s.key, { off: pin(s, false), on: pin(s, true) }])), [spots]);

  return (
    <MapContainer center={[29.76, -95.37]} zoom={12} minZoom={11} maxZoom={20} zoomControl={false} className="h-full w-full bg-paper">
      <TileLayer url="/api/vexcel/tile/{z}/{x}/{y}" maxZoom={20} attribution="Imagery © Vexcel Imaging" />
      <FitTo spots={spots} />
      <PanTo spot={focus} />
      {spots.map((s) => (
        <Marker
          key={s.key}
          position={[s.lat, s.lon]}
          icon={icons.get(s.key)![s.key === activeKey ? 'on' : 'off']}
          // Buildings with several matches sit above single listings where tags overlap.
          zIndexOffset={s.key === activeKey ? 2000 : s.items.length > 1 ? 500 : 0}
          eventHandlers={{ click: () => onPick(s), mouseover: () => onHover(s.key), mouseout: () => onHover(null) }}
        />
      ))}
    </MapContainer>
  );
}
