import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';

const sans = Roboto({ subsets: ['latin'], weight: ['300', '400', '500', '700'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Furniche',
  description: 'Furnish real Houston homes with real furniture, at true size, before you move in.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
