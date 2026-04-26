import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phage Database",
  description:
    "Curated phage records with host-range, kinetics, cocktail context, and provenance metadata."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="app-sidebar" aria-label="Primary">
            <Link href="/phages" className="brand-link">
              Phage Database
            </Link>

            <form action="/phages" method="get" className="sidebar-search" role="search">
              <label htmlFor="global-search">Search</label>
              <input
                id="global-search"
                type="search"
                name="q"
                placeholder="phage, accession, host..."
                autoComplete="off"
              />
            </form>

            <nav className="nav-group" aria-label="Database">
              <span className="nav-group-label">Database</span>
              <Link href="/phages" className="nav-link">
                Phages
              </Link>
              <Link href="/cocktails" className="nav-link">
                Cocktails
              </Link>
            </nav>

            <nav className="nav-group" aria-label="Tools">
              <span className="nav-group-label">Tools</span>
              <Link href="/papers" className="nav-link">
                Papers
              </Link>
              <Link href="/upload" className="nav-link">
                Upload
              </Link>
              <Link href="/cocktails/new" className="nav-link">
                New cocktail
              </Link>
            </nav>
          </aside>

          <div className="app-main">{children}</div>
        </div>
      </body>
    </html>
  );
}
