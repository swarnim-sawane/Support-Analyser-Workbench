import React from 'react';
import { render, screen } from '@testing-library/react';
import RequestDetails from '../RequestDetails';
import type { Entry } from '../../types/har';
import type { RequestFlowFocusPath } from '../../utils/requestFlowFocus';

const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-03-18T06:17:56.461Z',
  time: 4200,
  request: {
    method: 'POST',
    url: 'https://example.com/api/save',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [{ name: 'Accept', value: 'application/json' }],
    queryString: [],
    headersSize: 200,
    bodySize: 1024,
  },
  response: {
    status: 503,
    statusText: 'Service Unavailable',
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    content: { size: 2048, mimeType: 'application/json', text: '{"error":"down"}' },
    redirectURL: '',
    headersSize: 100,
    bodySize: 2048,
  },
  cache: {},
  timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 10, wait: 4100, receive: 90 },
  ...overrides,
});

const makeFocusPath = (overrides: Partial<RequestFlowFocusPath> = {}): RequestFlowFocusPath => ({
  anchorIndex: 0,
  nodeIndexes: [0],
  edgeKeys: [],
  score: 120,
  severity: 'critical',
  confidence: 'high',
  reasons: ['http-5xx', 'terminal-failure'],
  reasonLabels: ['HTTP 503', 'Terminal request'],
  nextInspection: 'response',
  summary: 'HTTP 503, Terminal request on /api/save',
  candidates: [],
  ...overrides,
});

describe('RequestDetails evidence focus', () => {
  it('shows compact focus summary chips and opens the hinted detail tab', () => {
    render(
      <RequestDetails
        entry={makeEntry()}
        focusPath={makeFocusPath()}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Likely issue')).toBeInTheDocument();
    expect(screen.getByText('HTTP 503')).toBeInTheDocument();
    expect(screen.getByText('Terminal request')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503, Terminal request on \/api\/save/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Response' })).toHaveClass('active');
  });

  it('uses softer wording for low-confidence focus metadata', () => {
    render(
      <RequestDetails
        entry={makeEntry({
          request: { ...makeEntry().request, url: 'https://cdn.example.com/logo.png' },
          response: {
            ...makeEntry().response,
            status: 404,
            statusText: 'Not Found',
            content: { size: 0, mimeType: 'image/png' },
          },
        })}
        focusPath={makeFocusPath({
          confidence: 'low',
          severity: 'notice',
          reasons: ['http-4xx'],
          reasonLabels: ['HTTP 404'],
          nextInspection: 'general',
          summary: 'HTTP 404 on /logo.png',
        })}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Worth checking')).toBeInTheDocument();
    expect(screen.queryByText('Likely issue')).not.toBeInTheDocument();
  });
});
