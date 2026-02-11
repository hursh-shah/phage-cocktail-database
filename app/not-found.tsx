import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell">
      <section className="card">
        <div className="card-body stack" style={{ gap: "0.75rem" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display), serif" }}>Record not found</h1>
          <p className="muted" style={{ margin: 0 }}>
            The requested record is unavailable or the ID is invalid.
          </p>
          <Link href="/cocktails" className="btn-link" style={{ width: "fit-content" }}>
            Back to cocktail collection
          </Link>
        </div>
      </section>
    </main>
  );
}
