import ssh2 from 'ssh2';
import type { SFTPWrapper, ConnectConfig, Client } from 'ssh2';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ConnectionInfo, CommandResult } from '../shared/types.js';

export interface ActiveConnection {
  client: Client;
  info: ConnectionInfo;
  defaultShell: string;
  homeDir: string;
}

function executeCommandPromise(
  conn: Client,
  command: string,
  stdin?: string
): Promise<CommandResult> {
  return new Promise((resolve) => {
    conn.exec(command, (err: Error | undefined, stream: any) => {
      if (err) {
        return resolve({
          stdout: '',
          stderr: err.message,
          exitCode: -1
        });
      }
      
      if (stdin !== undefined) {
        stream.write(stdin);
        stream.end();
      }
      
      let stdout = '';
      let stderr = '';
      
      stream.on('close', (code: number, signal: string) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? null,
          signal
        });
      }).on('data', (data: Buffer) => {
        stdout += data.toString('utf8');
      }).on('error', (streamErr: any) => {
        stderr += `\n[Stream Error: ${streamErr.message}]`;
      });
      
      if (stream.stderr) {
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        }).on('error', (stderrErr: any) => {
          stderr += `\n[Stderr Stream Error: ${stderrErr.message}]`;
        });
      }
    });
  });
}

function escapeWindowsArg(val: string): string {
  let res = '';
  let backslashes = 0;
  for (let i = 0; i < val.length; i++) {
    const char = val[i];
    if (char === '\\') {
      backslashes++;
    } else if (char === '"') {
      res += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      res += '\\'.repeat(backslashes) + char;
      backslashes = 0;
    }
  }
  res += '\\'.repeat(backslashes);
  return res;
}

function isRemoteDirectory(attrs: any, longname?: string): boolean {
  if (longname && (longname.startsWith('d') || longname.startsWith('l d'))) {
    return true;
  }
  if (!attrs) return false;
  if (typeof attrs.isDirectory === 'function') {
    return attrs.isDirectory();
  }
  // Mode bitwise check: S_IFDIR is 0o040000
  return (attrs.mode & 0o170000) === 0o040000;
}

export function resolveRemotePath(
  osType: 'linux' | 'darwin' | 'windows' | 'unknown',
  homeDir: string,
  cwd: string,
  remotePath: string
): string {
  let resolved = remotePath;
  const separator = osType === 'windows' ? '\\' : '/';
  
  if (resolved === '~') {
    resolved = homeDir;
  } else if (resolved.startsWith('~/') || resolved.startsWith('~\\')) {
    resolved = `${homeDir}${resolved.slice(1)}`;
  } else {
    let isAbsolute = false;
    if (osType === 'windows') {
      isAbsolute = /^[a-zA-Z]:/.test(resolved) || resolved.startsWith('\\') || resolved.startsWith('/');
    } else {
      isAbsolute = resolved.startsWith('/');
    }
    
    if (!isAbsolute) {
      resolved = `${cwd}${cwd.endsWith(separator) ? '' : separator}${resolved}`;
    }
  }
  
  return resolved.replace(/\\/g, '/');
}

function getSftp(conn: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
      if (err) {
        reject(err);
      } else {
        sftp.on('error', (sftpErr: any) => {
          console.error('SFTP Error occurred:', sftpErr.message);
        });
        resolve(sftp);
      }
    });
  });
}

interface SshConfigHost {
  hostPatterns: string[];
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

export async function parseSshConfig(targetHost: string): Promise<Partial<{ host: string; username: string; port: number; privateKey: string }>> {
  const configPath = path.join(os.homedir(), '.ssh', 'config');
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const lines = content.split(/\r?\n/);
    
    let currentHost: SshConfigHost | null = null;
    const hosts: SshConfigHost[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      const match = trimmed.match(/^(\S+)\s+(.+)$/) || trimmed.match(/^(\S+)\s*=\s*(.+)$/);
      if (!match) continue;
      
      const key = match[1].toLowerCase();
      const val = match[2].trim().replace(/^"(.*)"$/, '$1');
      
      if (key === 'host') {
        currentHost = {
          hostPatterns: val.split(/\s+/)
        };
        hosts.push(currentHost);
      } else if (currentHost) {
        if (key === 'hostname') {
          currentHost.hostName = val;
        } else if (key === 'user') {
          currentHost.user = val;
        } else if (key === 'port') {
          const p = parseInt(val, 10);
          if (!isNaN(p)) currentHost.port = p;
        } else if (key === 'identityfile') {
          let idFile = val;
          if (idFile.startsWith('~')) {
            idFile = path.join(os.homedir(), idFile.slice(1));
          }
          currentHost.identityFile = idFile;
        }
      }
    }
    
    const matched = hosts.find(h => h.hostPatterns.some(pattern => {
      if (pattern === targetHost) return true;
      return false;
    })) || hosts.find(h => h.hostPatterns.includes('*'));
    
    if (matched) {
      const result: any = {};
      if (matched.hostName && matched.hostName !== '*') result.host = matched.hostName;
      if (matched.user) result.username = matched.user;
      if (matched.port) result.port = matched.port;
      if (matched.identityFile) result.privateKey = matched.identityFile;
      return result;
    }
  } catch {}
  return {};
}

