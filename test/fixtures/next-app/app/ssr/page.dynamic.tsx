import ImageGrid from '../../components/ImageGrid';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <ImageGrid mode="app-ssr" />;
}
