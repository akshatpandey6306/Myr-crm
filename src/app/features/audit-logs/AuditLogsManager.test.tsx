import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../../lib/api-client';
import AuditLogsManager from './AuditLogsManager';

vi.mock('../../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AuditLogsManager', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(jsonResponse({
      data: [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        action: 'create',
        resourceType: 'leads',
        resourceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        actorUserId: '11111111-1111-4111-8111-111111111111',
        actorName: 'Alex Morgan',
        createdAt: '2026-10-30T12:00:00.000Z',
      }],
      meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    }));
  });

  it('loads the organization audit history', async () => {
    render(<AuditLogsManager />);

    expect(await screen.findByText('Alex Morgan')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith('/audit-logs?page=1&pageSize=25', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('shows manager authorization errors from the API', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Only organization managers can view audit history' } }, 403));
    render(<AuditLogsManager />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Only organization managers');
  });
});