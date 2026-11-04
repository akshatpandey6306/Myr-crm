'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import MobileNavigation from '../../../components/MobileNavigation';
import DashboardLivePanels from '../../../components/DashboardLivePanels';

type SettingCategory = {
  id: string;
  name: string;
  organizationId: string;
};

type Setting = {
  id: string;
  key: string;
  value: any;
  settingCategory: {
    id: string;
    name: string;
    organizationId: string;
  } | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

const settingsModules = [
  { label: 'Company Settings', href: '/settings/company', icon: '🏢' },
  { label: 'User & Employee', href: '/settings/users', icon: '👥' },
  { label: 'Roles & Permissions', href: '/settings/roles', icon: '👑' },
  { label: 'Customer Settings', href: '/settings/customers', icon: '👨‍💼' },
  { label: 'Lead Settings', href: '/settings/leads', icon: '🎯' },
  { label: 'Sales & Deal', href: '/settings/sales', icon: '💰' },
  { label: 'Notification Settings', href: '/settings/notifications', icon: '🔔' },
  { label: 'Task & Follow-up', href: '/settings/tasks', icon: '✅' },
  { label: 'Email & SMS', href: '/settings/email', icon: '📧' },
  { label: 'Invoice & Tax', href: '/settings/invoice', icon: '🧾' },
  { label: 'General Settings', href: '/settings/general', icon: '⚙️' },
  { label: 'Data Management', href: '/settings/data', icon: '📦' },
  { label: 'Integrations', href: '/settings/integrations', icon: '🔗' },
  { label: 'Security Settings', href: '/settings/security', icon: '🔒' },
  { label: 'Activity Logs', href: '/settings/logs', icon: '📜' },
  { label: 'Custom Fields', href: '/settings/custom', icon: '⚙️' },
];

export default function SettingsDashboard() {
  const [categories, setCategories] = useState<SettingCategory[]>([]);
  const [settings, setSettings] = useState<Record<string, Setting[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        const categoriesResponse = await crmApiFetch('/settings/categories');
        setCategories(categoriesResponse as SettingCategory[]);
        
        const settingsResponse = await crmApiFetch('/settings');
        const settingsRecord: Record<string, Setting[]> = {};
        (settingsResponse as Setting[]).forEach(setting => {
          if (!settingsRecord[setting.settingCategoryId]) {
            settingsRecord[setting.settingCategoryId] = [];
          }
          settingsRecord[setting.settingCategoryId].push(setting);
        });
        setSettings(settingsRecord);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  if (loading) {
    return <div className="settings-loading">Loading settings...</div>;
  }

  if (error) {
    return <div className="settings-error">Error: {error}</div>;
  }

  return (
    <main className="settings-page">
      <MobileNavigation active="Settings" />
      
      <div className="settings-container">
        <aside className="settings-sidebar">
          <div className="sidebar-header">
            <h1>Myr CRM Settings</h1>
            <p className="sidebar-subtitle">Organization Configuration</p>
          </div>
          
          <nav className="settings-nav">
            {settingsModules.map((module) => (
              <Link
                key={module.label}
                href={module.href}
                className={`nav-item`}
                aria-label={module.label}
              >
                <span className="nav-icon">{module.icon}</span>
                <span className="nav-label">{module.label}</span>
                <span className="nav-count">•••</span>
              </Link>
            ))}
          </nav>
          
          <div className="sidebar-footer">
            <hr />
            <div className="footer-info">
              <p>Organization: Studio North</p>
              <p>Last updated: Just now</p>
            </div>
          </div>
        </aside>

        <main className="settings-main">
          <div className="breadcrumbs">
            <span>Settings</span>
          </div>
          
          <div className="settings-content">
            <div className="settings-overview" id="settings-overview">
              <h2>Settings Overview</h2>
              <p>Select a settings module from the sidebar to configure your CRM.</p>
              
              <div className="overview-cards">
                {settingsModules.map((module) => (
                  <div key={module.label} className="overview-card">
                    <div className="card-icon">{module.icon}</div>
                    <h3 className="card-title">{module.label}</h3>
                    <p className="card-description">Configure organization settings</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </main>
  );
}
