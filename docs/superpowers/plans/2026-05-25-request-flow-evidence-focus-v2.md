# Request Flow Evidence Focus v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the likely-issue focus select and explain the primary suspect request across the existing HAR analyzer surfaces.

**Architecture:** Extend the pure request-flow scorer with confidence, reason labels, next-inspection hints, and secondary candidates. Compute the focus once in `HarTabContent`, auto-select the anchor once per HAR tab, and pass the same focus metadata into `RequestList`, `RequestDetails`, `RequestFlowDiagram`, and `RequestFlowGraphView`. Keep the feature inside existing analyzer UI with compact chips and subtle markers.

**Tech Stack:** React 18, TypeScript, Vitest, React Testing Library, existing HAR Analyzer CSS.

---

## File Structure

- Modify `src/utils/requestFlowFocus.ts`: add confidence, labels, summaries, next inspection, candidates.
- Modify `src/utils/__tests__/requestFlowFocus.test.ts`: assert confidence, labels, low-confidence wording signals, candidate ranking.
- Modify `src/components/HarTabContent.tsx`: compute focus, auto-select anchor once, pass focus props to analyzer surfaces.
- Modify `src/components/__tests__/HarTabContent.redwood.test.tsx`: cover one-time auto-selection and focus prop propagation.
- Modify `src/components/RequestList.tsx`: render compact row marker for the focused request.
- Modify `src/components/__tests__/RequestList.test.tsx`: cover row marker and manual click preservation.
- Modify `src/components/RequestDetails.tsx`: render focus summary and reason chips, initialize the detail tab from `nextInspection`.
- Create `src/components/__tests__/RequestDetails.test.tsx`: cover chips and next-inspection tab selection.
- Modify `src/components/RequestFlowDiagram.tsx`: accept optional shared focus metadata and use low-confidence wording.
- Modify `src/components/RequestFlowGraphView.tsx`: accept optional shared focus metadata and controlled focus-enabled state.
- Modify `src/components/RequestFlowNodes.tsx`: accept anchor label so low-confidence anchors can say `Worth checking`.
- Modify `src/components/__tests__/RequestFlowDiagram.test.tsx` and `src/components/__tests__/RequestFlowGraphView.test.tsx`: cover `Worth checking` and shared focus metadata.
- Modify `src/styles/globals.css`: add compact focus marker/chip styling for list, details, and existing flow views.

---

### Task 1: Extend Focus Scoring Metadata

**Files:**
- Modify: `src/utils/requestFlowFocus.ts`
- Test: `src/utils/__tests__/requestFlowFocus.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests asserting:

```ts
expect(focus).toMatchObject({
  confidence: 'high',
  nextInspection: 'response',
});
expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['HTTP 503', 'Terminal request']));
expect(focus?.summary).toContain('HTTP 503');
expect(focus?.candidates[0]).toMatchObject({ index: 1, confidence: 'high' });
```

Add a static asset case:

```ts
expect(focus?.confidence).toBe('low');
expect(focus?.reasonLabels).toEqual(expect.arrayContaining(['HTTP 404']));
```

- [ ] **Step 2: Run focused scorer tests**

Run:

```powershell
npx vitest run src/utils/__tests__/requestFlowFocus.test.ts
```

Expected: fail on missing `confidence`, `reasonLabels`, `nextInspection`, `summary`, and `candidates`.

- [ ] **Step 3: Implement metadata**

Add exported types `RequestFlowFocusConfidence`, `RequestFlowNextInspection`, and `RequestFlowFocusCandidate`.

Extend `RequestFlowFocusPath`:

```ts
confidence: RequestFlowFocusConfidence;
reasonLabels: string[];
nextInspection: RequestFlowNextInspection;
summary: string;
candidates: RequestFlowFocusCandidate[];
```

Add helpers:

```ts
function getConfidence(score: number, reasons: Set<RequestFlowFocusReason>, resourceType: string): RequestFlowFocusConfidence;
function getReasonLabels(entry: Entry, reasons: Iterable<RequestFlowFocusReason>): string[];
function getNextInspection(entry: Entry, reasons: Set<RequestFlowFocusReason>): RequestFlowNextInspection;
function buildFocusSummary(entry: Entry, labels: string[]): string;
```

- [ ] **Step 4: Run focused scorer tests**

Run:

```powershell
npx vitest run src/utils/__tests__/requestFlowFocus.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/utils/requestFlowFocus.ts src/utils/__tests__/requestFlowFocus.test.ts
git commit -m "feat: enrich request flow focus metadata"
```

---

### Task 2: Auto-Select And Propagate Focus From HAR Tab

**Files:**
- Modify: `src/components/HarTabContent.tsx`
- Test: `src/components/__tests__/HarTabContent.redwood.test.tsx`

- [ ] **Step 1: Add failing tests**

Update mocks to capture props for `RequestList`, `RequestDetails`, `RequestFlowDiagram`, and `RequestFlowGraphView`.

Add assertions:

```ts
await waitFor(() => {
  expect(mockHarState.setSelectedEntry).toHaveBeenCalledWith(mockHarState.harData.log.entries[1]);
});
expect(requestListMock).toHaveBeenLastCalledWith(expect.objectContaining({
  focusEntry: mockHarState.harData.log.entries[1],
}));
```

Add flow propagation assertion:

```ts
expect(requestFlowGraphViewMock).toHaveBeenLastCalledWith(expect.objectContaining({
  issueFocusPath: expect.objectContaining({ anchorIndex: 1 }),
  issueFocusEnabled: true,
}));
```

- [ ] **Step 2: Run HAR tab test**

Run:

```powershell
npx vitest run src/components/__tests__/HarTabContent.redwood.test.tsx
```

Expected: fail on missing focus props and auto-selection.

- [ ] **Step 3: Implement HAR tab focus orchestration**

In `HarTabContent.tsx`:

- import `analyzeRequestFlowFocus`;
- compute `requestFlowIssueFocus` from `flowSessionEntries`;
- add `issueFocusEnabled` state;
- add refs `autoSelectedFocusKeyRef` and `manualSelectionSuppressedRef`;
- auto-select `flowSessionEntries[focus.anchorIndex]` once when focus exists, no selected entry exists, and manual selection is not suppressed;
- wrap user selection in `selectEntryManually(entry)` which sets suppression before `harState.setSelectedEntry(entry)`;
- pass `focusEntry`, `focusPath`, and `issueFocusEnabled` props into child components.

- [ ] **Step 4: Run HAR tab test**

Run:

```powershell
npx vitest run src/components/__tests__/HarTabContent.redwood.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/HarTabContent.tsx src/components/__tests__/HarTabContent.redwood.test.tsx
git commit -m "feat: orchestrate request flow evidence focus"
```

---

### Task 3: Mark Focus In Request List And Details

**Files:**
- Modify: `src/components/RequestList.tsx`
- Modify: `src/components/RequestDetails.tsx`
- Create: `src/components/__tests__/RequestDetails.test.tsx`
- Test: `src/components/__tests__/RequestList.test.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add failing UI tests**

