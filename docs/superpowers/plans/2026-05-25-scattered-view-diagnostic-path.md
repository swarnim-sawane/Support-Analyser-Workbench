# Scattered View Diagnostic Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Request Flow Scattered View guide engineers to the first suspect request, readable issue path, and useful controls without adding a new panel or workflow.

**Architecture:** Keep the existing ReactFlow graph. Derive display-only diagnostic metadata from `RequestFlowFocusPath`, pass it to existing node payloads, and replace scattered floating panels with one compact diagnostic toolbar inside the graph canvas.

**Tech Stack:** React, TypeScript, ReactFlow, Vitest, Testing Library, existing HAR Analyzer CSS tokens.

---

## File Structure

- Modify: `src/components/RequestFlowGraphView.tsx`
  - Build diagnostic toolbar.
  - Derive focus path step numbers and primary focus reasons.
  - Pass focus display metadata into graph nodes.
  - Remove separate legend and summary panels from Scattered View.

- Modify: `src/components/RequestFlowNodes.tsx`
  - Render compact path step badges.
  - Render `Start here` only on focus anchor.
  - Render one subtle focus reason on the anchor.

- Modify: `src/styles/globals.css`
  - Style compact toolbar, status chips, focus toggle, step badge, start marker, and focus reason.
  - Keep light/dark/Redwood contrast clean.

- Modify: `src/components/__tests__/RequestFlowGraphView.test.tsx`
  - Verify compact toolbar controls.
  - Verify focus path metadata reaches nodes.
  - Verify focus issue toggle still disables focus styling.

---

### Task 1: Add Diagnostic Toolbar Tests

**Files:**
- Modify: `src/components/__tests__/RequestFlowGraphView.test.tsx`

- [ ] **Step 1: Add failing test for compact toolbar replacing scattered panels**

Add this test in the `RequestFlowGraphView` describe block:

