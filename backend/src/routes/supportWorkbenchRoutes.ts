import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { File, FormData, fetch } from 'undici';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_SUPPORT_WORKBENCH_API_URL = 'http://localhost:4317';

class SupportWorkbenchUnavailableError extends Error {
  constructor(
    public readonly supportWorkbenchApiUrl: string,
    public readonly cause: unknown
  ) {
    super('Support Workbench backend is not reachable');
    this.name = 'SupportWorkbenchUnavailableError';
  }
}

function supportWorkbenchApiUrl(): string {
  return (process.env.SUPPORT_WORKBENCH_API_URL || DEFAULT_SUPPORT_WORKBENCH_API_URL).replace(/\/$/, '');
}

function cookieHeader(req: Request): Record<string, string> {
  return typeof req.headers.cookie === 'string'
    ? { cookie: req.headers.cookie }
    : {};
}

function forwardSetCookie(response: Awaited<ReturnType<typeof fetch>>, res: Response) {
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    res.setHeader('set-cookie', setCookie);
  }
}

async function relayWorkbenchResponse(response: Awaited<ReturnType<typeof fetch>>, res: Response) {
  forwardSetCookie(response, res);

  const contentType = response.headers.get('content-type');
  if (contentType) {
    res.type(contentType);
  }

  const body = await response.text();
  res.status(response.status).send(body);
}

async function fetchSupportWorkbench(path: string, init: Parameters<typeof fetch>[1]) {
  const baseUrl = supportWorkbenchApiUrl();
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    throw new SupportWorkbenchUnavailableError(baseUrl, error);
  }
}

function handleSupportWorkbenchProxyError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof SupportWorkbenchUnavailableError) {
    res.status(503).json({
      error: error.message,
      supportWorkbenchApiUrl: error.supportWorkbenchApiUrl,
      hint: 'Start the Support Workbench backend or set SUPPORT_WORKBENCH_API_URL to the running AI Diagnosis backend.',
    });
    return;
  }

  next(error);
}

router.post('/session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await fetchSupportWorkbench('/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...cookieHeader(req),
      },
      body: JSON.stringify({
        cwd: typeof req.body?.cwd === 'string' ? req.body.cwd : undefined,
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
      }),
    });

    await relayWorkbenchResponse(response, res);
  } catch (error) {
    handleSupportWorkbenchProxyError(error, res, next);
  }
});

const uploadAttachments = upload.array('files');

router.post('/session/:sessionId/attachments', (req: Request, res: Response, next: NextFunction) => {
  uploadAttachments(req, res, (uploadError: unknown) => {
    if (uploadError) {
      next(uploadError);
      return;
    }

    void handleAttachmentUpload(req, res).catch((error) => handleSupportWorkbenchProxyError(error, res, next));
  });
});

async function handleAttachmentUpload(req: Request, res: Response) {
  const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
  if (files.length === 0) {
    res.status(400).json({ error: 'At least one attachment is required' });
    return;
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append(
      'files',
      new File([file.buffer], file.originalname, {
        type: file.mimetype || 'application/octet-stream',
      })
    );
  }

  const response = await fetchSupportWorkbench(`/api/session/${encodeURIComponent(req.params.sessionId)}/attachments`, {
    method: 'POST',
    headers: cookieHeader(req),
    body: formData,
  });

  await relayWorkbenchResponse(response, res);
}

export default router;
