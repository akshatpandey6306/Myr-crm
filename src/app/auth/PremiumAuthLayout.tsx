import type { ReactNode } from 'react';
import styles from './premium-auth.module.css';

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

export default function PremiumAuthLayout({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <main className={`${styles.page}${compact ? ` ${styles.compact}` : ''}`}>
      <section className={`${styles.story} premium-auth-story`} aria-label="LeadPilot CRM">
        <a className={styles.brand} href="/sign-in" aria-label="LeadPilot Advance Solution sign in">
          <img src="/leadpilot-advance-solution-white.svg" alt="LeadPilot Advance Solution" />
        </a>

        <div className={styles.storyContent}>
          <span className={styles.eyebrow}>THE FUTURE OF CRM</span>
          <h1>Your business relationships, reimagined.</h1>
          <p>Manage your leads, build meaningful connections and move opportunities forward in one intelligent workspace.</p>

          <div className={styles.visual} aria-hidden="true">
            <div className={styles.glow} />
            <div className={styles.orbitOne} />
            <div className={styles.orbitTwo} />

            <div className={styles.dashboard}>
              <div className={styles.dashboardHeader}>
                <span><i />Workspace snapshot</span>
                <b>•••</b>
              </div>
              <div className={styles.metricRow}>
                <div><small>Pipeline</small><strong>Relationships</strong><em>Organized across your team</em></div>
                <span className={styles.metricIcon}>
                  <svg viewBox="0 0 24 24"><path d="M4 18V9m5 9V5m5 13v-6m6 6V3" /></svg>
                </span>
              </div>
              <div className={styles.chart}>
                {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
                <i />
              </div>
              <div className={styles.chartLabels}><span>New</span><span>Contacted</span><span>Qualified</span><span>Opportunity</span><span>Won</span></div>
              <div className={styles.pipeline}>
                <div><i />Juniper Market<b>Connected</b></div>
                <div><i />Northstar Labs<b>Follow-up</b></div>
                <div><i />Forma Studio<b>In progress</b></div>
              </div>
            </div>

            <div className={styles.floatCard}>
              <span className={styles.floatIcon}><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" /></svg></span>
              <span><strong>Next step</strong><small>Follow-up ready</small></span>
              <b>Today</b>
            </div>
            <div className={styles.floatNote}>
              <span><CheckIcon /></span>
              <span><strong>Team activity</strong><small>A new connection</small></span>
            </div>
          </div>
        </div>

        <div className={styles.benefits}>
          <span><i><svg viewBox="0 0 24 24"><path d="M4 18V9m5 9V5m5 13v-6m6 6V3" /></svg></i>Grow faster</span>
          <span><i><svg viewBox="0 0 24 24"><path d="M4 5h16v12H9l-5 4V5Z" /></svg></i>Work smarter</span>
          <span><i><CheckIcon /></i>Close more deals</span>
        </div>
      </section>

      <section className={styles.formSide} aria-label="Sign in to your workspace">
        <div className={styles.formCard}>
          {children}
          <aside className={styles.secure} aria-label="Security information">
            <span><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></svg></span>
            <div><strong>SECURE &amp; PRIVATE</strong><small>Your workspace. Your data. Protected.</small></div>
          </aside>
        </div>
        <footer className={styles.formFooter}>© 2026 LeadPilot. All rights reserved.</footer>
      </section>
    </main>
  );
}
