import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <span className="eyebrow">404</span>
        <h1>Record not found</h1>
        <p className="page-summary">
          The requested record is unavailable or the ID is invalid.
        </p>
      </header>
      <div>
        <Link href="/phages" className="btn-link">
          Back to phages
        </Link>
      </div>
    </main>
  );
}
