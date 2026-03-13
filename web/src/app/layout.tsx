import type { Metadata } from 'next';
import { Manrope, Space_Grotesk } from 'next/font/google';
import './globals.css';

const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
});

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'StayReviewr',
  description: 'Search and compare vacation rentals across platforms',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${sans.variable} ${display.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
