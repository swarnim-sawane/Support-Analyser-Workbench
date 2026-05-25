# Smart Request Flow Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Request Flow automatically guide engineers to the most likely issue path through in-canvas visual focus, without adding a new panel, modal, drawer, or AI text block.

**Architecture:** Add deterministic focus-path scoring as a pure utility, then feed that focus path into existing Journey Map and Scattered View components. Reuse current request-flow filters, node dimming, edge styling, and analyzer node-click behavior so the feature feels native to the current HAR shell.

**Tech Stack:** React 18, TypeScript, Vitest, React Testing Library, React Flow.

---

## File Structure

- Create `src/utils/requestFlowFocus.ts`: Pure scoring and focus-path construction from HAR entries.
- Create `src/utils/__tests__/requestFlowFocus.test.ts`: Unit coverage for failure, auth, CORS/blocked, slow, redirect, repeated endpoint, and healthy HAR cases.
- Modify `src/components/RequestFlowGraphView.tsx`: Consume focus path, default-enable issue focus, rename checkbox, apply glow/dim behavior, and auto-fit focused nodes once.
- Modify `src/components/RequestFlowDiagram.tsx`: Consume focus path and visually emphasize matching journey rows/zones without adding content blocks.
- Modify `src/components/RequestFlowNodes.tsx`: Add focus-anchor/path visual metadata to node rendering.
- Modify `src/components/__tests__/RequestFlowGraphView.test.tsx`: Update critical-path tests to likely-issue focus tests.
- Modify `src/components/__tests__/RequestFlowDiagram.test.tsx`: Add coverage for focus styling in Journey Map.
- Modify `src/components/__tests__/HarTabContent.redwood.test.tsx`: Keep existing Request Flow tab integration expectations aligned with the renamed control.

---

### Task 1: Add Focus-Path Scoring Utility

**Files:**
- Create: `src/utils/requestFlowFocus.ts`
- Test: `src/utils/__tests__/requestFlowFocus.test.ts`

- [ ] **Step 1: Write failing tests for deterministic focus scoring**

