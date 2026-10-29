'use client';

import { useEffect, useRef, useState } from 'react';

const initialNotifications = [
  { id: 'n1', initials: 'MC', name: 'Maya Chen', text: 'moved Northstar Labs to Proposal', time: '12 min ago', tone: 'blue' },
  { id: 'n2', initials: 'JL', name: 'Jordan Lee', text: 'added a new lead, Olivia Rhye', time: '48 min ago', tone: 'purple' },
  { id: 'n3', initials: 'AM', name: 'Alex Morgan', text: 'completed a call with Greenway Co.', time: '2 hours ago', tone: 'green' },
];

export default function NotificationPopover() {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const unread = initialNotifications.filter((item) => !read.includes(item.id)).length;

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

  return (
    <div className="notification-root" ref={root}>
      <button className="icon-button notification-button" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <svg aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span />}
      </button>
      {open && <section className="notification-popover" aria-label="Notifications"><div className="notification-popover-head"><div><strong>Notifications</strong><span>{unread ? `${unread} unread` : 'You’re all caught up'}</span></div><button type="button" onClick={() => setRead(initialNotifications.map((item) => item.id))} disabled={!unread}>Mark all read</button></div><div className="notification-popover-list">{initialNotifications.map((item) => {
        const isRead = read.includes(item.id);
        return <button className={`notification-entry${isRead ? ' is-read' : ''}`} key={item.id} type="button" onClick={() => setRead((current) => current.includes(item.id) ? current : [...current, item.id])}><span className={`avatar avatar-${item.tone}`}>{item.initials}</span><span className="notification-entry-copy"><span><strong>{item.name}</strong> {item.text}</span><small>{item.time}</small></span>{!isRead && <i aria-label="Unread" />}</button>;
      })}</div><div className="notification-popover-foot">Preview activity · Sample data</div></section>}
    </div>
  );
}
