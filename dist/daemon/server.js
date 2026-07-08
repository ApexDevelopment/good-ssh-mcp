import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SSHConnectionManager } from './manager.js';
const CONFIG_DIR = path.join(os.homedir(), '.good-ssh-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'daemon.json');
export async function getDaemonConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
export async function saveDaemonConfig(config) {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}
export async function removeDaemonConfig() {
    try {
        await fs.unlink(CONFIG_FILE);
    }
    catch { }
}
export class DaemonServer {
    server = null;
    manager = new SSHConnectionManager();
    token = '';
    port = 0;
    constructor() {
        this.token = crypto.randomUUID();
    }
    parseJsonBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                try {
                    resolve(body ? JSON.parse(body) : {});
                }
                catch (e) {
                    reject(new Error('Invalid JSON body'));
                }
            });
        });
    }
    sendJson(res, statusCode, data) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    sendError(res, statusCode, message) {
        this.sendJson(res, statusCode, { error: message });
    }
    async start(preferredPort = 23114) {
        this.port = preferredPort;
        this.server = http.createServer(async (req, res) => {
            // CORS check if needed (only allow localhost)
            const clientAddr = req.socket.remoteAddress;
            const isLocal = clientAddr === '127.0.0.1' || clientAddr === '::1' || clientAddr === '::ffff:127.0.0.1';
            if (!isLocal) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            // Handle ping without auth
            if (req.method === 'GET' && req.url === '/ping') {
                this.sendJson(res, 200, { status: 'ok', pid: process.pid });
                return;
            }
            // Verify token
            const authHeader = req.headers['authorization'];
            if (!authHeader || authHeader !== `Bearer ${this.token}`) {
                this.sendError(res, 401, 'Unauthorized');
                return;
            }
            try {
                const url = req.url || '';
                const method = req.method || 'GET';
                if (method === 'GET' && url === '/connections') {
                    this.sendJson(res, 200, this.manager.list());
                    return;
                }
                if (method === 'POST') {
                    const body = await this.parseJsonBody(req);
                    switch (url) {
                        case '/connect': {
                            const info = await this.manager.connect(body);
                            this.sendJson(res, 200, info);
                            break;
                        }
                        case '/disconnect': {
                            if (!body.connectionId) {
                                this.sendError(res, 400, 'Missing connectionId');
                                break;
                            }
                            this.manager.disconnect(body.connectionId);
                            this.sendJson(res, 200, { status: 'disconnected' });
                            break;
                        }
                        case '/execute': {
                            if (!body.connectionId || !body.command) {
                                this.sendError(res, 400, 'Missing connectionId or command');
                                break;
                            }
                            const result = await this.manager.execute(body.connectionId, body.command, {
                                cwd: body.cwd,
                                env: body.env
                            });
                            this.sendJson(res, 200, result);
                            break;
                        }
                        case '/cd': {
                            if (!body.connectionId || !body.path) {
                                this.sendError(res, 400, 'Missing connectionId or path');
                                break;
                            }
                            const newCwd = await this.manager.changeDirectory(body.connectionId, body.path);
                            this.sendJson(res, 200, { cwd: newCwd });
                            break;
                        }
                        case '/upload-file': {
                            if (!body.connectionId || !body.localPath || !body.remotePath) {
                                this.sendError(res, 400, 'Missing required fields');
                                break;
                            }
                            await this.manager.uploadFile(body.connectionId, body.localPath, body.remotePath);
                            this.sendJson(res, 200, { status: 'success' });
                            break;
                        }
                        case '/download-file': {
                            if (!body.connectionId || !body.remotePath || !body.localPath) {
                                this.sendError(res, 400, 'Missing required fields');
                                break;
                            }
                            await this.manager.downloadFile(body.connectionId, body.remotePath, body.localPath);
                            this.sendJson(res, 200, { status: 'success' });
                            break;
                        }
                        case '/upload-dir': {
                            if (!body.connectionId || !body.localPath || !body.remotePath) {
                                this.sendError(res, 400, 'Missing required fields');
                                break;
                            }
                            await this.manager.uploadDirectory(body.connectionId, body.localPath, body.remotePath);
                            this.sendJson(res, 200, { status: 'success' });
                            break;
                        }
                        case '/download-dir': {
                            if (!body.connectionId || !body.remotePath || !body.localPath) {
                                this.sendError(res, 400, 'Missing required fields');
                                break;
                            }
                            await this.manager.downloadDirectory(body.connectionId, body.remotePath, body.localPath);
                            this.sendJson(res, 200, { status: 'success' });
                            break;
                        }
                        case '/get-file': {
                            if (!body.connectionId || !body.remotePath) {
                                this.sendError(res, 400, 'Missing connectionId or remotePath');
                                break;
                            }
                            const content = await this.manager.getFileContents(body.connectionId, body.remotePath);
                            this.sendJson(res, 200, { content });
                            break;
                        }
                        case '/write-file': {
                            if (!body.connectionId || !body.remotePath || body.content === undefined) {
                                this.sendError(res, 400, 'Missing required fields');
                                break;
                            }
                            await this.manager.writeFileContents(body.connectionId, body.remotePath, body.content);
                            this.sendJson(res, 200, { status: 'success' });
                            break;
                        }
                        case '/shutdown': {
                            this.sendJson(res, 200, { status: 'shutting down' });
                            this.stop();
                            break;
                        }
                        default:
                            this.sendError(res, 404, 'Not Found');
                    }
                }
                else {
                    this.sendError(res, 404, 'Not Found');
                }
            }
            catch (err) {
                this.sendError(res, 500, err.message || 'Internal Server Error');
            }
        });
        return new Promise((resolve, reject) => {
            this.server?.listen(this.port, '127.0.0.1', async () => {
                const config = {
                    port: this.port,
                    token: this.token,
                    pid: process.pid
                };
                await saveDaemonConfig(config);
                resolve(config);
            });
            this.server?.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    // If port in use, retry with another random port
                    this.port = 0; // Let OS choose random port
                    this.server?.listen(0, '127.0.0.1');
                }
                else {
                    reject(err);
                }
            });
        });
    }
    stop() {
        this.manager.disconnectAll();
        if (this.server) {
            this.server.close();
        }
        removeDaemonConfig();
        process.exit(0);
    }
}
