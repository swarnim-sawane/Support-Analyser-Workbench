import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FloatingAiChat from '../FloatingAiChat';
import { makeHarFile } from '../../test-utils/fixtures';

const originalFetch = global.fetch;

describe('FloatingAiChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    }
  });

  it('runs a suggested query immediately instead of only filling the input', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/status')) {
        return {
          ok: true,
          json: async () => ({ connected: true }),
        } as Response;
      }

      return {
        ok: true,
        body: null,
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<FloatingAiChat harData={makeHarFile()} />);

    await user.click(screen.getByRole('button', { name: /ai assistant/i }));

    const suggestedQuery = 'Are there any 5xx server errors? What is the root cause?';
    await user.click(screen.getByRole('button', { name: suggestedQuery }));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/chat'));
      expect(chatCall).toBeDefined();
      expect(JSON.parse(String(chatCall?.[1]?.body)).messages).toEqual([
        { role: 'user', content: suggestedQuery },
      ]);
    });

    expect(screen.getByPlaceholderText(/ask about this har file/i)).toHaveValue('');
  });
});
