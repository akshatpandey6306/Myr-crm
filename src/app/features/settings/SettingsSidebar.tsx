'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

type SettingsModule = {
  label: string;
  href: string;
  icon: string;
  description: string;
};

const modules: SettingsModule[] = [
  { label: 'Company Settings', href: '/settings/company', icon: '🏢', description: 'Organization profile and settings' },
  { label: 'User & Employee', href: '/settings/users', icon: '👥', description: 'Manage team members and roles' },
  { label: 'Roles & Permissions', href: '/settings/roles', icon: '👑', description: 'Create and manage roles' },
  { label: 'Customer Settings', href: '/settings/customers', icon: '👨‍💼', description: 'Customer configuration' },
  { label: 'Lead Settings', href: '/settings/leads', icon: '🎯', description: 'Lead configuration' },
  { label: 'Sales & Deal', href: '/settings/sales', icon: '💰', description: 'Sales pipeline settings' },
  { label: 'Notification Settings', href: '/settings/notifications', icon: '🔔', description: 'Notification preferences' },
  { label: 'Task & Follow-up', href: '/settings/tasks', icon: '✅', description: 'Task management' },
  { label: 'Email & SMS', href: '/settings/email', icon: '📧', description: 'Communication settings' },
  { label: 'Invoice & Tax', href: '/settings/invoice', icon: '🧾', description: 'Billing and tax settings' },
  { label: 'General Settings', href: '/settings/general', icon: '⚙️', description: 'Application preferences' },
  { label: 'Data Management', href: '/settings/data', icon: '📦', description: 'Import/export and backups' },
  { label: 'Integrations', href: '/settings/integrations', icon: '🔗', description: 'Third-party integrations' },
  { label: 'Security Settings', href: '/settings/security', icon: '🔒', description: 'Security and access' },
  { label: 'Activity Logs', href: '/settings/logs', icon: '📜', description: 'Audit and activity logs' },
  { label: 'Custom Fields', href: '/settings/custom', icon: '⚙️', description: 'Custom field configuration' },
];

export default function SettingsSidebar({ activeModule }: { activeModule: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  return (
    <div className={`settings-sidebar${open ? ' is-open' : ''}`}>
      <button
        className="sidebar-toggle"
        type="button"
        aria-label="Open settings menu"
        onClick={() => setOpen((v) => !v)} 
      >
        <span /><span /><span />
      </button>

      {open && (
        <div className="sidebar-overlay" onClick={() => setOpen(false)}  />
      )} 

      <nav className="sidebar-nav">
        <ul>
          {modules.map((module) => (
            <li key={module.label}>
              <Link
                href={module.href}
                className={`nav-item${activeModule === module.label ? ' active' : ''}`}
                onClick={() => setOpen(false)} 
                aria-label={module.label}
              >
                <span className="nav-icon">{module.icon}</span>
                <span className="nav-label">{module.label}</span>
                <span className="nav-desc">{module.description}</span>
              </Link>
            </li>
          )}
</ul>
      </nav>

      <div className="sidebar-footer">
        <hr />
        <p className="sidebar-version">Myr CRM Settings</p>
      </div>
    </div>
  );
}