Create `src/utils/__tests__/requestFlowFocus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Entry } from '../../types/har';
import { analyzeRequestFlowFocus } from '../requestFlowFocus';

const makeEntry = (overrides: Partial<Entry> = {}): Entry => ({
  startedDateTime: '2026-05-25T10:00:00.000Z',
  time: 240,
  request: {
    method: 'GET',
    url: 'https://app.example.com/',
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
    content: { size: 1024, mimeType: 'text/html' },
    redirectURL: '',
    headersSize: 140,
    bodySize: 1024,
  },
  cache: {},
  timings: {
    blocked: 0,
    dns: 0,
    connect: 0,
    ssl: 0,
    send: 10,
    wait: 200,
    receive: 30,
  },
  ...overrides,
});

describe('analyzeRequestFlowFocus', () => {
  it('anchors on a terminal 5xx failure and includes the previous related request', () => {
    const entries = [
      makeEntry({ request: { ...makeEntry().request, url: 'https://app.example.com/page' } }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://app.example.com/api/checkout' },
        response: { ...makeEntry().response, status: 503, statusText: 'Service Unavailable' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus).toMatchObject({
      anchorIndex: 1,
      severity: 'critical',
    });
    expect(focus?.reasons).toEqual(expect.arrayContaining(['http-5xx', 'terminal-failure']));
    expect(focus?.nodeIndexes).toEqual(expect.arrayContaining([0, 1]));
  });

  it('weights auth failures above static asset failures', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://cdn.example.com/logo.png' },
        response: {
          ...makeEntry().response,
          status: 404,
          statusText: 'Not Found',
          content: { size: 0, mimeType: 'image/png' },
        },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://idcs.example.com/oauth2/v1/token' },
        response: { ...makeEntry().response, status: 401, statusText: 'Unauthorized' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(1);
    expect(focus?.reasons).toEqual(expect.arrayContaining(['http-4xx', 'auth-failure']));
  });

  it('detects blocked or CORS-like network evidence', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://api.example.com/ords/items' },
        response: { ...makeEntry().response, status: 0, statusText: 'CORS blocked' },
        time: 0,
        _error: 'blocked by CORS policy: No Access-Control-Allow-Origin header',
      } as Partial<Entry>),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(0);
    expect(focus?.severity).toBe('critical');
    expect(focus?.reasons).toEqual(expect.arrayContaining(['cors-or-blocked']));
  });

  it('uses slow p90 outliers when there are no failures', () => {
    const entries = [
      makeEntry({ time: 120 }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://app.example.com/api/report' },
        response: { ...makeEntry().response, content: { size: 2048, mimeType: 'application/json' } },
        time: 4600,
      }),
      makeEntry({ startedDateTime: '2026-05-25T10:00:02.000Z', time: 180 }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(1);
    expect(focus?.severity).toBe('warning');
    expect(focus?.reasons).toEqual(expect.arrayContaining(['slow-p90', 'slow-absolute']));
  });

  it('includes redirect predecessor before a failed target', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://app.example.com/login' },
        response: {
          ...makeEntry().response,
          status: 302,
          statusText: 'Found',
          redirectURL: 'https://idcs.example.com/login',
        },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://idcs.example.com/login' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.anchorIndex).toBe(1);
    expect(focus?.nodeIndexes).toEqual(expect.arrayContaining([0, 1]));
    expect(focus?.reasons).toEqual(expect.arrayContaining(['redirect-before-failure']));
  });

  it('detects repeated endpoint failures', () => {
    const entries = [
      makeEntry({
        request: { ...makeEntry().request, url: 'https://app.example.com/api/items?page=1' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
      makeEntry({
        startedDateTime: '2026-05-25T10:00:01.000Z',
        request: { ...makeEntry().request, url: 'https://app.example.com/api/items?page=2' },
        response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      }),
    ];

    const focus = analyzeRequestFlowFocus(entries);

    expect(focus?.reasons).toEqual(expect.arrayContaining(['repeated-endpoint']));
    expect(focus?.nodeIndexes).toEqual(expect.arrayContaining([0, 1]));
  });

  it('returns null for healthy small HARs', () => {
    const focus = analyzeRequestFlowFocus([
      makeEntry({ time: 120 }),
      makeEntry({ startedDateTime: '2026-05-25T10:00:01.000Z', time: 160 }),
    ]);

    expect(focus).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/utils/__tests__/requestFlowFocus.test.ts
```

Expected: FAIL because `src/utils/requestFlowFocus.ts` does not exist.

- [ ] **Step 3: Implement the focus utility**

Create `src/utils/requestFlowFocus.ts`:

