import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Editor from '@/components/Editor';
import { flyQuery } from '@/lib/flyIn';

// A page load of a home on the Vexcel 3D mesh (typed address, reload, shared link) opens as the
// fly-in from the 3D city, like picking it there. Moving here inside the app (the fly-in's own
// address change, links in the cart) is not a document load and goes straight to the tour.
// ?direct=1 skips the fly-in (the home page falls back to it when the city map is slow to load).
export default async function SpacePage({ params, searchParams }: { params: { sid: string }; searchParams: { direct?: string } }) {
  if (!searchParams.direct && headers().get('sec-fetch-dest') === 'document' && (await flyQuery(params.sid))) redirect(`/?fly=${params.sid}`);
  return <Editor sid={params.sid} />;
}
