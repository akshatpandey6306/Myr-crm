import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../../lib/api-client';
import ReportsManager from './ReportsManager';

vi.mock('../../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ReportsManager', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(jsonResponse({
      data: {
        generatedAt: '2026-10-30T12:00:00.000Z',
        metrics: {
          totalLeads: 3,
          openDeals: 2,
          openPipelineValue: '1250.50',
          wonRevenue: '700.00',
          openActivities: 1,
          completedActivities: 4,
        },
        leadsByStatus: [{ status: 'QUALIFIED', count: 3 }],
        dealsByStatus: [{ status: 'OPEN', count: 2, value: '1250.50' }],
        activitiesByStatus: [{ status: 'COMPLETED', count: 4 }],
      },
    }));
  });

  it('loads live workspace metrics and status breakdowns', async () => {
    render(<ReportsManager />);

    expect(await screen.findByText('$1,251')).toBeInTheDocument();
    expect(screen.getByText('Won revenue')).toBeInTheDocument();
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(screen.getByText('Deal outcomes')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith('/reports/summary', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('shows API errors instead of sample report data', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Reports unavailable' } }, 503));
    render(<ReportsManager />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Reports unavailable');
  });
});