```ts
import type { Entry } from '../types/har';

export type RequestFlowFocusReason =
  | 'http-5xx'
  | 'http-4xx'
  | 'auth-failure'
  | 'cors-or-blocked'
  | 'slow-p90'
  | 'slow-absolute'
  | 'redirect-before-failure'
  | 'repeated-endpoint'
  | 'terminal-failure';

export type RequestFlowFocusSeverity = 'critical' | 'warning' | 'notice';

export type RequestFlowFocusPath = {
  anchorIndex: number;
  nodeIndexes: number[];
  edgeKeys: string[];
  score: number;
  severity: RequestFlowFocusSeverity;
  reasons: RequestFlowFocusReason[];
};

type ScoredRequest = {
  index: number;
  entry: Entry;
  score: number;
  reasons: Set<RequestFlowFocusReason>;
};

const ABSOLUTE_SLOW_MS = 3000;
const MIN_FOCUS_SCORE = 30;
const HIGH_VALUE_TYPES = new Set(['document', 'xhr', 'fetch', 'other']);

export function analyzeRequestFlowFocus(entries: Entry[]): RequestFlowFocusPath | null {
  if (entries.length === 0) return null;

  const sortedIndexes = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => getStartTime(left.entry) - getStartTime(right.entry))
    .map(({ index }) => index);
  const p90 = percentile(entries.map((entry) => entry.time || 0), 0.9);
  const repeatedPaths = buildRepeatedPathCounts(entries);
  const scored = entries.map((entry, index) => scoreEntry(entry, index, p90, repeatedPaths));
  applyRelationshipSignals(entries, sortedIndexes, scored);

  const anchor = scored
    .filter((candidate) => candidate.score >= MIN_FOCUS_SCORE)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];

  if (!anchor) return null;

  const nodeIndexes = buildFocusNodeIndexes(entries, sortedIndexes, scored, anchor);
  const edgeKeys = buildEdgeKeys(nodeIndexes);
  const reasons = Array.from(anchor.reasons);

  return {
    anchorIndex: anchor.index,
    nodeIndexes,
    edgeKeys,
    score: anchor.score,
    severity: anchor.score >= 80 ? 'critical' : anchor.score >= 45 ? 'warning' : 'notice',
    reasons,
  };
}

function scoreEntry(
  entry: Entry,
  index: number,
  p90: number,
  repeatedPaths: Map<string, number>
): ScoredRequest {
  const reasons = new Set<RequestFlowFocusReason>();
  let score = 0;
  const status = entry.response.status;
  const resourceType = getResourceType(entry);
  const highValueMultiplier = HIGH_VALUE_TYPES.has(resourceType) ? 1.2 : 0.72;

  if (status >= 500) {
    score += 85 * highValueMultiplier;
    reasons.add('http-5xx');
  } else if (status >= 400) {
    score += 55 * highValueMultiplier;
    reasons.add('http-4xx');
  }

  if ([401, 403, 407, 419, 440].includes(status) || /oauth|sso|idcs|login|auth|token/i.test(entry.request.url)) {
    if (status >= 400) {
      score += 24;
      reasons.add('auth-failure');
    }
  }

  if (hasBlockedEvidence(entry)) {
    score += 80;
    reasons.add('cors-or-blocked');
  }

  if ((entry.time || 0) >= p90 && p90 > 0 && entriesHaveTimingSignal(p90, entry.time || 0)) {
    score += 22 * highValueMultiplier;
    reasons.add('slow-p90');
  }

  if ((entry.time || 0) >= ABSOLUTE_SLOW_MS) {
    score += 26 * highValueMultiplier;
    reasons.add('slow-absolute');
  }

  if (repeatedPaths.get(normalizeEndpoint(entry.request.url)) && status >= 400) {
    score += 18;
    reasons.add('repeated-endpoint');
  }

  return { index, entry, score, reasons };
}

function applyRelationshipSignals(entries: Entry[], sortedIndexes: number[], scored: ScoredRequest[]) {
  const scoredByIndex = new Map(scored.map((item) => [item.index, item]));

  sortedIndexes.forEach((entryIndex, sortedPosition) => {
    const entry = entries[entryIndex];
    const current = scoredByIndex.get(entryIndex);
    if (!current) return;

    const previousIndex = sortedIndexes[sortedPosition - 1];
    const previous = previousIndex === undefined ? undefined : entries[previousIndex];
    if (previous && isRedirect(previous) && current.score >= MIN_FOCUS_SCORE) {
      current.score += 12;
      current.reasons.add('redirect-before-failure');
    }

    const isLast = sortedPosition === sortedIndexes.length - 1;
    if (isLast && entry.response.status >= 400) {
      current.score += 10;
      current.reasons.add('terminal-failure');
    }
  });
}

function buildFocusNodeIndexes(
  entries: Entry[],
  sortedIndexes: number[],
  scored: ScoredRequest[],
  anchor: ScoredRequest
): number[] {
  const included = new Set<number>([anchor.index]);
  const sortedAnchorPosition = sortedIndexes.indexOf(anchor.index);
  const anchorEndpoint = normalizeEndpoint(anchor.entry.request.url);
  const anchorHost = getHost(anchor.entry.request.url);

  for (const neighborOffset of [-2, -1, 1, 2]) {
    const neighborIndex = sortedIndexes[sortedAnchorPosition + neighborOffset];
    if (neighborIndex === undefined) continue;

    const neighbor = entries[neighborIndex];
    const sameHost = getHost(neighbor.request.url) === anchorHost;
    const sameEndpoint = normalizeEndpoint(neighbor.request.url) === anchorEndpoint;
    const redirectRelated = isRedirect(neighbor) || isRedirect(anchor.entry);
    const nearInTime = Math.abs(getStartTime(neighbor) - getStartTime(anchor.entry)) <= 5000;

    if ((sameHost && nearInTime) || sameEndpoint || redirectRelated) {
      included.add(neighborIndex);
    }
  }

  scored.forEach((candidate) => {
    if (
      candidate.index !== anchor.index &&
      normalizeEndpoint(candidate.entry.request.url) === anchorEndpoint &&
      candidate.reasons.has('repeated-endpoint')
    ) {
      included.add(candidate.index);
    }
  });

  return Array.from(included).sort((left, right) => left - right);
}

function buildEdgeKeys(nodeIndexes: number[]): string[] {
  return nodeIndexes.slice(1).map((index, position) => `edge-${nodeIndexes[position]}-${index}`);
}

function buildRepeatedPathCounts(entries: Entry[]): Map<string, number> {
  const counts = new Map<string, number>();
  entries.forEach((entry) => {
    const key = normalizeEndpoint(entry.request.url);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return new Map(Array.from(counts.entries()).filter(([, count]) => count > 1));
}

function percentile(values: number[], ratio: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
}

function entriesHaveTimingSignal(p90: number, time: number): boolean {
  return p90 >= 1000 || time >= ABSOLUTE_SLOW_MS;
}

function getStartTime(entry: Entry): number {
  const time = new Date(entry.startedDateTime).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.split('?')[0].toLowerCase();
  }
}

function isRedirect(entry: Entry): boolean {
  return entry.response.status >= 300 && entry.response.status < 400 || Boolean(entry.response.redirectURL);
}

function hasBlockedEvidence(entry: Entry): boolean {
  const searchable = [
    entry.response.statusText,
    entry.response.redirectURL,
    entry.request.url,
    JSON.stringify((entry as Record<string, unknown>)._error ?? ''),
  ].join(' ');
  return entry.response.status === 0 || /\b(cors|blocked|failed|aborted|access-control-allow-origin)\b/i.test(searchable);
}

function getResourceType(entry: Entry): string {
  const explicit = (entry as Entry & { _resourceType?: string })._resourceType?.toLowerCase();
  if (explicit) return explicit;

  const mime = entry.response.content.mimeType?.toLowerCase() || '';
  const url = entry.request.url.toLowerCase();
  if (mime.includes('html')) return 'document';
  if (mime.includes('json') || mime.includes('xml') || /\/api\/|\/ords\//i.test(url)) return 'xhr';
  if (mime.includes('javascript') || url.endsWith('.js')) return 'script';
  if (mime.includes('css') || url.endsWith('.css')) return 'stylesheet';
  if (mime.includes('image') || /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(url)) return 'image';
  if (mime.includes('font') || /\.(woff2?|ttf|eot|otf)$/i.test(url)) return 'font';
  return 'other';
}
```

