#!/usr/bin/env node

import { Command } from 'commander';
import { callDaemon } from '../shared/client.js';
import * as fs from 'fs/promises';

const program = new Command();

program
  .name('good-ssh')
  .description('Stateful SSH manager CLI for agents and developers')
  .version('1.0.0');

program
  .command('connect <host>')
  .description('Establish a stateful SSH connection to a remote machine')
  .option('-u, --username <username>', 'SSH username (optional if defined in ~/.ssh/config)')
  .option('-p, --port <number>', 'SSH port')
  .option('--password <password>', 'SSH password authentication')
  .option('-k, --private-key <path>', 'SSH private key file path or raw content')
  .option('--passphrase <passphrase>', 'Passphrase for the private key')
  .option('--id <id>', 'Custom unique connection ID (defaults to username@host:port)')
  .action(async (host, options) => {
    try {
      const res = await callDaemon('/connect', {
        host,
        port: options.port ? parseInt(options.port, 10) : undefined,
        username: options.username,
        password: options.password,
        privateKey: options.privateKey,
        passphrase: options.passphrase,
        connectionId: options.id
      });
      console.log('Successfully connected!');
      console.log(JSON.stringify(res, null, 2));
    } catch (err: any) {
      console.error('Connection failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('disconnect <connectionId>')
  .description('Close an active stateful SSH connection')
  .action(async (connectionId) => {
    try {
      await callDaemon('/disconnect', { connectionId });
      console.log(`Disconnected connection: ${connectionId}`);
    } catch (err: any) {
      console.error('Failed to disconnect:', err.message);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all active stateful SSH connections')
  .action(async () => {
    try {
      const res = await callDaemon('/connections');
      if (res.length === 0) {
        console.log('No active SSH connections.');
        return;
      }
      console.table(
        res.map((c: any) => ({
          ID: c.id,
          Host: c.host,
          Port: c.port,
          User: c.username,
          OS: c.os,
          Shell: c.shell,
          CWD: c.cwd
        }))
      );
    } catch (err: any) {
      console.error('Failed to list connections:', err.message);
      process.exit(1);
    }
  });

program
  .command('exec <connectionId> <command>')
  .description('Execute a command on the remote machine in its stateful CWD')
  .option('--cwd <path>', 'Temporarily override CWD for this command execution')
  .option('-e, --env <key=value...>', 'Set environment variables (format: KEY=VALUE)')
  .action(async (connectionId, command, options) => {
    try {
      const env: Record<string, string> = {};
      if (options.env) {
        for (const item of options.env) {
          const eqIdx = item.indexOf('=');
          if (eqIdx !== -1) {
            const k = item.slice(0, eqIdx);
            const v = item.slice(eqIdx + 1);
            env[k] = v;
          }
        }
      }

      const res = await callDaemon('/execute', {
        connectionId,
        command,
        cwd: options.cwd,
        env
      });

      if (res.stdout) {
        process.stdout.write(res.stdout);
      }
      if (res.stderr) {
        process.stderr.write(res.stderr);
      }
      if (res.exitCode !== 0) {
        process.exit(res.exitCode ?? 1);
      }
    } catch (err: any) {
      console.error('Execution failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('cd <connectionId> <path>')
  .description('Change the default working directory (CWD) for subsequent executions')
  .action(async (connectionId, dirPath) => {
    try {
      const res = await callDaemon('/cd', { connectionId, path: dirPath });
      console.log(`CWD updated to: ${res.cwd}`);
    } catch (err: any) {
      console.error('Failed to change directory:', err.message);
      process.exit(1);
    }
  });

program
  .command('upload <connectionId> <localPath> <remotePath>')
  .description('Upload a file or folder recursively to the remote machine')
  .action(async (connectionId, localPath, remotePath) => {
    try {
      const stats = await fs.stat(localPath);
      if (stats.isDirectory()) {
        console.log(`Uploading directory recursively: ${localPath} -> ${remotePath}...`);
        await callDaemon('/upload-dir', { connectionId, localPath, remotePath });
      } else {
        console.log(`Uploading file: ${localPath} -> ${remotePath}...`);
        await callDaemon('/upload-file', { connectionId, localPath, remotePath });
      }
      console.log('Upload completed successfully.');
    } catch (err: any) {
      console.error('Upload failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('download <connectionId> <remotePath> <localPath>')
  .description('Download a file or folder recursively from the remote machine')
  .action(async (connectionId, remotePath, localPath) => {
    try {
      console.log(`Downloading: ${remotePath} -> ${localPath}...`);
      // Try directory first, fallback to file if it fails
      try {
        await callDaemon('/download-dir', { connectionId, remotePath, localPath });
        console.log('Directory download completed successfully.');
      } catch (dirErr: any) {
        // Fallback to file download
        await callDaemon('/download-file', { connectionId, remotePath, localPath });
        console.log('File download completed successfully.');
      }
    } catch (err: any) {
      console.error('Download failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('cat <connectionId> <remotePath>')
  .description('Print the contents of a remote file to stdout')
  .action(async (connectionId, remotePath) => {
    try {
      const res = await callDaemon('/get-file', { connectionId, remotePath });
      process.stdout.write(res.content);
    } catch (err: any) {
      console.error('Failed to read file:', err.message);
      process.exit(1);
    }
  });

program
  .command('write <connectionId> <remotePath> [content]')
  .description('Write text content to a remote file. If content argument is omitted, reads from stdin.')
  .action(async (connectionId, remotePath, content) => {
    try {
      let finalContent = content;
      if (finalContent === undefined) {
        finalContent = await new Promise<string>((resolve) => {
          let data = '';
          process.stdin.on('data', (chunk) => {
            data += chunk;
          });
          process.stdin.on('end', () => {
            resolve(data);
          });
        });
      }

      await callDaemon('/write-file', { connectionId, remotePath, content: finalContent });
      console.log(`Wrote content to remote file: ${remotePath}`);
    } catch (err: any) {
      console.error('Failed to write file:', err.message);
      process.exit(1);
    }
  });

program
  .command('shutdown')
  .description('Shut down the background SSH daemon process')
  .action(async () => {
    try {
      await callDaemon('/shutdown', undefined, 'POST');
      console.log('Good SSH Daemon shut down successfully.');
    } catch (err: any) {
      console.error('Failed to shut down daemon:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
