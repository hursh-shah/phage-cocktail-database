import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phage Cocktail Database",
  description:
    "Research-ready phage cocktail index with host-range, kinetics, experiment context, and provenance metadata."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <header className="top-nav">
          <div className="page-shell nav-shell">
            <Link href="/" className="brand-link">
              Phage Cocktail DB
            </Link>
            <nav className="nav-links" aria-label="Primary">
              <Link href="/" className="nav-link">
                Overview
              </Link>
              <Link href="/cocktails" className="nav-link">
                Cocktails
              </Link>
              <Link href="/papers" className="nav-link">
                Papers
              </Link>
              <Link href="/phages" className="nav-link">
                Phages
              </Link>
              <Link href="/upload" className="nav-link">
                Upload
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
