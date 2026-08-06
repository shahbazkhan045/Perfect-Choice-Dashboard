import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Justlife × Perfect Choice — Daily Confirmation',
  description:
    'Daily cash collection and cancellation / release confirmation dashboard for the Perfect Choice partnership.',
  robots: { index: false, follow: false },
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%231d6fd0"/><text x="16" y="23" font-size="19" font-weight="700" text-anchor="middle" fill="white" font-family="system-ui,sans-serif">J</text></svg>',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef6fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1520' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint so there is no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('pcd-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