- [ ] **Step 4: Run focused utility tests**

Run:

```bash
npx vitest run src/utils/__tests__/requestFlowFocus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit utility and tests**

Run:

```bash
git add src/utils/requestFlowFocus.ts src/utils/__tests__/requestFlowFocus.test.ts
git commit -m "feat: add request flow focus scoring"
```

---

### Task 2: Apply Smart Focus In Scattered View

**Files:**
- Modify: `src/components/RequestFlowGraphView.tsx`
- Modify: `src/components/RequestFlowNodes.tsx`
- Test: `src/components/__tests__/RequestFlowGraphView.test.tsx`

- [ ] **Step 1: Update graph tests for automatic likely-issue focus**

Modify the React Flow mock in `src/components/__tests__/RequestFlowGraphView.test.tsx` so it exposes focused edge/node metadata:

```tsx
data-node-focus-anchor={String(Boolean(node.data?.isFocusAnchor))}
data-node-focus-path={String(Boolean(node.data?.isFocusPath))}
data-edge-focus-path={String(Boolean(edge.data?.isFocusPath))}
data-edge-style-stroke-width={edge.style?.strokeWidth === undefined ? 'unset' : String(edge.style.strokeWidth)}
```

Replace the test named `adds a checkbox to highlight the critical path` with:

```tsx
it('auto-focuses the likely issue path and can restore the normal graph', async () => {
  const user = userEvent.setup();
  const entries: Entry[] = [
    makeEntry({
      startedDateTime: '2026-04-21T10:30:00.000Z',
      request: { ...makeEntry().request, url: 'https://portal.example.com/dashboard' },
      response: {
        ...makeEntry().response,
        status: 200,
        content: { size: 2048, mimeType: 'text/html' },
      },
    }),
    makeEntry({
      startedDateTime: '2026-04-21T10:30:01.000Z',
      request: { ...makeEntry().request, url: 'https://portal.example.com/api/checkout' },
      response: {
        ...makeEntry().response,
        status: 503,
        statusText: 'Service Unavailable',
        content: { size: 512, mimeType: 'application/json' },
      },
      time: 5200,
    }),
    makeEntry({
      startedDateTime: '2026-04-21T10:30:02.000Z',
      request: { ...makeEntry().request, url: 'https://cdn.example.com/hero.png' },
      response: {
        ...makeEntry().response,
        status: 200,
        content: { size: 1024, mimeType: 'image/png' },
      },
    }),
  ];

  renderGraphView({ entries });

  const checkbox = screen.getByRole('checkbox', { name: /focus likely issue/i });
  expect(checkbox).toBeChecked();
  expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-focus-path'))).toEqual([
    'true',
    'true',
    'false',
  ]);
  expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-focus-anchor'))).toEqual([
    'false',
    'true',
    'false',
  ]);
  expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
    'false',
    'false',
    'true',
  ]);

  await user.click(checkbox);

  expect(checkbox).not.toBeChecked();
  expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
    'false',
    'false',
    'false',
  ]);
});
```

Add a no-focus regression:

```tsx
it('does not dim healthy graphs when no likely issue exists', () => {
  const entries = [
    makeEntry({ time: 120 }),
    makeEntry({ startedDateTime: '2026-04-21T10:30:01.000Z', time: 180 }),
  ];

  renderGraphView({ entries });

  expect(screen.queryByRole('checkbox', { name: /focus likely issue/i })).not.toBeChecked();
  expect(screen.getAllByTestId('react-flow-node').map((node) => node.getAttribute('data-node-dimmed'))).toEqual([
    'false',
    'false',
  ]);
});
```

- [ ] **Step 2: Run graph tests to verify failure**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: FAIL because the checkbox is still named `Highlight critical path` and focus metadata does not exist.

- [ ] **Step 3: Extend node payload rendering**

Modify `src/components/RequestFlowNodes.tsx`:

```ts
export interface RequestFlowNodePayload {
  type: string;
  status: number;
  method: string;
  url: string;
  time?: number;
  isSlow?: boolean;
  isCritical?: boolean;
  isDimmed?: boolean;
  isFocusPath?: boolean;
  isFocusAnchor?: boolean;
  focusSeverity?: 'critical' | 'warning' | 'notice';
  entryIndex: number;
  domainLabel?: string;
  productLabel?: string;
  traceRole?: 'root' | 'primary' | 'branch' | 'terminal';
  onClick?: () => void;
}
```

In `renderNode`, compute focus-specific styling before `boxShadow`:

```ts
const focusColor = data.focusSeverity === 'critical'
  ? '#ef4444'
  : data.focusSeverity === 'warning'
    ? '#f97316'
    : '#f59e0b';
