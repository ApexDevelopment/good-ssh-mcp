import ssh2 from 'ssh2';
const { Server } = ssh2;
import * as crypto from 'crypto';
import { callDaemon } from './shared/client.js';

async function main() {
  console.log('Generating host keys for mock SSH server...');
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
  });

  const sshServer = new Server({
    hostKeys: [privateKey]
  }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'test' && ctx.password === 'password') {
        ctx.accept();
      } else {
        ctx.reject();
      }
    }).on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (accept, reject, info) => {
          const stream = accept();
          const cmd = info.command;
          
          if (cmd === 'uname -s') {
            stream.write('Linux\n');
          } else if (cmd === 'echo $SHELL') {
            stream.write('/bin/bash\n');
          } else if (cmd === 'pwd') {
            stream.write('/home/test\n');
          } else if (cmd.includes('echo "hello"')) {
            stream.write('hello\n');
          } else if (cmd.includes('cd "/home/test/sub"') && cmd.includes('pwd')) {
            stream.write('/home/test/sub\n');
          } else {
            stream.write(`Executed: ${cmd}\n`);
          }
          
          stream.exit(0);
          stream.end();
        });
      });
    });
  });

  await new Promise<void>((resolve) => {
    sshServer.listen(2222, '127.0.0.1', () => {
      console.log('Mock SSH Server listening on 127.0.0.1:2222');
      resolve();
    });
  });

  try {
    console.log('\n--- 1. Testing Connection ---');
    const connectInfo = await callDaemon('/connect', {
      host: '127.0.0.1',
      port: 2222,
      username: 'test',
      password: 'password',
      connectionId: 'test-local'
    });
    console.log('Connection established:', connectInfo);

    console.log('\n--- 1.1 Testing Connection with username in host (user@host) ---');
    const connectInfo2 = await callDaemon('/connect', {
      host: 'test@127.0.0.1',
      port: 2222,
      password: 'password',
      connectionId: 'test-user-at-host'
    });
    console.log('Connection established (user@host):', connectInfo2);
    if (connectInfo2.username !== 'test') {
      throw new Error('Username parsing from host failed!');
    }
    await callDaemon('/disconnect', { connectionId: 'test-user-at-host' });

    console.log('\n--- 2. Testing Connection Listing ---');
    const list = await callDaemon('/connections');
    console.log('Active connections:', list);
    const hasLocal = list.some((c: any) => c.id === 'test-local');
    if (!hasLocal) {
      throw new Error('Connection listing assertion failed!');
    }

    console.log('\n--- 3. Testing Command Execution ---');
    const execRes1 = await callDaemon('/execute', {
      connectionId: 'test-local',
      command: 'echo "hello"'
    });
    console.log('Command Output:', execRes1);
    if (!execRes1.stdout.includes('hello')) {
      throw new Error('Command execution output assertion failed!');
    }

    console.log('\n--- 4. Testing Stateful Directory Change ---');
    const cdRes = await callDaemon('/cd', {
      connectionId: 'test-local',
      path: '/home/test/sub'
    });
    console.log('CWD updated response:', cdRes);
    if (cdRes.cwd !== '/home/test/sub') {
      throw new Error('Directory change assertion failed!');
    }

    const listAfterCd = await callDaemon('/connections');
    const connAfterCd = listAfterCd.find((c: any) => c.id === 'test-local');
    console.log('Connection CWD after change:', connAfterCd?.cwd);
    if (!connAfterCd || connAfterCd.cwd !== '/home/test/sub') {
      throw new Error('Stateful CWD update verify failed!');
    }

    console.log('\n--- 4.5. Testing Shell Switching ---');
    const shellRes = await callDaemon('/shell', {
      connectionId: 'test-local',
      shell: '/bin/sh'
    });
    console.log('Shell updated response:', shellRes);
    if (shellRes.shell !== '/bin/sh') {
      throw new Error('Shell switch assertion failed!');
    }

    const listAfterShell = await callDaemon('/connections');
    const connAfterShell = listAfterShell.find((c: any) => c.id === 'test-local');
    console.log('Connection shell after change:', connAfterShell?.shell);
    if (!connAfterShell || connAfterShell.shell !== '/bin/sh') {
      throw new Error('Stateful shell update verify failed!');
    }

    console.log('\n--- 5. Testing Disconnection ---');
    await callDaemon('/disconnect', { connectionId: 'test-local' });
    console.log('Disconnected.');

    const listFinal = await callDaemon('/connections');
    console.log('Final connections (should not contain test-local):', listFinal);
    const hasLocalFinal = listFinal.some((c: any) => c.id === 'test-local');
    if (hasLocalFinal) {
      throw new Error('Disconnection verify failed!');
    }

    console.log('\n--- 6. Testing Daemon Shutdown ---');
    if (listFinal.length > 0) {
      console.log('Skipping daemon shutdown test because other active connections are present:', listFinal);
    } else {
      await callDaemon('/shutdown', undefined, 'POST');
      console.log('Daemon shut down.');
    }

    console.log('\nAll tests passed successfully!');
  } catch (err: any) {
    console.error('\nTest failed with error:', err.message);
    try {
      const listFinal = await callDaemon('/connections').catch(() => []);
      if (listFinal.length === 0) {
        await callDaemon('/shutdown', undefined, 'POST');
      }
    } catch {}
    process.exit(1);
  } finally {
    sshServer.close();
  }
}

main();
