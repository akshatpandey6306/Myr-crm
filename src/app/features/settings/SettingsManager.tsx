'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { CRM_THEMES, setCrmTheme, type CrmTheme } from '../../../lib/crm-theme';
import styles from './SettingsManager.module.css';

type Settings = {
  organizationId: string;
  organizationName: string;
  currency: string;
  timezone: string;
  weekStartsOn: number;
  dateFormat: string;
  timeFormat: string;
  crmTheme: CrmTheme;
  updatedAt: string | null;
  canEdit: boolean;
};

const timezones = ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Australia/Sydney'];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatRegionalPreview(timezone: string, dateFormat: string, timeFormat: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: dateFormat === 'DD MMM YYYY' ? 'short' : '2-digit',
    year: 'numeric',
  }).formatToParts(now).reduce<Record<string, string>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const date = dateFormat === 'DD MMM YYYY' ? `${parts.day} ${parts.month} ${parts.year}`
    : dateFormat === 'MM/DD/YYYY' ? `${parts.month}/${parts.day}/${parts.year}`
      : dateFormat === 'DD/MM/YYYY' ? `${parts.day}/${parts.month}/${parts.year}`
        : `${parts.year}-${parts.month}-${parts.day}`;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  }).format(now);
  return `${date} · ${time}`;
}

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
  const [dateFormat, setDateFormat] = useState('DD MMM YYYY');
  const [timeFormat, setTimeFormat] = useState('12h');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [theme, setTheme] = useState<CrmTheme>('default');
  const [themeError, setThemeError] = useState('');
  const [previewNow, setPreviewNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setPreviewNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
          setDateFormat(value.dateFormat ?? 'DD MMM YYYY');
          setTimeFormat(value.timeFormat ?? '12h');
          setTheme(value.crmTheme ?? 'default');
          setCrmTheme(value.crmTheme ?? 'default');
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

  async function chooseTheme(value: CrmTheme) {
    setThemeError('');
    try {
      const response = await crmApiFetch('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crmTheme: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setTheme(value);
      setCrmTheme(value);
    } catch (cause) {
      setThemeError(cause instanceof Error ? cause.message : 'Could not save this workspace color.');
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
        body: JSON.stringify({ organizationName, currency, timezone, weekStartsOn, dateFormat, timeFormat }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setSettings(payload.data as Settings);
      setOrganizationName(payload.data.organizationName);
      setCurrency(payload.data.currency);
      setTimezone(payload.data.timezone);
      setWeekStartsOn(payload.data.weekStartsOn);
      setDateFormat(payload.data.dateFormat);
      setTimeFormat(payload.data.timeFormat);
      setNotice('Workspace settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save workspace settings.');
    } finally {
      setBusy(false);
    }
  }

  const editable = settings?.canEdit ?? false;
  const dirty = Boolean(settings && (
    organizationName !== settings.organizationName || currency !== settings.currency || timezone !== settings.timezone ||
    weekStartsOn !== settings.weekStartsOn || dateFormat !== settings.dateFormat || timeFormat !== settings.timeFormat
  ));
  const previewDate = formatRegionalPreview(timezone, dateFormat, timeFormat, previewNow);
  const previewMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(1280.5);
  const settingsErrorMessage = error === 'Unexpected error'
    ? 'The settings API could not load this workspace. Check that the API is running and its database migrations are current.'
    : error;

  return <section className={styles.feature}>
    <section className={styles.workspacePulse} aria-label="Workspace preview">
      <div className={styles.pulseIdentity}><span className={styles.pulseAvatar}>{organizationName.slice(0, 1).toUpperCase() || 'W'}</span><div><span className={styles.eyebrow}>WORKSPACE PROFILE</span><h2>{organizationName || 'Your workspace'}</h2><p>Regional settings preview</p></div></div>
      <div className={styles.pulseStats}><div><span>LOCAL DATE &amp; TIME</span><strong>{previewDate}</strong><small>{timezone}</small></div><div><span>DISPLAY CURRENCY</span><strong>{previewMoney}</strong><small>Week starts {weekdays[weekStartsOn]}</small></div></div>
      <span className={`${styles.saveState} ${dirty ? styles.saveStateDirty : ''}`}><i />{dirty ? 'Unsaved changes' : 'All settings saved'}</span>
    </section>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><div><strong>Settings couldn’t load</strong><span>{settingsErrorMessage}</span></div>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <form className={styles.form} onSubmit={(event) => void save(event)} aria-busy={loading}>
      <div className={styles.formHeading}><div><span className={styles.eyebrow}>REGIONAL PREFERENCES</span><h2>Workspace preferences</h2><p>{editable ? 'Changes apply across this organization.' : 'These preferences are managed by an organization manager.'}</p></div><span className={styles.workspaceMark} aria-hidden="true">A–Z</span></div>
      <label className={styles.field}>Workspace name<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} maxLength={160} required disabled={loading || busy || !editable} /></label>
      <label className={styles.field}>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={loading || busy || !editable}><option value="INR">INR · Indian Rupee</option><option value="USD">USD · US Dollar</option><option value="CAD">CAD · Canadian Dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British Pound</option><option value="AUD">AUD · Australian Dollar</option><option value="JPY">JPY · Japanese Yen</option><option value="SGD">SGD · Singapore Dollar</option></select><small>Display preference only; existing amounts are not converted.</small></label>
      <label className={styles.field}>Time zone<select value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={loading || busy || !editable}>{!timezones.includes(timezone) && <option value={timezone}>{timezone}</option>}{timezones.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label className={styles.field}>Week starts on<select value={weekStartsOn} onChange={(event) => setWeekStartsOn(Number(event.target.value))} disabled={loading || busy || !editable}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
      <label className={styles.field}>Date format<select value={dateFormat} onChange={(event) => setDateFormat(event.target.value)} disabled={loading || busy || !editable}><option value="DD MMM YYYY">16 Nov 2026</option><option value="MM/DD/YYYY">11/16/2026</option><option value="DD/MM/YYYY">16/11/2026</option><option value="YYYY-MM-DD">2026-11-16</option></select><small>Choose how dates appear in your workspace.</small></label>
      <label className={styles.field}>Time format<select value={timeFormat} onChange={(event) => setTimeFormat(event.target.value)} disabled={loading || busy || !editable}><option value="12h">12-hour · 2:30 PM</option><option value="24h">24-hour · 14:30</option></select><small>The preview updates as you change your preferences.</small></label>
      <footer className={styles.formFooter}><span>{dirty ? 'You have changes to save.' : settings?.updatedAt ? `Last saved ${new Date(settings.updatedAt).toLocaleString()}` : 'Default preferences'}</span><button className="button button-primary" type="submit" disabled={loading || busy || !editable || !dirty}>{busy ? 'Saving...' : dirty ? 'Save changes' : 'Settings saved'}</button></footer>
    </form>
    <div className={styles.appearanceStack}>
    <section className={styles.appearance} aria-labelledby="appearance-heading">
      <div className={styles.appearanceHeading}>
        <div><h2 id="appearance-heading">CRM colors</h2><p>{editable ? 'Choose colors for this workspace. Sign-in pages and other workspaces keep their own appearance.' : 'This workspace appearance is managed by its administrator.'}</p></div>
        <button className="button button-secondary" type="button" onClick={() => void chooseTheme('default')} disabled={loading || busy || !editable}>Use default color</button>
      </div>
      <div className={styles.themeGrid} role="group" aria-label="CRM color themes">
        {CRM_THEMES.map((option) => (
          <button
            className={`${styles.themeOption}${theme === option.id ? ` ${styles.themeSelected}` : ''}`}
            type="button"
            key={option.id}
            aria-pressed={theme === option.id}
            onClick={() => void chooseTheme(option.id)}
            disabled={loading || busy || !editable}
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
    <section className={styles.weekPreview} aria-labelledby="week-preview-heading">
      <div className={styles.weekPreviewHeading}><div><span className={styles.eyebrow}>WORK WEEK</span><h2 id="week-preview-heading">Your calendar starts on {weekdays[weekStartsOn]}</h2></div><span className={styles.weekBadge}>{weekdays[weekStartsOn].slice(0, 3)}</span></div>
      <div className={styles.weekDays}>{weekdays.map((_, offset) => {
        const index = (weekStartsOn + offset) % weekdays.length;
        return <button key={weekdays[index]} type="button" className={index === weekStartsOn ? styles.weekDaySelected : ''} aria-pressed={index === weekStartsOn} onClick={() => setWeekStartsOn(index)} disabled={loading || busy || !editable}>{weekdays[index].slice(0, 3)}</button>;
      })}</div>
      <p>Choose a starting day here or in preferences. Save changes to apply it to this workspace.</p>
    </section>
    </div>
  </section>;
}