const focusShadow = data.isFocusPath
  ? `0 0 0 ${data.isFocusAnchor ? 3 : 2}px ${focusColor}33, 0 10px 28px ${focusColor}26`
  : options.shadow;
const boxShadow = data.isCritical || data.isFocusPath
  ? `0 0 0 2px ${data.isFocusPath ? `${focusColor}55` : options.highlightRing}, ${focusShadow}`
  : options.shadow;
const borderColor = data.isFocusPath ? focusColor : options.accent;
```

Use `borderColor` in the root style:

```ts
border: `${data.isCritical || data.isFocusAnchor ? 2 : 1}px solid ${borderColor}`,
```

Add an inline badge when the node is the anchor:

```tsx
...(data.isFocusAnchor
  ? [{
      label: 'Likely issue',
      color: focusColor,
    }]
  : []),
```

- [ ] **Step 4: Wire focus path into Scattered View**

Modify imports in `src/components/RequestFlowGraphView.tsx`:

```ts
import { analyzeRequestFlowFocus, type RequestFlowFocusPath } from '../utils/requestFlowFocus';
```

Change `buildGraphElements` to compute and return the focus path:

```ts
const focusPath = analyzeRequestFlowFocus(entries);
```

Return it from `buildGraphElements`:

```ts
return {
  nodes,
  edges,
  criticalNodeIds: Array.from(criticalNodeIds),
  focusPath,
  totalRequests,
  failedCount,
  slowCount,
  successRate,
  p90: flowData.p90,
};
```

Replace local state:

```ts
const [focusLikelyIssue, setFocusLikelyIssue] = useState(true);
const reactFlowInstanceRef = useRef<{ fitView: (options?: unknown) => void } | null>(null);
const hasAutoFitFocusRef = useRef<string | null>(null);
```

After `graphModel` destructuring:

```ts
const focusPath = graphModel.focusPath as RequestFlowFocusPath | null;
const focusNodeIdSet = useMemo(
  () => new Set((focusPath?.nodeIndexes ?? []).map((index) => `request-${index}`)),
  [focusPath]
);
const focusAnchorNodeId = focusPath ? `request-${focusPath.anchorIndex}` : null;
```

Update rendered node mapping:

```ts
const isIssueFocused = focusLikelyIssue && Boolean(focusPath);
const isFocusPath = isIssueFocused && focusNodeIdSet.has(node.id);
const isFocusAnchor = isIssueFocused && node.id === focusAnchorNodeId;
const isCritical = isIssueFocused ? isFocusPath : highlightCriticalPath && criticalNodeIdSet.has(node.id);
const matchesFlowVisibility = focusedNodeIdSet.has(node.id);
const isDimmed = !matchesFlowVisibility || (isIssueFocused && !isFocusPath) || (!isIssueFocused && highlightCriticalPath && !isCritical);
```

Pass node data:

```ts
isCritical,
isDimmed,
isFocusPath,
isFocusAnchor,
focusSeverity: focusPath?.severity,
```

Update rendered edge mapping:

```ts
const edgeIsFocusPath =
  isIssueFocused &&
  focusNodeIdSet.has(edge.source) &&
  focusNodeIdSet.has(edge.target);