`RequestList` should render a row marker:

```ts
render(<RequestList entries={[entry]} selectedEntry={null} focusEntry={entry} focusPath={focusPath} onSelectEntry={noop} timingType="relative" />);
expect(screen.getByText('Likely issue')).toBeInTheDocument();
expect(screen.getByText('Likely issue').closest('.request-item')).toHaveClass('likely-issue');
```

`RequestDetails` should render chips:

```ts
render(<RequestDetails entry={entry} focusPath={focusPath} onClose={noop} />);
expect(screen.getByText('Likely issue')).toBeInTheDocument();
expect(screen.getByText('HTTP 503')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /response/i })).toHaveClass('active');
```

- [ ] **Step 2: Run UI tests**

Run:

```powershell
npx vitest run src/components/__tests__/RequestList.test.tsx src/components/__tests__/RequestDetails.test.tsx
```

Expected: fail on missing props and UI.

- [ ] **Step 3: Implement list/details markers**

Add optional props:

```ts
focusEntry?: Entry | null;
focusPath?: RequestFlowFocusPath | null;
```

Render `Likely issue` or `Worth checking` based on `focusPath.confidence`.

In details, map `nextInspection`:

```ts
response -> response
headers -> response headers
timings -> timing
preview -> response
general -> request
```

- [ ] **Step 4: Add CSS**

Add compact styles for `.request-item.likely-issue`, `.request-focus-pill`, `.request-focus-summary`, and `.request-focus-chip`.

- [ ] **Step 5: Run UI tests**

Run:

```powershell
npx vitest run src/components/__tests__/RequestList.test.tsx src/components/__tests__/RequestDetails.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add src/components/RequestList.tsx src/components/RequestDetails.tsx src/components/__tests__/RequestList.test.tsx src/components/__tests__/RequestDetails.test.tsx src/styles/globals.css
git commit -m "feat: show evidence focus in analyzer details"
```

---

### Task 4: Reuse Focus Metadata In Flow Views

**Files:**
- Modify: `src/components/RequestFlowDiagram.tsx`
- Modify: `src/components/RequestFlowGraphView.tsx`
- Modify: `src/components/RequestFlowNodes.tsx`
- Test: `src/components/__tests__/RequestFlowDiagram.test.tsx`
- Test: `src/components/__tests__/RequestFlowGraphView.test.tsx`

- [ ] **Step 1: Add failing tests**

Assert low-confidence wording:

```ts
expect(screen.getByText(/worth checking/i)).toBeInTheDocument();
```

Assert controlled graph checkbox calls `onIssueFocusEnabledChange(false)` when unchecked.

- [ ] **Step 2: Run flow tests**

Run:

```powershell
npx vitest run src/components/__tests__/RequestFlowDiagram.test.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: fail on missing props/wording.

- [ ] **Step 3: Implement shared metadata props**

Add optional props:

```ts
issueFocusPath?: RequestFlowFocusPath | null;
issueFocusEnabled?: boolean;
onIssueFocusEnabledChange?: (enabled: boolean) => void;
```

Use passed focus metadata when provided; otherwise keep current local scoring behavior for standalone tests.

- [ ] **Step 4: Run flow tests**

Run:

```powershell
npx vitest run src/components/__tests__/RequestFlowDiagram.test.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/RequestFlowDiagram.tsx src/components/RequestFlowGraphView.tsx src/components/RequestFlowNodes.tsx src/components/__tests__/RequestFlowDiagram.test.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
git commit -m "feat: share evidence focus in request flow views"
```

---

### Task 5: Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused suites**

```powershell
npx vitest run src/utils/__tests__/requestFlowFocus.test.ts src/components/__tests__/HarTabContent.redwood.test.tsx src/components/__tests__/RequestList.test.tsx src/components/__tests__/RequestDetails.test.tsx src/components/__tests__/RequestFlowDiagram.test.tsx src/components/__tests__/RequestFlowGraphView.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run full tests**

```powershell
npm run test
```

Expected: all Vitest suites pass.

- [ ] **Step 3: Run production build**

```powershell
npm run build
```

Expected: TypeScript and Vite build pass. Existing large chunk warning is acceptable.

- [ ] **Step 4: Commit final cleanup if needed**

Only if verification requires small fixes:

```powershell
git add src docs
git commit -m "fix: polish request flow evidence focus"
```
