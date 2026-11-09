import ImageGrid from '../components/ImageGrid';

export const getServerSideProps = async () => ({ props: {} });

export default function Page() {
  return <ImageGrid mode="pages-ssr" />;
}
