'use client';
import dynamic from 'next/dynamic';

// nothing about the images is in the HTML; they only exist in the client bundle
const ImageGrid = dynamic(() => import('../../components/ImageGrid'), { ssr: false });

export default function Page() {
  return <ImageGrid mode="app-csr" />;
}
