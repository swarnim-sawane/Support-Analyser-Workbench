import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RequestFlowDiagram from '../RequestFlowDiagram';
import { Entry, FilterOptions } from '../../types/har';
import type { RequestFlowFocusPath } from '../../utils/requestFlowFocus';

const buildEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-04-21T10:30:00.000Z',
  time: 320,
  request: {
    method: 'GET',
    url: 'https://portal.example.com/api/default',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: 120,
    bodySize: 0,
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    content: {
      size: 256,
      mimeType: 'application/json',
    },
    redirectURL: '',
    headersSize: 140,
    bodySize: 256,
  },
  cache: {},
  timings: {
    blocked: 10,
    dns: 15,
    connect: 20,
    ssl: 0,
    send: 5,
    wait: 220,
    receive: 50,
  },
  ...overrides,
});

const defaultFilters: FilterOptions = {
  statusCodes: {
    '0': false,
    '1xx': false,
    '2xx': true,
    '3xx': true,
    '4xx': true,
    '5xx': true,
  },
  searchTerm: '',
  timingType: 'relative',
};

const makeFocusPath = (overrides: Partial<RequestFlowFocusPath> = {}): RequestFlowFocusPath => ({
  anchorIndex: 0,
  nodeIndexes: [0],
  edgeKeys: [],
  score: 36,
  severity: 'notice',
  confidence: 'low',
  reasons: ['http-4xx'],
  reasonLabels: ['HTTP 404'],
  nextInspection: 'general',
  summary: 'HTTP 404 on /logo.png',
  candidates: [],
  ...overrides,
});

describe('RequestFlowDiagram', () => {
  it('keeps domain zones visible when an external request filter narrows visible rows', () => {
    const portalEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/app',
      },
    });
    const authErrorEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://idcs.example.com/favicon.ico',
      },
      response: {
        ...buildEntry().response,
        status: 401,
        statusText: 'Unauthorized',
      },
    });
    const staticEntry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://static.example.com/app.js',
      },
      response: {
        ...buildEntry().response,
        content: {
          size: 1024,
          mimeType: 'application/javascript',
        },
      },
    });

    render(
      <RequestFlowDiagram
        entries={[portalEntry, authErrorEntry, staticEntry]}
        visibleEntries={[authErrorEntry]}
      />
    );

    expect(screen.getAllByText('portal.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('idcs.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('static.example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('/favicon.ico')).toBeInTheDocument();
    expect(screen.queryByText('/app')).not.toBeInTheDocument();
    expect(screen.queryByText('/app.js')).not.toBeInTheDocument();
    expect(screen.getAllByText(/no requests match the current filters/i)).toHaveLength(2);
  });

  it('shows fetch-based 5xx requests in the zone body', () => {
    const entry = buildEntry({
      time: 710,
      request: {
        ...buildEntry().request,
        method: 'POST',
        url: 'https://portal.example.com/api/orders',
      },
      response: {
        ...buildEntry().response,
        status: 504,
        statusText: 'Gateway Timeout',
      },
    });

    (entry as Entry & { _resourceType: string })._resourceType = 'fetch';

    render(<RequestFlowDiagram entries={[entry]} />);

    expect(screen.queryByText(/no requests match the current filters/i)).not.toBeInTheDocument();
    expect(screen.getByText('/api/orders')).toBeInTheDocument();
  });

  it('shows fetch-based 1xx requests in the zone body', () => {
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/api/progress',
      },
      response: {
        ...buildEntry().response,
        status: 103,
        statusText: 'Early Hints',
      },
    });

    (entry as Entry & { _resourceType: string })._resourceType = 'fetch';

    render(<RequestFlowDiagram entries={[entry]} />);

    expect(screen.queryByText(/no requests match the current filters/i)).not.toBeInTheDocument();
    expect(screen.getByText('/api/progress')).toBeInTheDocument();
  });

  it('visually emphasizes likely issue requests without adding a report panel', () => {
    const entries = [
      buildEntry({
        request: {
          ...buildEntry().request,
          url: 'https://app.example.com/dashboard',
        },
        response: {
          ...buildEntry().response,
          status: 200,
        },
      }),
      buildEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: {
          ...buildEntry().request,
          url: 'https://app.example.com/api/save',
        },
        response: {
          ...buildEntry().response,
          status: 500,
          statusText: 'Server Error',
        },
        time: 4100,
      }),
    ];

    render(<RequestFlowDiagram entries={entries} />);

    expect(screen.getAllByText(/GET/)[0].closest('.request-flow-request-row')).toBeInTheDocument();
    expect(document.querySelectorAll('.is-focus-path').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.is-focus-anchor').length).toBe(1);
    expect(screen.queryByText(/likely issue/i)?.closest('.request-flow-request-row')).toBeTruthy();
    expect(screen.queryByText(/root cause/i)).not.toBeInTheDocument();
  });

  it('uses worth-checking wording for low-confidence shared focus metadata', () => {
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://cdn.example.com/logo.png',
      },
      response: {
        ...buildEntry().response,
        status: 404,
        statusText: 'Not Found',
        content: { size: 0, mimeType: 'image/png' },
      },
    });

    render(
      <RequestFlowDiagram
        entries={[entry]}
        issueFocusPath={makeFocusPath()}
        issueFocusEnabled
      />
    );

    expect(screen.getByText('Worth checking')).toBeInTheDocument();
    expect(screen.queryByText('Likely issue')).not.toBeInTheDocument();
  });

  it('renders a shared request filter panel and forwards status and search changes', () => {
    const onFiltersChange = vi.fn();
    const entry = buildEntry({
      request: {
        ...buildEntry().request,
        url: 'https://portal.example.com/api/orders',
      },
    });

    render(
      <RequestFlowDiagram
        entries={[entry]}
        visibleEntries={[entry]}
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
      />
    );

    expect(screen.getByText('Request Filters')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /4xx/i }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      statusCodes: {
        ...defaultFilters.statusCodes,
        '4xx': false,
      },
    });

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'oraclecloud' },
    });
    expect(onFiltersChange).toHaveBeenCalledWith({ searchTerm: 'oraclecloud' });
  });
});