```tsx
it('renders a compact diagnostic toolbar instead of separate legend and summary panels', () => {
  renderGraph();

  expect(screen.getByLabelText(/scattered view diagnostic controls/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /errors/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /slow/i })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /focus issue/i })).toBeInTheDocument();
  expect(screen.getByText(/shown/i)).toBeInTheDocument();
  expect(screen.queryByText('Legend')).not.toBeInTheDocument();
  expect(screen.queryByText('Request Flow Summary')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: FAIL because the compact diagnostic toolbar does not exist yet and the old panels still render.

- [ ] **Step 3: Implement toolbar markup**

In `RequestFlowGraphView.tsx`, replace the three `Panel` blocks for filters, legend, and summary with a single top-left panel:

```tsx
<Panel position="top-left">
  <div className="request-flow-diagnostic-toolbar" aria-label="Scattered view diagnostic controls">
    <div className="request-flow-diagnostic-toolbar-row">
      <div className="request-flow-diagnostic-focus-list" aria-label="Request Flow focus">
        {FOCUS_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            className={`request-flow-diagnostic-chip ${focusMode === option.mode ? 'is-active' : ''}`}
            aria-pressed={focusMode === option.mode}
            onClick={() => onFocusModeChange(option.mode)}
          >
            <span aria-hidden="true">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>

      <label
        className={`request-flow-diagnostic-focus-toggle ${focusLikelyIssueActive && focusPath ? 'is-active' : ''}`}
      >
        <input
          type="checkbox"
          checked={focusLikelyIssueActive && Boolean(focusPath)}
          disabled={!focusPath}
          onChange={(event) => handleIssueFocusToggle(event.target.checked)}
        />
        <span>Focus issue</span>
      </label>
    </div>

    <div className="request-flow-diagnostic-toolbar-row">
      <div className="request-flow-diagnostic-status-list" aria-label="Status filters">
        {STATUS_FILTERS.map((item) => (
          <label key={item.code} className="request-flow-diagnostic-status-chip">
            <input
              type="checkbox"
              checked={filters.statusCodes[item.code]}
              onChange={() => handleStatusCodeChange(item.code)}
            />
            <span className={`status-badge status-${item.code}`}>{item.label}</span>
          </label>
        ))}
      </div>

      <div className="request-flow-diagnostic-count">
        <strong>{focusedRequestCount}</strong> / {totalRequests} shown
      </div>
    </div>

    <label className="request-flow-diagnostic-search" htmlFor={searchInputId}>
      <SearchIcon />
      <input
        id={searchInputId}
        type="search"
        value={filters.searchTerm}
        placeholder="Search URL, status, headers..."
        onChange={handleSearchTermChange}
      />
    </label>
  </div>
</Panel>
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: PASS for the new toolbar test or fail only on styling-independent metadata still planned in later tasks.

- [ ] **Step 5: Commit**

```bash
git add src/components/RequestFlowGraphView.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
git commit -m "feat: compact scattered view controls"
```

---

### Task 2: Add Diagnostic Path Metadata Tests

**Files:**
- Modify: `src/components/__tests__/RequestFlowGraphView.test.tsx`
- Modify: `src/components/RequestFlowGraphView.tsx`
- Modify: `src/components/RequestFlowNodes.tsx`

- [ ] **Step 1: Extend ReactFlow node test mock assertions**

In the existing ReactFlow mock node rendering, add these data attributes:

```tsx
data-node-focus-step={node.data?.focusStep ?? ''}
data-node-start-here={String(Boolean(node.data?.isFocusAnchor))}
data-node-focus-reason={node.data?.focusReason ?? ''}
```

- [ ] **Step 2: Add failing test for ordered path metadata**

Add this test:

```tsx
it('marks the diagnostic path with ordered start metadata and focus reason', () => {
  renderGraph({
    issueFocusPath: makeFocusPath({
      nodeIndexes: [0, 1],
      anchorIndex: 1,
      reasonLabels: ['HTTP 500', 'Failed after redirect'],
    }),
    issueFocusEnabled: true,
  });

  const nodes = screen.getAllByTestId('react-flow-node');

  expect(nodes.map((node) => node.getAttribute('data-node-focus-step'))).toEqual(['2', '1', '']);
  expect(nodes.map((node) => node.getAttribute('data-node-start-here'))).toEqual(['false', 'true', 'false']);
  expect(nodes[1]).toHaveAttribute('data-node-focus-reason', 'HTTP 500');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: FAIL because `focusStep` and `focusReason` are not yet part of the node payload.

- [ ] **Step 4: Extend node payload type**

In `RequestFlowNodes.tsx`, extend `RequestFlowNodePayload`:

```ts
focusStep?: number;
focusReason?: string;
```

- [ ] **Step 5: Derive focus path step map and primary reason**

In `RequestFlowGraphView.tsx`, add this memo near `focusAnchorNodeId`:

```tsx
const focusStepByNodeId = useMemo(() => {
  const steps = new Map<string, number>();
  if (!focusPath) return steps;

  const orderedIndexes = [
    focusPath.anchorIndex,
    ...focusPath.nodeIndexes.filter((index) => index !== focusPath.anchorIndex),
  ];

  orderedIndexes.forEach((index, pathIndex) => {
    steps.set(`request-${index}`, pathIndex + 1);
  });

  return steps;
}, [focusPath]);

const focusPrimaryReason = focusPath?.reasonLabels[0] ?? focusPath?.summary ?? '';
```

Then pass these values inside `renderedNodes`:

```tsx
focusStep: isFocusPath ? focusStepByNodeId.get(node.id) : undefined,
focusReason: isFocusAnchor ? focusPrimaryReason : undefined,
```

Update the `renderedNodes` memo dependency list to include `focusStepByNodeId` and `focusPrimaryReason`.

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/RequestFlowGraphView.tsx src/components/RequestFlowNodes.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
git commit -m "feat: add scattered diagnostic path metadata"
```

---

### Task 3: Render Productive Node Visuals

**Files:**
- Modify: `src/components/RequestFlowNodes.tsx`
- Modify: `src/styles/globals.css`
- Modify: `src/components/__tests__/RequestFlowGraphView.test.tsx`

- [ ] **Step 1: Add failing assertion for visible diagnostic labels**

Add assertions to the path metadata test:

```tsx
expect(screen.getByText('Start here')).toBeInTheDocument();
expect(screen.getByText('HTTP 500')).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: FAIL because the node does not render `Start here` or `focusReason`.

- [ ] **Step 3: Render step badge, start label, and reason**

In `RequestFlowNodes.tsx`, inside `renderNode`, render a compact top marker before the existing type/status row:

```tsx
{data.isFocusPath && (
  <div className="request-flow-node-diagnostic-row">
    {data.focusStep && (
      <span className="request-flow-node-step-badge">{data.focusStep}</span>
    )}
    {data.isFocusAnchor && (
      <span className="request-flow-node-start-label">Start here</span>
    )}
    {data.isFocusAnchor && data.focusReason && (
      <span className="request-flow-node-reason" title={data.focusReason}>{data.focusReason}</span>
    )}
  </div>
)}
```

Keep the existing `Likely issue` / `Worth checking` badge in the card header.

- [ ] **Step 4: Add CSS for node diagnostic metadata**

In `globals.css`, add:

```css
.request-flow-node-diagnostic-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-bottom: 8px;
}

