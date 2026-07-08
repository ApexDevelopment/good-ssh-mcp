import { DaemonConfig } from './types.js';
export declare function getOrStartDaemon(): Promise<DaemonConfig>;
export declare function callDaemon(endpoint: string, body?: any, method?: string): Promise<any>;
