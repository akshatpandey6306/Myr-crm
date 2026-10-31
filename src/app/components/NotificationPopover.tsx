'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  activityId: string;
  readAt: string | null;
  createdAt: string;
};

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const message = result.error?.message ?? result.message;
  return typeof message === 'string' ? message : 'Something went wrong. Please try again.';
}

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  return formatter.format(Math.round(seconds / 86400), 'day');
}

export default function NotificationPopover() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await crmApiFetch('/notifications?limit=20', { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (active) {
          setNotifications(Array.isArray(payload.data) ? payload.data as Notification[] : []);
          setUnreadCount(Number(payload.meta?.unreadCount) || 0);
          setError('');
        }
      } catch (cause) {
        if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch')
          ? 'Could not reach notifications.'
          : cause instanceof Error ? cause.message : 'Could not load notifications.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [refresh]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  async function markRead(notification: Notification) {
    if (notification.readAt) return;
    setError('');
    try {
      const response = await crmApiFetch(`/notifications/${notification.id}/read`, { method: 'PATCH' });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark this notification as read.');
    }
  }

  async function markAllRead() {
    setError('');
    try {
      const response = await crmApiFetch('/notifications/read-all', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      setUnreadCount(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark notifications as read.');
    }
  }

  return (
    <div className="notification-root" ref={root}>
      <button className="icon-button notification-button" type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <svg aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>
        {unreadCount > 0 && <span />}
      </button>
      {open && <section className="notification-popover" aria-label="Notifications">
        <div className="notification-popover-head"><div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : 'You’re all caught up'}</span></div><button type="button" onClick={() => void markAllRead()} disabled={!unreadCount}>Mark all read</button></div>
        {error && <p className="notification-error" role="alert">{error}<button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
        <div className="notification-popover-list" aria-busy={loading}>
          {loading && <p className="notification-empty">Loading notifications...</p>}
          {!loading && !notifications.length && !error && <p className="notification-empty">No notifications yet.</p>}
          {!loading && notifications.map((item) => <button className={`notification-entry${item.readAt ? ' is-read' : ''}`} key={item.id} type="button" onClick={() => void markRead(item)} aria-label={`${item.readAt ? 'Read' : 'Mark read'}: ${item.title}`}>
            <span className="avatar avatar-green" aria-hidden="true">✓</span>
            <span className="notification-entry-copy"><span><strong>{item.title}</strong><br />{item.body}</span><small>{relativeTime(item.createdAt)}</small></span>
            {!item.readAt && <i aria-label="Unread" />}
          </button>)}
        </div>
        <div className="notification-popover-foot"><Link href="/activities" onClick={() => setOpen(false)}>View activities</Link></div>
      </section>}
    </div>
  );
}