.request-flow-node-step-badge {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #111827;
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.request-flow-node-start-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #111827;
}

.request-flow-node-reason {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 650;
  color: var(--text-secondary);
}
```

Add dark theme overrides:

```css
html[data-theme='dark'] .request-flow-node-step-badge {
  background: #f8fafc;
  color: #020617;
}

html[data-theme='dark'] .request-flow-node-start-label {
  color: #f8fafc;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/RequestFlowNodes.tsx src/styles/globals.css src/components/__tests__/RequestFlowGraphView.test.tsx
git commit -m "feat: show scattered diagnostic path cues"
```

---

### Task 4: Style Compact Diagnostic Toolbar

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add toolbar CSS**

Add styles near existing scattered view styles:

```css
.request-flow-diagnostic-toolbar {
  width: min(720px, calc(100vw - 48px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}

.request-flow-diagnostic-toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.request-flow-diagnostic-focus-list,
.request-flow-diagnostic-status-list {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.request-flow-diagnostic-chip,
.request-flow-diagnostic-focus-toggle {
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.request-flow-diagnostic-chip svg {
  width: 14px;
  height: 14px;
}

.request-flow-diagnostic-chip:hover,
.request-flow-diagnostic-chip.is-active,
.request-flow-diagnostic-focus-toggle.is-active {
  border-color: rgba(17, 24, 39, 0.32);
  background: rgba(17, 24, 39, 0.06);
  color: var(--text-primary);
}

.request-flow-diagnostic-focus-toggle input,
.request-flow-diagnostic-status-chip input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: #111827;
  cursor: pointer;
}

.request-flow-diagnostic-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.request-flow-diagnostic-status-chip .status-badge {
  height: 24px;
  min-width: 40px;
  padding: 3px 8px;
  font-size: 11px;
}

.request-flow-diagnostic-status-chip input:not(:checked) + .status-badge {
  opacity: 0.46;
  filter: grayscale(0.4);
}

.request-flow-diagnostic-count {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.request-flow-diagnostic-count strong {
  color: var(--text-primary);
}

.request-flow-diagnostic-search {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}

.request-flow-diagnostic-search svg {
  width: 14px;
  height: 14px;
}

.request-flow-diagnostic-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  letter-spacing: 0;
}

html[data-theme='dark'] .request-flow-diagnostic-toolbar {
  background: rgba(2, 6, 23, 0.94);
  border-color: rgba(148, 163, 184, 0.18);
}

html[data-theme='dark'] .request-flow-diagnostic-chip:hover,
html[data-theme='dark'] .request-flow-diagnostic-chip.is-active,
html[data-theme='dark'] .request-flow-diagnostic-focus-toggle.is-active {
  border-color: rgba(248, 250, 252, 0.28);
  background: rgba(248, 250, 252, 0.08);
}
```

- [ ] **Step 2: Remove obsolete scattered panel CSS only if unused by Scattered View**

Do not delete shared `.request-flow-scattered-panel` styles because `RequestFlowTraceView` still uses them. Leave legacy styles unless they visibly conflict.

- [ ] **Step 3: Run focused test**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css
git commit -m "style: refine scattered diagnostic toolbar"
```

---

### Task 5: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run focused graph tests**

Run:

```bash
npx vitest run src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run related focus tests**

Run:

```bash
npx vitest run src/utils/__tests__/requestFlowFocus.test.ts src/components/__tests__/HarTabContent.redwood.test.tsx src/components/__tests__/RequestFlowDiagram.test.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: build succeeds. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Commit any verification-only test adjustments if needed**

If verification required small test selector updates, commit them:

```bash
git add src/components/__tests__/RequestFlowGraphView.test.tsx
git commit -m "test: cover scattered diagnostic path"
```

If no edits were made, do not create an empty commit.

---

## Self-Review

- Spec coverage:
  - Start point: Task 2 and Task 3.
  - Follow path: Task 2 and Task 3.
  - Compact controls: Task 1 and Task 4.
  - No new panel/window: Task 1 replaces existing floating panels with one toolbar inside the same graph.
  - Existing interactions: Task 1 preserves filters/search/toggle; Task 5 verifies regressions.

- Placeholder scan:
  - No placeholder markers remain in the actionable steps.
  - Each implementation step names exact files and code shape.

- Type consistency:
  - `focusStep` and `focusReason` are added to `RequestFlowNodePayload`.
  - `focusStepByNodeId` keys match existing `request-${index}` node IDs.
  - Toolbar uses existing `FOCUS_OPTIONS`, `STATUS_FILTERS`, and handlers.
