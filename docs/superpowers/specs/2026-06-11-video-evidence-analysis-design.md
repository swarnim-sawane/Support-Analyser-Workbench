# Video Evidence Analysis Design

## Purpose

Support engineers often receive Zoom recordings when a customer cannot fully explain an issue with HAR files, logs, screenshots, or documents. Existing Zoom AI summaries mostly capture the conversation, but they miss the most important support evidence: what appeared on screen, which buttons were clicked, which page was open, what error banner appeared, and when the failure happened.

Video Evidence Analysis turns uploaded call recordings into timestamped support evidence. The MVP is not a generic video summarizer. It is a case-analysis pipeline that extracts audio and visual signals from an uploaded recording, creates an evidence timeline, and hands a compact evidence packet to AI Diagnosis for cross-file reasoning.

## MVP Scope

The MVP supports uploaded recordings after the call. Live Zoom integration, real-time screen capture, meeting bot attendance, and calendar/Zoom API integration are out of scope.

Supported input types for the MVP:

- `.mp4`
- `.mov`
- `.webm`
- `.mkv`

The first version should optimize for one-hour support recordings, but it should degrade gracefully for shorter clips and oversized recordings.

## Product Behavior

When a user uploads a video through the unified uploader, the file opens as a first-class Visual Analysis tab named **Video Evidence**.

The upload should not immediately run expensive AI analysis. Instead, the app performs a cheap preparation pass and shows:

- video duration
- file size
- resolution when available
- first preview thumbnail
- status: **Preparing video** then **Ready for evidence analysis**
- a prominent **Analyze Video Evidence** button

After the user clicks **Analyze Video Evidence**, the app runs the expensive evidence pipeline and streams progress states:

- **Extracting transcript**
- **Finding screen changes**
- **Reading key screens**
- **Building evidence timeline**
- **Preparing AI Diagnosis evidence**

The final output is a timestamped evidence timeline. Each event should include:

- timestamp or time range
- short event title
- event type: navigation, user action, visible error, loading state, dialog, form state, environment clue, or notable statement
- visible UI evidence
- transcript snippet when relevant
- frame thumbnail or keyframe reference
- confidence level

Example events:

- `05:12 - User opens Integration page`
- `05:38 - Error banner appears: ORA-xxxxx`
- `06:02 - Save button remains disabled`
- `06:21 - Customer says the issue started after patching`

## Architecture

### Frontend

Add a new analyzer kind: `video`.

The frontend should classify video files by extension and media type, then open a `VideoEvidenceAnalyzer` tab. This tab owns the visual review UI:

- video metadata header
- video preview player or thumbnail strip
- preparation status
- Analyze Video Evidence action
- progress timeline while processing
- evidence timeline after processing
- AI Diagnosis sync status

The existing case file model should treat video like other analyzer files so it appears in the shared file count and workspace state.

### Backend

Add video-specific backend routes and worker job handling rather than trying to process video in the browser.

Proposed API surface:

- `POST /api/video/:fileId/analyze`
- `GET /api/video/:fileId/status`
- `GET /api/video/:fileId/evidence`
- `GET /api/video/:fileId/keyframes/:frameId`

The existing chunked upload pipeline should accept video files, persist the original upload, and register a processing job. Initial preparation can be one job; AI evidence analysis can be a second explicit job triggered by the Analyze button.

Upload contract for MVP:

- unified uploader classifies the file as `video`
- chunked uploader sends it with file type `video`
- backend stores the original file and returns a normal `UploadResult` with a `fileId`
- frontend opens `VideoEvidenceAnalyzer` with that `fileId`
- worker starts the cheap preparation job automatically
- `POST /api/video/:fileId/analyze` starts the expensive AI evidence job

### Worker

The worker should handle video preprocessing and AI evidence analysis in bounded stages:

1. Probe metadata: duration, resolution, container, streams.
2. Extract a thumbnail.
3. Extract audio track if present.
4. Generate transcript with timestamps.
5. Detect keyframes using scene changes plus fallback sampling.
6. Batch selected keyframes for vision analysis.
7. Merge transcript and visual observations into a timeline.
8. Create a compact AI Diagnosis evidence packet.

The pipeline should not analyze every frame. It should use intelligent preprocessing to keep speed and AI cost under control.

### Processing Tools

The preferred low-level tool is `ffmpeg`/`ffprobe`, invoked by the backend worker. Because VM package installation is constrained, deployment must either:

- use an already available system `ffmpeg`, or
- ship a compatible binary/artifact with the local build package, or
- make video analysis disabled with a clear "ffmpeg not configured" state.

The MVP should detect capability at startup and expose it in health/status responses.

## AI Usage

The AI should receive structured context, not a raw one-hour video.

Inputs to AI vision:

- selected keyframes
- timestamp for each frame
- nearby transcript snippet
- prompt asking for visible UI state, user actions, errors, environment identifiers, dialogs, disabled controls, loading loops, and suspicious mismatch between spoken description and visual evidence

