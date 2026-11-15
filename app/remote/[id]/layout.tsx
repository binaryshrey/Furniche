import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'FurNiche AI remote' };

// A phone controller: no pinch-zoom, so drags on the look pad steer the tour instead of the page.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, themeColor: '#0f0f0f' };

export default function RemoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
