'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function ActionMenu({ label, destination, copyText, buttonClass = 'more-button' }: { label: string; destination: string; copyText: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOutside(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return <div className="action-menu-root" ref={root}><button className={buttonClass} type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)}><svg aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg></button>{open && <div className="action-menu" role="menu"><Link href={destination} role="menuitem" onClick={() => setOpen(false)}>Open {destination === '/deals' ? 'deals' : 'activities'} <span>→</span></Link><button type="button" role="menuitem" onClick={copy}>{copied ? 'Copied to clipboard' : `Copy “${copyText}”`} <span>{copied ? '✓' : '⧉'}</span></button></div>}</div>;
}
