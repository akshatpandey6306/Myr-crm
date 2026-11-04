'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { Card, Button, Input, Select, Table, TableHeader, TableRow, TableCell } from '../../../components/ui';

type Permission = { id: string; name: string; key: string; category: string };
type Role = { id: string; name: string; key: string; permissions: Permission[]; isDefault: boolean };

export default function RolesManager() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const r = await crmApiFetch('/settings/roles');
        const p = await crmApiFetch('/settings/permissions');
        setRoles(r as Role[]);
        setPermissions(p as Permission[]);
      } catch (e) { setError((e as Error).message); }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <span>Loading...</span>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <main className="settings-page">
      <div className="settings-container">
        <aside className="settings-sidebar">
          <h2>Roles & Permissions</h2>
        </aside>
        <section className="settings-main">
          <div className="breadcrumbs">
            <span>Roles</span>
          </div>
          <div className="settings-content">
            <h1>Roles & Permissions</h1>
            <p>Create and manage custom roles with module-wise permissions</p>
            <p>No roles found. Create a new role to get started.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