async function resolvePrivateKey(keyPathOrContent: string, passphrase?: string): Promise<string | Buffer> {
  const trimmed = keyPathOrContent.trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed;
  }
  
  let resolvedPath = trimmed;
  if (resolvedPath.startsWith('~')) {
    resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
  }
  resolvedPath = path.resolve(resolvedPath);
  
  try {
    return await fs.readFile(resolvedPath);
  } catch (err: any) {
    throw new Error(`Failed to read private key at ${resolvedPath}: ${err.message}`);
  }
}

async function probeConnection(conn: Client): Promise<{ os: 'linux' | 'darwin' | 'windows' | 'unknown'; shell: string; cwd: string }> {
  // Let's try running `uname -s` first.
  let res = await executeCommandPromise(conn, 'uname -s');
  let osType: 'linux' | 'darwin' | 'windows' | 'unknown' = 'unknown';
  let shell = 'unknown';
  let cwd = '';

  if (res.exitCode === 0 && res.stdout.trim()) {
    const uname = res.stdout.trim().toLowerCase();
    if (uname === 'darwin') {
      osType = 'darwin';
    } else {
      osType = 'linux';
    }
    
    // Get shell
    const shellRes = await executeCommandPromise(conn, 'echo $SHELL');
    if (shellRes.exitCode === 0 && shellRes.stdout.trim()) {
      shell = shellRes.stdout.trim();
    } else {
      const shRes = await executeCommandPromise(conn, 'echo $0');
      if (shRes.exitCode === 0 && shRes.stdout.trim()) {
        shell = shRes.stdout.trim();
      }
    }
    
    // Get default cwd
    const pwdRes = await executeCommandPromise(conn, 'pwd');
    if (pwdRes.exitCode === 0 && pwdRes.stdout.trim()) {
      cwd = pwdRes.stdout.trim();
    }
  } else {
    // Windows check
    const verRes = await executeCommandPromise(conn, 'ver');
    if (verRes.exitCode === 0 && verRes.stdout.toLowerCase().includes('windows')) {
      osType = 'windows';
      
      const psRes = await executeCommandPromise(conn, '$PSVersionTable');
      if (psRes.exitCode === 0 && psRes.stdout.includes('PSVersion')) {
        shell = 'powershell';
      } else {
        shell = 'cmd';
      }
      
      const cdRes = await executeCommandPromise(conn, 'cd');
      if (cdRes.exitCode === 0 && cdRes.stdout.trim()) {
        cwd = cdRes.stdout.trim();
      }
    }
  }
  
  return { os: osType, shell, cwd };
}

export class SSHConnectionManager {
  private connections = new Map<string, ActiveConnection>();

