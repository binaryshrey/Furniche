import Editor from '@/components/Editor';

export default function SpacePage({ params }: { params: { sid: string } }) {
  return <Editor sid={params.sid} />;
}