const shouldDim = shouldDimForFocus || (isIssueFocused && !edgeIsFocusPath) || (!isIssueFocused && shouldDimForCritical);
const focusStroke = focusPath?.severity === 'critical' ? '#ef4444' : '#f97316';
const edgeStroke = edgeIsFocusPath ? focusStroke : edgeStrokeFromExistingLogic;
```

Add edge metadata:

```ts
data: {
  ...(edge.data || {}),
  isFocusPath: edgeIsFocusPath,
},
```

Increase focused edge strength:

```ts
strokeWidth: edgeIsFocusPath
  ? Math.max(Number(baseStyle.strokeWidth ?? 1.2), 3)
  : existingStrokeWidth,
filter: edgeIsFocusPath ? `drop-shadow(0 0 7px ${focusStroke}66)` : undefined,
```

Add `onInit` to `ReactFlow`:

```tsx
onInit={(instance) => {
  reactFlowInstanceRef.current = instance;
}}
```

Add a guarded auto-fit effect:

```ts
useEffect(() => {
  if (!focusLikelyIssue || !focusPath || !reactFlowInstanceRef.current) return;
  const focusKey = `${focusPath.anchorIndex}:${focusPath.nodeIndexes.join(',')}`;
  if (hasAutoFitFocusRef.current === focusKey) return;
  hasAutoFitFocusRef.current = focusKey;
  window.requestAnimationFrame(() => {
    reactFlowInstanceRef.current?.fitView({
      nodes: focusPath.nodeIndexes.map((index) => ({ id: `request-${index}` })),
      padding: 0.28,
      maxZoom: 1.05,
      duration: 500,
    });
  });
}, [focusLikelyIssue, focusPath]);
```

Rename the checkbox in the summary panel:

```tsx
<label className={`request-flow-scattered-checkbox ${focusLikelyIssue && focusPath ? 'is-active' : ''}`}>
  <input
    type="checkbox"
    checked={focusLikelyIssue && Boolean(focusPath)}
    disabled={!focusPath}
    onChange={(event) => setFocusLikelyIssue(event.target.checked)}
  />
  <span>Focus likely issue</span>