  async connect(params: {
    host: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    connectionId?: string;
  }): Promise<ConnectionInfo> {
    let host = params.host;
    let username = params.username;
    if (host.includes('@')) {
      const parts = host.split('@');
      username = username ?? parts[0];
      host = parts.slice(1).join('@');
    }

    const configValues = await parseSshConfig(host);
    
    const resolvedHost = configValues.host ?? host;
    const port = params.port ?? configValues.port ?? 22;
    const resolvedUsername = username ?? configValues.username;
    
    if (!resolvedUsername) {
      throw new Error(`Username is required to connect to ${host}. Please specify it in the command arguments or your ~/.ssh/config file.`);
    }

    // 1. If connectionId is explicitly requested, check if it exists
    if (params.connectionId && this.connections.has(params.connectionId)) {
      const existing = this.connections.get(params.connectionId)!;
      try {
        existing.info.lastUsedAt = new Date().toISOString();
        return existing.info;
      } catch (e) {
        this.disconnect(params.connectionId);
      }
    }

    // 2. Otherwise, check if we already have an active connection matching host, port, and username
    for (const [existingId, conn] of this.connections.entries()) {
      if (
        conn.info.host === params.host &&
        conn.info.port === port &&
        conn.info.username === resolvedUsername
      ) {
        if (!params.connectionId || params.connectionId === existingId) {
          try {
            conn.info.lastUsedAt = new Date().toISOString();
            return conn.info;
          } catch (e) {
            this.disconnect(existingId);
          }
        }
      }
    }

    // 3. Determine the connection ID
    let connId = params.connectionId;
    if (!connId) {
      // Generate a short sequential ID: c1, c2, c3, ...
      let index = 1;
      while (this.connections.has(`c${index}`)) {
        index++;
      }
      connId = `c${index}`;
    }

    const config: ConnectConfig = {
      host: resolvedHost,
      port,
      username: resolvedUsername,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3
    };

    if (params.password) {
      config.password = params.password;
    }

    let resolvedPrivateKeyPath = params.privateKey ?? configValues.privateKey;
    
    // Check for default identity files if no private key/password specified
    if (!params.password && !resolvedPrivateKeyPath) {
      const defaultKeys = ['id_ed25519', 'id_rsa', 'id_ecdsa', 'id_dsa'];
      for (const keyName of defaultKeys) {
        const p = path.join(os.homedir(), '.ssh', keyName);
        try {
          await fs.access(p);
          resolvedPrivateKeyPath = p;
          break;
        } catch {}
      }
    }

    if (resolvedPrivateKeyPath) {
      config.privateKey = await resolvePrivateKey(resolvedPrivateKeyPath, params.passphrase);
      if (params.passphrase) {
        config.passphrase = params.passphrase;
      }
    }

    // Set agent fallback if we don't have password or specified key
    let agentPath: string | undefined;
    if (!params.password && !params.privateKey && !configValues.privateKey) {
      if (process.env.SSH_AUTH_SOCK) {
        agentPath = process.env.SSH_AUTH_SOCK;
      } else if (process.platform === 'win32') {
        agentPath = '\\\\.\\pipe\\openssh-ssh-agent';
      }
    }

    const tryConnect = (connectConfig: ConnectConfig): Promise<ConnectionInfo> => {
      return new Promise<ConnectionInfo>((resolve, reject) => {
        const client = new ssh2.Client();
        let isSettled = false;

        client.on('ready', async () => {
          try {
            const probe = await probeConnection(client);
            
            const info: ConnectionInfo = {
              id: connId,
              host: params.host,
              port,
              username: resolvedUsername,
              os: probe.os,
              shell: probe.shell,
              cwd: probe.cwd,
              connectedAt: new Date().toISOString(),
              lastUsedAt: new Date().toISOString()
            };

            this.connections.set(connId, {
              client,
              info,
              defaultShell: probe.shell,
              homeDir: probe.cwd
            });
            isSettled = true;
            resolve(info);
          } catch (err: any) {
            client.end();
            if (!isSettled) {
              isSettled = true;
              reject(new Error(`Failed to probe host after connection: ${err.message}`));
            }
          }
        });

        client.on('error', (err) => {
          if (!isSettled) {
            isSettled = true;
            reject(err);
          } else {
            this.connections.delete(connId);
          }
        });

        client.on('end', () => {
          this.connections.delete(connId);
        });

        client.on('close', () => {
          this.connections.delete(connId);
        });

        client.connect(connectConfig);
      });
    };

    // If agent is available, try it first
    if (agentPath) {
      try {
        return await tryConnect({ ...config, agent: agentPath });
      } catch (err: any) {
        const isAgentConnectError = err.message.includes('agent') || 
                                    err.message.includes('socket') || 
                                    err.code === 'ENOENT' || 
                                    err.code === 'ECONNREFUSED';
        if (isAgentConnectError && config.privateKey) {
          // Retry with privateKey instead of agent
          return await tryConnect(config);
        }
        throw err;
      }
    }

    return await tryConnect(config);
  }

