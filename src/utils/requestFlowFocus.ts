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

  return {
    anchorIndex: anchor.index,
    nodeIndexes,
    edgeKeys: buildEdgeKeys(nodeIndexes),
    score: anchor.score,
    severity: anchor.score >= 80 ? 'critical' : anchor.score >= 45 ? 'warning' : 'notice',
    reasons: Array.from(anchor.reasons),
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

  if (repeatedPaths.has(normalizeEndpoint(entry.request.url)) && status >= 400) {
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
  return (entry.response.status >= 300 && entry.response.status < 400) || Boolean(entry.response.redirectURL);
}

function hasBlockedEvidence(entry: Entry): boolean {
  const diagnosticError = (entry as Entry & { _error?: unknown })._error;
  const searchable = [
    entry.response.statusText,
    entry.response.redirectURL,
    entry.request.url,
    JSON.stringify(diagnosticError ?? ''),
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
