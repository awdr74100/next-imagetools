import './styles.css';

export const metadata = {
  title: 'turbopack-imagetools playground',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
