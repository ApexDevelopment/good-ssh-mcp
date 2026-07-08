export interface ConnectionInfo {
    id: string;
    host: string;
    port: number;
    username: string;
    os: 'linux' | 'darwin' | 'windows' | 'unknown';
    shell: string;
    cwd: string;
    connectedAt: string;
    lastUsedAt: string;
}
export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal?: string;
}
export interface DaemonConfig {
    port: number;
    token: string;
    pid: number;
}
