'use client';
import { useEffect, useState } from 'react';
import OutdoorPlanner, { type PropertyData } from '@/components/outdoor/OutdoorPlanner';
import { TopNav } from '@/components/ui/Brand';

export default function Outside({ params, searchParams }: { params: { listingId: string }; searchParams: { sid?: string } }) {
  const [property, setProperty] = useState<PropertyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vexcel/property?listing=${encodeURIComponent(params.listingId)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setProperty(d)))
      .catch(() => setError('Could not load the property.'));
  }, [params.listingId]);

  return (
    <div className="min-h-screen">
      <TopNav />
      {error && <p className="p-10 text-sm text-bad">{error}</p>}
      {!property && !error && <p className="p-10 text-sm text-muted">Loading the aerial view…</p>}
      {property && <OutdoorPlanner property={property} sid={searchParams.sid ?? null} />}
    </div>
  );
}