Inputs to AI Diagnosis:

- compact timeline
- transcript summary
- selected keyframe references
- extracted visible errors and identifiers
- source video metadata

AI Diagnosis remains responsible for cross-file reasoning with HAR, logs, screenshots, PDFs, and docs. The video analyzer only extracts and structures evidence.

## Data Model

Create a persisted video evidence record keyed by `fileId`.

Suggested shape:

```ts
type VideoEvidenceRecord = {
  fileId: string;
  fileName: string;
  status: 'preparing' | 'ready' | 'analyzing' | 'complete' | 'error';
  metadata: {
    durationMs: number;
    width?: number;
    height?: number;
    container?: string;
    hasAudio: boolean;
  };
  thumbnail?: {
    frameId: string;
    timestampMs: number;
  };
  transcript: Array<{
    startMs: number;
    endMs: number;
    text: string;
  }>;
  keyframes: Array<{
    frameId: string;
    timestampMs: number;
    reason: 'thumbnail' | 'scene-change' | 'fallback-sample' | 'error-candidate';
    imagePath: string;
  }>;
  events: Array<{
    id: string;
    startMs: number;
    endMs?: number;
    type: 'navigation' | 'action' | 'error' | 'loading' | 'dialog' | 'form-state' | 'environment' | 'statement' | 'other';
    title: string;
    evidence: string;
    transcriptSnippet?: string;
    frameIds: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;
  aiDiagnosisPacket?: {
    summary: string;
    markdown: string;
    attachmentName: string;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
};
```

For MVP, MongoDB storage can follow the existing evidence-storage pattern. Large binary frames should be stored on disk under the processed/runtime directory and referenced by id/path from Mongo.

## UI Design

The Video Evidence tab should be task-focused and dense, not a marketing-style page.

Primary layout:

- top header with filename, duration, status, and Analyze button
- left or top video preview/keyframe strip
- main evidence timeline
- right details panel for the selected event

Timeline event cards should be clickable. Clicking an event should:

- seek video preview to timestamp when the video element is available
- highlight associated keyframes
- show transcript and visual evidence in the details panel

The completed state should include an **Open in AI Diagnosis** or **Send Evidence to AI Diagnosis** action if sync did not happen automatically.

## Error Handling

Expected failures and UI behavior:

- unsupported video type: show unsupported-file analyzer with explanation
- ffmpeg unavailable: show "Video preparation is not configured on this deployment"
- no audio track: continue with visual-only analysis
- transcript failure: continue with keyframe-only analysis
- vision model failure: keep transcript/keyframes and show partial timeline
- oversized file: accept upload if chunked upload supports it, but show analysis limit if duration/size exceeds configured maximum
- AI Diagnosis sync failure: keep local video evidence and show retry action

AI/tool failures must not erase prepared evidence. The user should always get the best available partial result with clear status.

## Performance and Limits

Initial recommended MVP limits:

- maximum upload handled by chunked uploader: reuse current upload limits
- maximum video duration for AI pass: 90 minutes
- scene-change frames capped at 120
- fallback sample every 30 seconds, capped at 120
- total AI vision frames per analysis capped at 80 for MVP
- transcript chunks batched by timestamp windows

The UI should show when frames were skipped due to limits.

## Security and Privacy

Video recordings may contain customer-sensitive data. The MVP must treat video as sensitive evidence.

Requirements:

- do not expose keyframes through public/static unauthenticated paths
- use existing backend routes to serve keyframes by file/session context
- keep artifacts under runtime/processed storage, not in source directories
- avoid sending all frames to AI
- document that users should sanitize or approve customer evidence before broad sharing

## Testing Strategy

Unit tests:

- video file classification
- video tab registration and file count behavior
- Analyze button state transitions
- API client handling for video status/evidence responses
- worker pipeline stage orchestration using mocked ffmpeg and AI calls
- partial failure behavior

Integration tests:

- upload small synthetic video fixture
- prepare metadata and thumbnail
- run analysis with mocked transcript and vision response
- verify timeline rendering and AI Diagnosis handoff packet

Browser QA:

- upload video opens Video Evidence tab
- Analyze button launches progress states
- completed timeline is readable at desktop and smaller viewports
- clicking timeline event updates detail panel

## Rollout Plan

This work stays on `feature/video-evidence-analysis` until the MVP is usable end to end.

Recommended implementation order:

1. Add video file classification and basic Video Evidence tab shell.
2. Add backend status/evidence routes and placeholder preparation state.
3. Add worker-side metadata probing and thumbnail extraction.
4. Add frontend timeline UI with mocked evidence.
5. Add transcript/keyframe extraction pipeline.
6. Add AI vision batching and timeline merge.
7. Add AI Diagnosis evidence packet handoff.
8. Add deployment capability detection for `ffmpeg`.

## Explicit Non-Goals

- No live Zoom meeting bot.
- No real-time screen recording.
- No automatic root cause claim from video alone.
- No frame-by-frame full video AI analysis.
- No external Zoom API dependency in MVP.
