import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../lib/api-client';
import NotificationPopover from './NotificationPopover';

vi.mock('../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);
const notification = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  type: 'activity_assigned',
  title: 'Activity assigned to you',
  body: 'Prepare proposal',
  activityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  readAt: null,
  createdAt: '2026-10-30T12:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('NotificationPopover', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path) => {
      if (path === '/notifications?limit=20') return jsonResponse({ data: [notification], meta: { unreadCount: 1 } });
      if (path.endsWith('/read') || path === '/notifications/read-all') return jsonResponse({ ok: true });
      return jsonResponse({ error: { message: 'Unexpected request' } }, 404);
    });
  });

  it('loads personal notifications and marks an item as read', async () => {
    const user = userEvent.setup();
    render(<NotificationPopover />);

    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    expect(await screen.findByText('Prepare proposal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark read: Activity assigned to you' }));

    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith(`/notifications/${notification.id}/read`, { method: 'PATCH' });
  });
});