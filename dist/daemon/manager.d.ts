import type { Client } from 'ssh2';
import { ConnectionInfo, CommandResult } from '../shared/types.js';
export interface ActiveConnection {
    client: Client;
    info: ConnectionInfo;
    defaultShell: string;
    homeDir: string;
}
export declare function resolveRemotePath(osType: 'linux' | 'darwin' | 'windows' | 'unknown', homeDir: string, cwd: string, remotePath: string): string;
export declare function parseSshConfig(targetHost: string): Promise<Partial<{
    host: string;
    username: string;
    port: number;
    privateKey: string;
}>>;
export declare class SSHConnectionManager {
    private connections;
    connect(params: {
        host: string;
        port?: number;
        username?: string;
        password?: string;
        privateKey?: string;
        passphrase?: string;
        connectionId?: string;
    }): Promise<ConnectionInfo>;
    disconnect(id: string): void;
    disconnectAll(): void;
    list(): ConnectionInfo[];
    getConnectionInfo(id: string): ConnectionInfo;
    execute(id: string, command: string, options?: {
        cwd?: string;
        env?: Record<string, string>;
    }): Promise<CommandResult>;
    changeShell(id: string, shell: string): Promise<string>;
    changeDirectory(id: string, dirPath: string): Promise<string>;
    runScript(id: string, script: string, extension: string, interpreter?: string): Promise<CommandResult>;
    private resolveRemoteAbsolutePath;
    getFileContents(id: string, remotePath: string): Promise<string>;
    writeFileContents(id: string, remotePath: string, content: string): Promise<void>;
    uploadFile(id: string, localPath: string, remotePath: string): Promise<void>;
    downloadFile(id: string, remotePath: string, localPath: string): Promise<void>;
    uploadDirectory(id: string, localPath: string, remotePath: string): Promise<void>;
    downloadDirectory(id: string, remotePath: string, localPath: string): Promise<void>;
}
