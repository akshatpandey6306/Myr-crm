import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <span className="not-found-code">404</span>
        <h1 id="not-found-title">This page isn&apos;t here</h1>
        <p>The link may be old, or the address may have a typo.</p>
        <Link className="button button-primary" href="/">Back to overview</Link>
      </section>
    </main>
  );
}