</label>
```

- [ ] **Step 5: Run graph tests**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit scattered view focus**

Run:

```bash
git add src/components/RequestFlowGraphView.tsx src/components/RequestFlowNodes.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
git commit -m "feat: focus likely issue in request flow graph"
```

---

### Task 3: Apply Focus Styling In Journey Map

**Files:**
- Modify: `src/components/RequestFlowDiagram.tsx`
- Test: `src/components/__tests__/RequestFlowDiagram.test.tsx`

- [ ] **Step 1: Add Journey Map tests for focus emphasis**

In `src/components/__tests__/RequestFlowDiagram.test.tsx`, add:

```tsx
it('visually emphasizes likely issue requests without adding a report panel', () => {
  const entries = [
    makeEntry({
      request: { ...makeEntry().request, url: 'https://app.example.com/dashboard' },
      response: { ...makeEntry().response, status: 200 },
    }),
    makeEntry({
      startedDateTime: '2026-05-25T10:00:01.000Z',
      request: { ...makeEntry().request, url: 'https://app.example.com/api/save' },
      response: { ...makeEntry().response, status: 500, statusText: 'Server Error' },
      time: 4100,
    }),
  ];

  render(<RequestFlowDiagram entries={entries} />);

  expect(screen.getByText(/GET/).closest('.request-flow-request-row')).toBeInTheDocument();
  expect(document.querySelectorAll('.is-focus-path').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('.is-focus-anchor').length).toBe(1);
  expect(screen.queryByText(/likely issue/i)?.closest('.request-flow-request-row')).toBeTruthy();
});
```

- [ ] **Step 2: Run Journey Map test to verify failure**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowDiagram.test.tsx
```

Expected: FAIL because Journey Map does not consume `analyzeRequestFlowFocus`.

- [ ] **Step 3: Add focus path to Journey Map rows/zones**

In `src/components/RequestFlowDiagram.tsx`, import:

```ts
import { analyzeRequestFlowFocus } from '../utils/requestFlowFocus';
```

Inside the component, after `flowData`:

```ts
const focusPath = useMemo(() => analyzeRequestFlowFocus(entries), [entries]);
const focusNodeIndexSet = useMemo(
  () => new Set(focusPath?.nodeIndexes ?? []),
  [focusPath]
);
```

Where request rows are rendered, add class names:

