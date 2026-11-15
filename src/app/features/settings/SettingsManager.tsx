'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { CRM_THEMES, readCrmTheme, setCrmTheme, type CrmTheme } from '../../../lib/crm-theme';
import styles from './SettingsManager.module.css';

type Settings = {
  organizationId: string;
  organizationName: string;
  currency: string;
  timezone: string;
  weekStartsOn: number;
  updatedAt: string | null;
  canEdit: boolean;
};

const timezones = ['UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const message = result.error?.message ?? result.message;
  return typeof message === 'string' ? message : 'Something went wrong. Please try again.';
}

export default function SettingsManager() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('UTC');
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [theme, setTheme] = useState<CrmTheme>('default');
  const [themeError, setThemeError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await crmApiFetch('/settings', { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (active) {
          const value = payload.data as Settings;
          setSettings(value);
          setOrganizationName(value.organizationName);
          setCurrency(value.currency);
          setTimezone(value.timezone);
          setWeekStartsOn(value.weekStartsOn);
        }
      } catch (cause) {
        if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch')
          ? 'Could not reach the CRM API. Start the API server and try again.'
          : cause instanceof Error ? cause.message : 'Could not load settings.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [refresh]);

  useEffect(() => {
    setTheme(readCrmTheme());
  }, []);

  function chooseTheme(value: CrmTheme) {
    setThemeError('');
    try {
      setCrmTheme(value);
      setTheme(value);
    } catch {
      setThemeError('Could not save your appearance preference. Check browser storage and try again.');
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationName, currency, timezone, weekStartsOn }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setSettings(payload.data as Settings);
      setNotice('Workspace settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save workspace settings.');
    } finally {
      setBusy(false);
    }
  }

  const editable = settings?.canEdit ?? false;

  return <section className={styles.feature}>
    <header className={styles.heading}><div><p className="date-label">WORKSPACE / SETTINGS</p><h1>Settings</h1><p className="welcome-copy">Workspace identity and regional preferences.</p></div></header>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <form className={styles.form} onSubmit={(event) => void save(event)} aria-busy={loading}>
      <div className={styles.formHeading}><div><h2>Workspace preferences</h2><p>{editable ? 'Changes apply to this organization.' : 'These preferences are managed by an organization manager.'}</p></div><span className={styles.workspaceMark} aria-hidden="true">{organizationName.slice(0, 1).toUpperCase() || 'W'}</span></div>
      <label className={styles.field}>Workspace name<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} maxLength={160} required disabled={loading || busy || !editable} /></label>
      <label className={styles.field}>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={loading || busy || !editable}><option value="USD">USD · US Dollar</option><option value="CAD">CAD · Canadian Dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British Pound</option></select><small>Display preference only; existing amounts are not converted.</small></label>
      <label className={styles.field}>Time zone<select value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={loading || busy || !editable}>{!timezones.includes(timezone) && <option value={timezone}>{timezone}</option>}{timezones.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label className={styles.field}>Week starts on<select value={weekStartsOn} onChange={(event) => setWeekStartsOn(Number(event.target.value))} disabled={loading || busy || !editable}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
      <footer className={styles.formFooter}><span>{settings?.updatedAt ? `Last saved ${new Date(settings.updatedAt).toLocaleString()}` : 'Default preferences'}</span><button className="button button-primary" type="submit" disabled={loading || busy || !editable}>{busy ? 'Saving...' : 'Save settings'}</button></footer>
    </form>
    <section className={styles.appearance} aria-labelledby="appearance-heading">
      <div className={styles.appearanceHeading}>
        <div><h2 id="appearance-heading">CRM colors</h2><p>Choose an appearance for this browser. It applies across CRM pages and does not change other team members’ settings.</p></div>
        <button className="button button-secondary" type="button" onClick={() => chooseTheme('default')}>Use default color</button>
      </div>
      <div className={styles.themeGrid} role="group" aria-label="CRM color themes">
        {CRM_THEMES.map((option) => (
          <button
            className={`${styles.themeOption}${theme === option.id ? ` ${styles.themeSelected}` : ''}`}
            type="button"
            key={option.id}
            aria-pressed={theme === option.id}
            onClick={() => chooseTheme(option.id)}
          >
            <span className={styles.themeSwatches} aria-hidden="true">
              {option.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
            </span>
            <span>{option.name}</span>
            {theme === option.id && <span className={styles.themeCheck} aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
      {themeError && <p className={styles.themeError} role="alert">{themeError}</p>}
    </section>
  </section>;
}