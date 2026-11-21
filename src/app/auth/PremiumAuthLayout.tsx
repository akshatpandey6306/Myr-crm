import type { ReactNode } from 'react';

export default function PremiumAuthLayout({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <main className={`premium-auth-page${compact ? ' premium-auth-page-compact' : ''}`}>
      <section className="premium-auth-content" aria-label="Account access">
        {children}
        <aside className="premium-auth-security" aria-label="Security information">
          <span className="premium-auth-lock" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
            </svg>
          </span>
          <span>
            <strong>SECURE &amp; PRIVATE</strong>
            <small>Your workspace. Your data. Protected.</small>
          </span>
        </aside>
        <footer className="premium-auth-copyright">© 2026 LeadPilot. All rights reserved.</footer>
      </section>
    </main>
  );
}
