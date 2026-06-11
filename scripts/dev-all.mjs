import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm' : 'npm';
const supportWorkbenchDirConfig = resolveSupportWorkbenchDir();
const supportWorkbenchDevCommand = process.env.SUPPORT_WORKBENCH_DEV_COMMAND;
const supportWorkbenchBackendCommand = process.env.SUPPORT_WORKBENCH_BACKEND_COMMAND || 'npm run dev:backend';
const supportWorkbenchFrontendCommand = process.env.SUPPORT_WORKBENCH_FRONTEND_COMMAND || 'npm run dev:frontend';

const services = [
  {
    name: 'frontend',
    color: '\x1b[36m',
    cwd: rootDir,
    args: ['run', 'dev'],
  },
  {
    name: 'backend',
    color: '\x1b[35m',
    cwd: path.join(rootDir, 'backend'),
    args: ['run', 'dev'],
  },
  {
    name: 'worker',
    color: '\x1b[33m',
    cwd: path.join(rootDir, 'backend'),
    args: ['run', 'dev:worker'],
  },
];

if (supportWorkbenchDirConfig) {
  if (!existsSync(supportWorkbenchDirConfig.dir)) {
    process.stderr.write(`\x1b[31m[dev:all]\x1b[0m SUPPORT_WORKBENCH_DIR does not exist: ${supportWorkbenchDirConfig.dir}\n`);
    process.exit(1);
  }

  process.stdout.write(`\x1b[2m[dev:all]\x1b[0m Starting AI Diagnosis from ${supportWorkbenchDirConfig.dir} (${supportWorkbenchDirConfig.source}).\n`);

  if (supportWorkbenchDevCommand) {
    services.push({
      name: 'ai-diagnosis',
      color: '\x1b[32m',
      cwd: supportWorkbenchDirConfig.dir,
      command: supportWorkbenchDevCommand,
      args: [],
    });
  } else {
    services.push(
      {
        name: 'ai-diagnosis-backend',
        color: '\x1b[32m',
        cwd: supportWorkbenchDirConfig.dir,
        command: supportWorkbenchBackendCommand,
        args: [],
      },
      {
        name: 'ai-diagnosis-frontend',
        color: '\x1b[92m',
        cwd: supportWorkbenchDirConfig.dir,
        command: supportWorkbenchFrontendCommand,
        args: [],
      },
    );
  }
} else {
  process.stdout.write([
    '\x1b[2m[dev:all]\x1b[0m AI Diagnosis is embedded from Support Workbench and is not started by default.',
    '\x1b[2m[dev:all]\x1b[0m Start it separately on localhost:4173/4317, or set SUPPORT_WORKBENCH_DIR to its local repo path.',
    '\x1b[2m[dev:all]\x1b[0m Example: $env:SUPPORT_WORKBENCH_DIR="C:\\Users\\ssawane\\Documents\\Work\\claude-code"; npm run dev:all',
    '',
  ].join('\n'));
}

const reset = '\x1b[0m';
const children = new Set();
let shuttingDown = false;

for (const service of services) {
  const usesShellCommand = Boolean(service.command) || isWindows;
  const command = service.command || (isWindows ? `${npmCommand} ${service.args.join(' ')}` : npmCommand);
  const args = usesShellCommand ? [] : service.args;
  const child = spawn(command, args, {
    cwd: service.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: usesShellCommand,
    windowsHide: true,
  });

  children.add(child);
  prefixStream(child.stdout, service);
  prefixStream(child.stderr, service);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    process.stderr.write(`${service.color}[${service.name}]${reset} stopped with ${reason}\n`);
    shutdown(code && code > 0 ? code : 1);
  });

  child.on('error', (error) => {
    children.delete(child);
    process.stderr.write(`${service.color}[${service.name}]${reset} failed to start: ${error.message}\n`);
    shutdown(1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) {
    stopChildSync(child);
  }
});

function prefixStream(stream, service) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(`${service.color}[${service.name}]${reset} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      process.stdout.write(`${service.color}[${service.name}]${reset} ${buffer}\n`);
      buffer = '';
    }
  });
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    stopChild(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 500).unref();
}

function stopChild(child) {
  if (!child.pid) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGTERM');
}

function stopChildSync(child) {
  if (!child.pid) return;
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // Process already exited.
  }
}

function resolveSupportWorkbenchDir() {
  if (process.env.SUPPORT_WORKBENCH_DIR) {
    return {
      dir: path.resolve(process.env.SUPPORT_WORKBENCH_DIR),
      source: 'SUPPORT_WORKBENCH_DIR',
    };
  }

  const candidates = [
    path.resolve(rootDir, '..', '..', '..', 'claude-code'),
    path.resolve(rootDir, '..', 'support-workbench'),
    path.resolve(rootDir, '..', 'support-workbench-exp'),
  ];

  const detected = candidates.find(isSupportWorkbenchDir);
  return detected
    ? {
        dir: detected,
        source: 'auto-detected local repo',
      }
    : null;
}

function isSupportWorkbenchDir(candidateDir) {
  return existsSync(path.join(candidateDir, 'package.json'))
    && existsSync(path.join(candidateDir, 'backend'))
    && existsSync(path.join(candidateDir, 'frontend'));
}