```tsx
className={`request-flow-request-row tone-${statusTone} ${request.isSlow ? 'is-slow' : ''} ${request.failed ? 'is-error' : ''} ${focusNodeIndexSet.has(request.index) ? 'is-focus-path' : ''} ${focusPath?.anchorIndex === request.index ? 'is-focus-anchor' : ''}`}
```

Add a compact inline label only inside the focused request row metadata, not as a new card:

```tsx
{focusPath?.anchorIndex === request.index && (
  <span className="request-flow-request-flag">Likely issue</span>
)}
```

Where zone cards are rendered, add `is-focus-zone` if any zone request is in the focus path:

```ts
const isFocusZone = zone.requests.some((request) => focusNodeIndexSet.has(request.index));
```

Use:

```tsx
className={`request-flow-zone-card tone-${tone} ${collapsed ? 'is-collapsed' : ''} ${isFocusZone ? 'is-focus-zone' : ''}`}
```

- [ ] **Step 4: Add CSS for Journey Map focus styling**

Modify `src/styles/globals.css`:

```css
.request-flow-request-row.is-focus-path {
  border-color: rgba(249, 115, 22, 0.72);
  box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.22), 0 10px 24px rgba(249, 115, 22, 0.12);
}

.request-flow-request-row.is-focus-anchor {
  border-color: rgba(239, 68, 68, 0.82);
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2), 0 12px 28px rgba(239, 68, 68, 0.16);
}

.request-flow-zone-card.is-focus-zone {
  box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.16), var(--shadow-sm);
}
```

- [ ] **Step 5: Run Journey Map tests**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowDiagram.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Journey Map focus**

Run:

```bash
git add src/components/RequestFlowDiagram.tsx src/components/__tests__/RequestFlowDiagram.test.tsx src/styles/globals.css
git commit -m "feat: emphasize likely issue in journey map"
```

---

### Task 4: Update Integration Tests And Labels

**Files:**
- Modify: `src/components/__tests__/HarTabContent.redwood.test.tsx`
- Modify: `src/components/__tests__/RequestFlowGraphView.test.tsx`

- [ ] **Step 1: Update label expectations**

Replace any expectations for:

```ts
/highlight critical path/i
```

with:

```ts
/focus likely issue/i
```

Keep tests that verify the Request Flow toggle row exists and that Journey Map/Scattered View can switch without remounting.

- [ ] **Step 2: Run Request Flow related tests**

Run:

```bash
npx vitest run src/components/__tests__/HarTabContent.redwood.test.tsx src/components/__tests__/RequestFlowGraphView.test.tsx src/components/__tests__/RequestFlowDiagram.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit integration label updates**

Run:

```bash
git add src/components/__tests__/HarTabContent.redwood.test.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
git commit -m "test: update request flow focus expectations"
```

---

### Task 5: Full Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run full HAR frontend tests**

Run:

```bash
npm run test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass. Existing chunk-size warning is acceptable if unchanged.

- [ ] **Step 3: Manual browser verification**

Start local dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Verify with a HAR that has a clear failure:

- upload HAR;
- open `Request Flow`;
- confirm Scattered View automatically focuses the likely issue path;
- confirm unrelated requests remain visible but dimmed;
- confirm `Focus likely issue` toggle restores normal view when unchecked;
- confirm clicking focused nodes opens Analyzer details;
- confirm Journey Map also visually emphasizes the same likely issue;
- confirm Scorecard and AI Insights still scroll and render.

- [ ] **Step 4: Commit final cleanup if needed**

If manual verification requires small CSS/test cleanup:

```bash
git add src/components src/utils src/styles src/types
git commit -m "fix: polish request flow smart focus"
```

If no cleanup is needed, do not create an empty commit.

---

## Rollback Plan

To remove the feature after implementation:

```bash
git revert <commit-for-journey-map-focus> <commit-for-graph-focus> <commit-for-focus-utility>
```

The feature is isolated to Request Flow utility/view files, so reverting should not affect upload, backend, AI Diagnosis, sanitizer, compare, or recent-files flows.
