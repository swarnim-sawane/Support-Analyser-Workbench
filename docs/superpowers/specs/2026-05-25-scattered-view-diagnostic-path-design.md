# Scattered View Diagnostic Path Design

## Summary

Improve Request Flow Scattered View so it behaves like a productive diagnostic surface instead of a broad network map. The view should immediately answer three support-engineering questions:

1. Where should I start?
2. What request chain should I follow?
3. Which controls matter right now?

This is not a new tab, panel, report, or separate workflow. It is a visual refinement of the existing Scattered View using the focus metadata already produced by Request Flow Evidence Focus v2.

## Problem

The current Scattered View shows the request graph and highlights the likely issue, but it still feels unintuitive because:

- The engineer's eye does not always land on the best starting point.
- The issue chain is not readable enough as a sequence.
- Floating filters, legend, summary, minimap, and graph controls compete with the graph.

The result is a view that technically contains the right information but still requires the engineer to interpret too much before acting.

## Product Principle

Every visual treatment in this change must reduce diagnostic effort. If a UI element does not help the engineer decide what to inspect next, it should be collapsed, softened, or removed.

## Goals

- Make the likely issue node the obvious starting point without creating a gimmicky spotlight effect.
- Make the focus path read like a directional inspection chain.
- Reduce competing chrome while preserving filtering and graph navigation.
- Keep the existing ReactFlow implementation and current analyzer integration.
- Preserve click-through from graph nodes to request details.
- Work in light, dark, and Redwood themes.

## Non-Goals

- No new window, modal, drawer, side panel, or report surface.
- No new AI-generated explanation block.
- No full custom graph engine replacement.
- No change to the underlying request scoring algorithm unless implementation exposes a small missing field needed for display.
- No removal of existing analyzer filters.

## Recommended Design

### 1. Start Here Treatment

When a focus path exists and issue focus is enabled, the anchor node becomes the starting point.

The anchor node should show:

- A compact `Start here` label.
- The existing confidence label: `Likely issue` or `Worth checking`.
- A short evidence reason derived from existing focus metadata, such as the first one or two reason labels.
- A subtle local emphasis using border, shadow, and a non-intrusive background halo.

The graph auto-fit should center the focus path with enough surrounding context, not zoom out to the full graph.

### 2. Follow This Path Treatment

The focus path should read as a sequence.

Path nodes should receive small step badges:

- Anchor node: `1`
- Next path node: `2`
- Next path node: `3`

If the path has more than a few nodes, the sequence still applies, but badges must remain compact and not dominate the card.

Path edges should:

- Use stronger contrast than non-path edges.
- Keep directional arrows visible.
- Use a modest animated or highlighted state only when it improves readability.

Non-path nodes should remain present but visually quieter. They should not disappear, because support engineers may need surrounding context.

### 3. Compact Controls

Replace the current scattered set of floating panels with a compact top-left diagnostic toolbar.

The toolbar should include:

- Focus chips: `All`, `Errors`, `Slow`.
- Status chips: `0`, `1xx`, `2xx`, `3xx`, `4xx`, `5xx`.
- Search input or compact search affordance.
- `Focus issue` toggle.
- Minimal count text, such as `17 / 82 shown`.

The current separate legend panel should be removed or hidden by default. Node colors are useful but secondary; the primary reading model is the diagnostic path.

The current separate summary panel should be reduced into compact metrics inside the toolbar only if the values are useful for triage:

- total requests
- failed count
- slow count

The minimap and ReactFlow controls may remain, but they should be visually lighter and positioned so they do not compete with the diagnostic toolbar.

## Interaction Model

- Opening Scattered View with a focus path enabled auto-fits to the focus path once.
- Clicking any node opens the existing analyzer request details.
- Toggling `Focus issue` off restores normal graph emphasis without changing analyzer filters.
- Changing `All / Errors / Slow` still dims nonmatching graph nodes without mutating HAR table filters.
- Status chips and search continue to update the existing shared filters.
- Manual pan/zoom must remain available.

## Visual Language

The design should feel like the HAR Analyzer product shell:

- Black/white enterprise theme, restrained accent usage.
- No colorful decorative background.
- No heavy cards floating over the graph.
- No nested app feeling.
- Smooth 150-300ms transitions only where state changes need clarity.

The focus effect should feel precise, not theatrical. The goal is "inspect this first", not "celebrate this node".

## Data Requirements

Reuse `RequestFlowFocusPath` fields already added in Evidence Focus v2:

- `anchorIndex`
- `nodeIndexes`
- `confidence`
- `severity`
- `reasonLabels`
- `summary`
- `nextInspection`

Implementation may derive display-only values from these fields:

- path step number
- primary reason label
- focus label text

No new backend API is required.

## Components

Likely touched components:

- `RequestFlowGraphView.tsx`
  - consolidate panels into compact toolbar
  - pass path step and focus reason metadata into nodes
  - tune auto-fit behavior
  - tune edge emphasis and dimming

- `RequestFlowNodes.tsx`
  - render compact step badge
  - render `Start here` label for anchor node
  - render primary focus reason in a subtle way
  - keep node cards compact

- `globals.css`
  - toolbar styling
  - focus path styling
  - dark/Redwood theme refinements

- `RequestFlowGraphView.test.tsx`
  - verify toolbar controls
  - verify path step metadata
  - verify focus toggle still works

## Acceptance Criteria

- A user opening Scattered View can visually identify the first request to inspect within one second.
- The focus path reads as an ordered chain, not just a group of highlighted nodes.
- The graph has less floating chrome than before.
- Existing filters, search, focus mode, focus issue toggle, minimap, zoom controls, and node click-through still work.
- Light, dark, and Redwood themes do not show blue haze, overlapping panels, or low-contrast controls.
- No new major screen area is introduced.

## Test Plan

- Unit/component tests:
  - Scattered View renders compact diagnostic toolbar.
  - Focus path nodes receive step metadata.
  - Anchor node receives start-here metadata.
  - Low-confidence focus still uses `Worth checking`.
  - `Focus issue` toggle disables focus styling.
  - `All / Errors / Slow` filtering still dims nonmatching nodes.
  - Status chips and search still call `onFiltersChange`.

- Regression checks:
  - HAR upload still opens visual analysis.
  - Journey Map still receives shared focus metadata.
  - Request list/details focus behavior still works.
  - Existing full test suite and production build pass.

## Risks

- Too much emphasis could make the graph feel gimmicky. Keep focus visuals restrained.
- Too much dimming could hide context. Keep non-path nodes visible.
- Toolbar compaction could make filters harder to discover. Keep labels clear and use familiar chip controls.
- ReactFlow fit behavior can be sensitive. Limit auto-fit to first focus-path render and preserve manual navigation after that.

## Decision

Proceed with Diagnostic Path Mode as an in-place Scattered View refinement.

The implementation should prioritize support-engineer productivity over visual novelty.