  disconnect(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      try {
        conn.client.end();
      } catch {}
      this.connections.delete(id);
    }
  }

  disconnectAll(): void {
    for (const [id, conn] of this.connections.entries()) {
      try {
        conn.client.end();
      } catch {}
    }
    this.connections.clear();
  }

  list(): ConnectionInfo[] {
    return Array.from(this.connections.values()).map(c => c.info);
  }

  getConnectionInfo(id: string): ConnectionInfo {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found.`);
    return conn.info;
  }

  async execute(
    id: string,
    command: string,
    options: { cwd?: string; env?: Record<string, string> } = {}
  ): Promise<CommandResult> {
    const conn = this.connections.get(id);
    if (!conn) {
      throw new Error(`Connection "${id}" not found. Connect first.`);
    }

    conn.info.lastUsedAt = new Date().toISOString();

    const desiredShell = conn.info.shell;
    const defaultShell = conn.defaultShell;
    const runCwd = options.cwd || conn.info.cwd;
    const osType = conn.info.os;

    const isPowershell = desiredShell === 'powershell' || desiredShell.endsWith('pwsh');
    const isCmd = desiredShell === 'cmd';
    
    // 1. Format the command for the desired shell
    let innerCommand = command;
    if (osType === 'windows' || isPowershell || isCmd) {
      if (isPowershell) {
        const envParts: string[] = [];
        if (options.env) {
          for (const [k, v] of Object.entries(options.env)) {
            envParts.push(`$env:${k}="${v.replace(/"/g, '`"')}";`);
          }
        }
        const cwdPart = runCwd ? `Set-Location -Path "${runCwd.replace(/"/g, '`"')}"; ` : '';
        innerCommand = `${cwdPart}${envParts.join(' ')}${command}`;
      } else {
        const envParts: string[] = [];
        if (options.env) {
          for (const [k, v] of Object.entries(options.env)) {
            envParts.push(`set "${k}=${v.replace(/"/g, '""')}"`);
          }
        }
        const cwdPart = runCwd ? `cd /d "${runCwd.replace(/"/g, '""')}"` : '';
        const parts = [...(cwdPart ? [cwdPart] : []), ...envParts, command];
        innerCommand = parts.join(' && ');
      }
    } else {
      const envParts: string[] = [];
      if (options.env) {
        for (const [k, v] of Object.entries(options.env)) {
          envParts.push(`export ${k}="${v.replace(/"/g, '\\"')}"`);
        }
      }
      const cwdPart = runCwd ? `cd "${runCwd.replace(/"/g, '\\"')}"` : '';
      const parts = [...envParts, ...(cwdPart ? [cwdPart] : []), command];
      innerCommand = parts.join(' && ');
    }

    // 2. If the desired shell differs from the default login shell, execute the desired shell and pipe the inner command via stdin
    if (desiredShell !== defaultShell) {
      let wrapperCmd = '';
      if (isPowershell) {
        wrapperCmd = 'powershell -NoProfile -NonInteractive -Command -';
      } else if (isCmd) {
        wrapperCmd = 'cmd.exe';
      } else {
        wrapperCmd = `${desiredShell} -s`;
      }
      
      return executeCommandPromise(conn.client, wrapperCmd, innerCommand);
    }

    // 3. Otherwise, execute normally
    return executeCommandPromise(conn.client, innerCommand);
  }

  async changeShell(id: string, shell: string): Promise<string> {
    const conn = this.connections.get(id);
    if (!conn) {
      throw new Error(`Connection "${id}" not found.`);
    }
    conn.info.shell = shell;
    conn.info.lastUsedAt = new Date().toISOString();
    return shell;
  }

  async changeDirectory(id: string, dirPath: string): Promise<string> {
    const conn = this.connections.get(id);
    if (!conn) {
      throw new Error(`Connection "${id}" not found.`);
    }

    conn.info.lastUsedAt = new Date().toISOString();
    return this.resolveRemoteAbsolutePath(id, dirPath, true);
  }

  async runScript(
    id: string,
    script: string,
    extension: string,
    interpreter?: string
  ): Promise<CommandResult> {
    const conn = this.connections.get(id);
    if (!conn) {
      throw new Error(`Connection "${id}" not found.`);
    }

    const uuid = crypto.randomUUID();
    const tempFileName = `.good_ssh_script_${uuid}${extension}`;
    const tempFilePath = resolveRemotePath(conn.info.os, conn.homeDir, conn.info.cwd, tempFileName);

    try {
      // 1. Write script content to remote file
      await this.writeFileContents(id, tempFilePath, script);

      // 2. Build execution command
      let cmd = '';
      if (interpreter) {
        cmd = `${interpreter} "${tempFilePath}"`;
      } else {
        if (conn.info.os === 'windows') {
          cmd = `"${tempFilePath}"`;
        } else {
          cmd = `chmod +x "${tempFilePath}" && "${tempFilePath}"`;
        }
      }

      // 3. Execute
      const result = await this.execute(id, cmd);
      return result;
    } finally {
      // 4. Clean up remote temp file
      try {
        const sftp = await getSftp(conn.client);
        try {
          await new Promise<void>((resolve, reject) => {
            sftp.unlink(tempFilePath, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } finally {
          process.nextTick(() => {
            try {
              sftp.end();
            } catch {}
          });
        }
      } catch (err: any) {
        console.error(`Failed to clean up remote temp file ${tempFilePath}:`, err.message);
      }
    }
  }

  private async resolveRemoteAbsolutePath(id: string, remotePath: string, throwOnError = false): Promise<string> {
    const conn = this.connections.get(id);
    if (!conn) return remotePath;
    
    const osType = conn.info.os;
    const currentCwd = conn.info.cwd;
    
    let resolveCmd = '';
    if (osType === 'windows') {
      if (conn.info.shell === 'powershell') {
        const cwdPart = currentCwd ? `Set-Location -Path "${currentCwd.replace(/"/g, '`"')}"; ` : '';
        resolveCmd = `${cwdPart}Set-Location -Path "${remotePath.replace(/"/g, '`"')}"; (Get-Location).Path`;
      } else {
        const cwdPart = currentCwd ? `cd /d "${currentCwd.replace(/"/g, '""')}" && ` : '';
        resolveCmd = `${cwdPart}cd /d "${remotePath.replace(/"/g, '""')}" && cd`;
      }
    } else {
      const cwdPart = currentCwd ? `cd "${currentCwd.replace(/"/g, '\\"')}" && ` : '';
      resolveCmd = `${cwdPart}cd "${remotePath.replace(/"/g, '\\"')}" && pwd`;
    }
    
    try {
      const res = await this.execute(id, resolveCmd);
      if (res.exitCode === 0 && res.stdout.trim()) {
        const resolved = res.stdout.trim();
        conn.info.cwd = resolved;
        return resolved;
      }
      if (throwOnError) {
        throw new Error(res.stderr.trim() || `Command failed with exit code ${res.exitCode}`);
      }
    } catch (e: any) {
      if (throwOnError) {
        throw new Error(`Failed to resolve directory: ${e.message}`);
      }
    }
    
    conn.info.cwd = remotePath;
    return remotePath;
  }

  async getFileContents(id: string, remotePath: string): Promise<string> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found.`);
    
    const sftp = await getSftp(conn.client);
    const resolvedPath = resolveRemotePath(conn.info.os, conn.homeDir, conn.info.cwd, remotePath);
    
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(resolvedPath, { encoding: 'utf8' });
      
      stream.on('data', (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      
      stream.on('end', () => {
        process.nextTick(() => {
          try {
            sftp.end();
          } catch {}
        });
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      
      stream.on('error', (err: any) => {
        process.nextTick(() => {
          try {
            sftp.end();
          } catch {}
        });
        reject(err);
      });
    });
  }

  async writeFileContents(id: string, remotePath: string, content: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found.`);
    
    const sftp = await getSftp(conn.client);
    const resolvedPath = resolveRemotePath(conn.info.os, conn.homeDir, conn.info.cwd, remotePath);
    
    return new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(resolvedPath, { encoding: 'utf8' });
      
      let completed = false;
      const done = () => {
        if (!completed) {
          completed = true;
          process.nextTick(() => {
            try {
              sftp.end();
            } catch {}
          });
          resolve();
        }
      };
      
      stream.on('finish', done);
      stream.on('close', done);
      
      stream.on('error', (err: any) => {
        if (!completed) {
          completed = true;
          process.nextTick(() => {
            try {
              sftp.end();
            } catch {}
          });
          reject(err);
        }
      });
      
      stream.write(content);
      stream.end();
    });
  }

  async uploadFile(id: string, localPath: string, remotePath: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found.`);
    const sftp = await getSftp(conn.client);
    const resolvedPath = resolveRemotePath(conn.info.os, conn.homeDir, conn.info.cwd, remotePath);
    
    let resolvedLocal = localPath;
    if (resolvedLocal.startsWith('~')) {
      resolvedLocal = path.join(os.homedir(), resolvedLocal.slice(1));
    }
    resolvedLocal = path.resolve(resolvedLocal);

    try {
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(resolvedLocal, resolvedPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      process.nextTick(() => {
        try {
          sftp.end();
        } catch {}
      });
    }
  }

  async downloadFile(id: string, remotePath: string, localPath: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found.`);
    const sftp = await getSftp(conn.client);
    const resolvedPath = resolveRemotePath(conn.info.os, conn.homeDir, conn.info.cwd, remotePath);
    
    let resolvedLocal = localPath;
    if (resolvedLocal.startsWith('~')) {
      resolvedLocal = path.join(os.homedir(), resolvedLocal.slice(1));
    }
    resolvedLocal = path.resolve(resolvedLocal);

    await fs.mkdir(path.dirname(resolvedLocal), { recursive: true });

    try {
      await new Promise<void>((resolve, reject) => {
        sftp.fastGet(resolvedPath, resolvedLocal, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      process.nextTick(() => {
        try {
          sftp.end();
        } catch {}
      });
    }
  }

  async uploadDirectory(id: string, localPath: string, remotePath: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found.`);
    const sftp = await getSftp(conn.client);
    const resolvedPath = resolveRemotePath(conn.info.os, conn.homeDir, conn.info.cwd, remotePath);
    
    let resolvedLocal = localPath;
    if (resolvedLocal.startsWith('~')) {
      resolvedLocal = path.join(os.homedir(), resolvedLocal.slice(1));
    }
    resolvedLocal = path.resolve(resolvedLocal);

    // Verify local is a directory
    try {
      const stats = await fs.stat(resolvedLocal);
      if (!stats.isDirectory()) {
        throw new Error('Local path is not a directory');
      }
    } catch (err: any) {
      process.nextTick(() => {
        try {
          sftp.end();
        } catch {}
      });
      throw err;
    }

    const helper = async (localDir: string, remoteDir: string) => {
      await new Promise<void>((resolve) => {
        sftp.mkdir(remoteDir, () => {
          resolve();
        });
      });

      const entries = await fs.readdir(localDir, { withFileTypes: true });
      for (const entry of entries) {
        const lPath = path.join(localDir, entry.name);
        const sep = conn.info.os === 'windows' ? '\\' : '/';
        const rPath = `${remoteDir}${remoteDir.endsWith(sep) ? '' : sep}${entry.name}`;

        if (entry.isDirectory()) {
          await helper(lPath, rPath);
        } else if (entry.isFile()) {
          await new Promise<void>((resolve, reject) => {
            sftp.fastPut(lPath, rPath, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }
    };

    try {
      await helper(resolvedLocal, resolvedPath);
    } finally {
      process.nextTick(() => {
        try {
          sftp.end();
        } catch {}
      });
    }
  }

  async downloadDirectory(id: string, remotePath: string, localPath: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found.`);
    const sftp = await getSftp(conn.client);
    const resolvedPath = resolveRemotePath(conn.info.os, conn.homeDir, conn.info.cwd, remotePath);
    
    let resolvedLocal = localPath;
    if (resolvedLocal.startsWith('~')) {
      resolvedLocal = path.join(os.homedir(), resolvedLocal.slice(1));
    }
    resolvedLocal = path.resolve(resolvedLocal);

    // Verify remote is a directory
    try {
      const stats = await new Promise<ssh2.Stats>((resolve, reject) => {
        sftp.stat(resolvedPath, (err, s) => {
          if (err) reject(err);
          else resolve(s);
        });
      });

      if (!isRemoteDirectory(stats)) {
        throw new Error('Remote path is not a directory');
      }
    } catch (err: any) {
      process.nextTick(() => {
        try {
          sftp.end();
        } catch {}
      });
      throw err;
    }

    const helper = async (remoteDir: string, localDir: string) => {
      await fs.mkdir(localDir, { recursive: true });

      const entries = await new Promise<any[]>((resolve, reject) => {
        sftp.readdir(remoteDir, (err, list) => {
          if (err) reject(err);
          else resolve(list || []);
        });
      });

      for (const entry of entries) {
        if (entry.filename === '.' || entry.filename === '..') {
          continue;
        }

        const sep = conn.info.os === 'windows' ? '\\' : '/';
        const rPath = `${remoteDir}${remoteDir.endsWith(sep) ? '' : sep}${entry.filename}`;
        const lPath = path.join(localDir, entry.filename);

        if (isRemoteDirectory(entry.attrs, entry.filename)) {
          await helper(rPath, lPath);
        } else {
          await new Promise<void>((resolve, reject) => {
            sftp.fastGet(rPath, lPath, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }
    };

    try {
      await helper(resolvedPath, resolvedLocal);
    } finally {
      process.nextTick(() => {
        try {
          sftp.end();
        } catch {}
      });
    }
  }
}
