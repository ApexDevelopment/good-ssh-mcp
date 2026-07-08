import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { getDaemonConfig } from '../daemon/server.js';
import { DaemonConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getOrStartDaemon(): Promise<DaemonConfig> {
  let config = await getDaemonConfig();
  
  if (config) {
    try {
      const res = await fetch(`http://127.0.0.1:${config.port}/ping`, {
        signal: AbortSignal.timeout(1000)
      });
      if (res.ok) {
        return config;
      }
    } catch {
      // Daemon dead, start a new one
    }
  }
  
  const isTypeScript = __dirname.includes('src');
  let daemonPath = '';
  let command = 'node';
  let args: string[] = [];
  
  const projectRoot = path.resolve(__dirname, '..', '..');
  
  if (isTypeScript) {
    daemonPath = path.join(projectRoot, 'src', 'daemon', 'index.ts');
    // On Windows, running 'npx' directly from node's spawn needs 'npx.cmd' or shell: true.
    // To make it fully cross-platform and reliable, we'll use process.execPath with tsx or use shell: true.
    command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    args = ['tsx', daemonPath];
  } else {
    daemonPath = path.join(projectRoot, 'dist', 'daemon', 'index.js');
    command = 'node';
    args = [daemonPath];
  }
  
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: isTypeScript // Need shell for npx resolving on Windows
  });
  
  child.unref();
  
  const startTime = Date.now();
  const timeout = 10000;
  
  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    config = await getDaemonConfig();
    if (config) {
      try {
        const res = await fetch(`http://127.0.0.1:${config.port}/ping`, {
          signal: AbortSignal.timeout(500)
        });
        if (res.ok) {
          return config;
        }
      } catch {
        // retry
      }
    }
  }
  
  throw new Error('Timeout waiting for Good SSH Daemon to start.');
}

export async function callDaemon(endpoint: string, body?: any, method?: string): Promise<any> {
  const config = await getOrStartDaemon();
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.token}`,
    'Content-Type': 'application/json'
  };
  
  const resolvedMethod = method || (body ? 'POST' : 'GET');
  
  const res = await fetch(`http://127.0.0.1:${config.port}${endpoint}`, {
    method: resolvedMethod,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    throw new Error(data.error || `HTTP error! status: ${res.status}`);
  }
  
  return data;
}
