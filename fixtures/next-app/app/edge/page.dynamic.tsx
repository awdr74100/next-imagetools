import ImageGrid from '../../components/ImageGrid';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default function Page() {
  return <ImageGrid mode="app-edge" />;
}
