'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import { Button, Input, Select } from '../components/ui';
import { Table, TableHeader, TableRow, TableCell } from '../components/ui/table';
import { Card } from '../components/ui/card';
import { useContext } from 'react';
import { AuthContext } from '../../../app/context/AuthContext';

type User = { id: string; name: string; email: string; role: string; status: string };
type Membership = { id: string; role: string; status: string; user: { id: string; name: string; email: string } };

export default function UsersManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { organizationId, organizationRole } = useContext(AuthContext);

  useEffect(() => {
    async function load() {
      try {
        const [u, m] = await Promise.all([
          crmApiFetch(`/settings/users?orgId=${organizationId}`),
          crmApiFetch(`/settings/users?orgId=${organizationId}`),
        ]);
        setUsers(u.data.users as User[]);
        setMemberships(m.data.memberships as Membership[]);
      } catch (e) { setError((e as Error).message); }
      setLoading(false);
    }
    load();
  }, [organizationId]);

  if (loading) return <span>Loading...</span>;
  if (error) return <div className="error">Error: {error}</div>;

  const canEdit = organizationRole && ['owner', 'admin'].includes(organizationRole);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete user?')) return;
    try {
      await crmApiFetch(`/settings/users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', userId: id }),
      });
      setUsers(users => users.filter(x => x.id !== id));
      alert('User deleted!');
    } catch (e) { alert('Failed to delete user'); }
  };

  let usersContent;
  if (users.length === 0) {
    usersContent = <p>No users found.</p>;
  } else {
    usersContent = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Role</TableCell>
            <TableCell />
          </TableRow>
        </TableHeader>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell>{u.name}</TableCell>
            <TableCell>{u.email}</TableCell>
            <TableCell>{u.role}</TableCell>
            <TableCell>
              <Button variant="ghost" size="small" onClick={() => handleDelete(u.id)}>
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Table>
    );
  }

  return (
    <main className="settings-page">
      <div className="settings-container">
        <aside className="settings-sidebar">
          <h2>Users</h2>
        </aside>
        <div className="settings-main">
          <div className="breadcrumbs">
            <span>Users</span>
          </div>
          <div className="settings-content">
            <h1>User Management</h1>
            {canEdit && (
              <form onSubmit={(e) => { e.preventDefault(); }} className="setting-form">
                <input defaultValue="New User" readOnly />
                <Button type="submit">Add User</Button>
                <Button type="button">Cancel</Button>
              </form>
            )}
            {usersContent}
          </div>
        </div>
      </div>
    </main>
  );
}
