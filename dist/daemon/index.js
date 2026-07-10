import { DaemonServer, getDaemonConfig, removeDaemonConfig } from './server.js';
async function main() {
    // Register process-level handlers to make the daemon resilient to unhandled crashes
    process.on('uncaughtException', (err) => {
        console.error('Daemon uncaught exception:', err);
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Daemon unhandled rejection at:', promise, 'reason:', reason);
    });
    const existingConfig = await getDaemonConfig();
    if (existingConfig) {
        // Ping to verify if it is actually alive
        try {
            const res = await fetch(`http://127.0.0.1:${existingConfig.port}/ping`, {
                headers: { 'Connection': 'close' },
                signal: AbortSignal.timeout(1000)
            });
            if (res.ok) {
                console.log(`Good SSH Daemon is already running on port ${existingConfig.port} (PID: ${existingConfig.pid})`);
                process.exit(0);
            }
        }
        catch {
            // Daemon dead, cleanup config
            await removeDaemonConfig();
        }
    }
    const server = new DaemonServer();
    // Register signal handlers for graceful shutdown
    const shutdown = () => {
        console.log('Shutting down Good SSH Daemon...');
        server.stop();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    try {
        const config = await server.start();
        console.log(`Good SSH Daemon started on http://127.0.0.1:${config.port}`);
        console.log(`Token: ${config.token}`);
        console.log(`PID: ${config.pid}`);
    }
    catch (err) {
        console.error('Failed to start daemon:', err.message);
        process.exit(1);
    }
}
main();
