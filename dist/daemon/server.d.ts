import { DaemonConfig } from '../shared/types.js';
export declare function getDaemonConfig(): Promise<DaemonConfig | null>;
export declare function saveDaemonConfig(config: DaemonConfig): Promise<void>;
export declare function removeDaemonConfig(): Promise<void>;
export declare class DaemonServer {
    private server;
    private manager;
    private token;
    private port;
    constructor();
    private parseJsonBody;
    private sendJson;
    private sendError;
    start(preferredPort?: number): Promise<DaemonConfig>;
    stop(): void;
}
