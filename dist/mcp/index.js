import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { callDaemon } from "../shared/client.js";
const server = new Server({
    name: "good-ssh-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ssh_connect",
                description: "Establish a stateful SSH connection to a remote machine. Connection remains active in the background.",
                inputSchema: {
                    type: "object",
                    properties: {
                        host: { type: "string", description: "Remote host address." },
                        port: { type: "number", description: "Remote SSH port. Defaults to 22." },
                        username: { type: "string", description: "Remote SSH username. Optional if defined in ~/.ssh/config." },
                        password: { type: "string", description: "Optional password authentication." },
                        privateKey: { type: "string", description: "Optional private key filepath (e.g. ~/.ssh/id_rsa) or private key content." },
                        passphrase: { type: "string", description: "Optional passphrase for private key." },
                        connectionId: { type: "string", description: "Optional unique name for this connection. Defaults to username@host:port." }
                    },
                    required: ["host"]
                }
            },
            {
                name: "ssh_disconnect",
                description: "Close an active stateful SSH connection.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection to terminate." }
                    },
                    required: ["connectionId"]
                }
            },
            {
                name: "ssh_list_connections",
                description: "List all active stateful SSH connections, detailing OS, shell, and current working directory.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "ssh_execute_command",
                description: "Execute a shell command on the remote machine. Runs relative to the stateful CWD.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        command: { type: "string", description: "The shell command to run." },
                        cwd: { type: "string", description: "Optional directory path to execute the command in. Does not update stateful CWD." },
                        env: {
                            type: "object",
                            description: "Optional key-value pairs of environment variables to set.",
                            additionalProperties: { type: "string" }
                        }
                    },
                    required: ["connectionId", "command"]
                }
            },
            {
                name: "ssh_change_directory",
                description: "Change the default stateful working directory (CWD) for subsequent executions on a connection.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        path: { type: "string", description: "The path to set as the CWD (absolute or relative to current CWD)." }
                    },
                    required: ["connectionId", "path"]
                }
            },
            {
                name: "ssh_change_shell",
                description: "Change the active command execution shell (e.g. powershell, cmd, /bin/bash, /bin/zsh) for subsequent executions on a connection. Environment variable prepending and directory changes will automatically adjust to use the syntax of the new shell.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        shell: { type: "string", description: "The path or name of the target shell (e.g., 'powershell', 'cmd', '/bin/bash')." }
                    },
                    required: ["connectionId", "shell"]
                }
            },
            {
                name: "ssh_get_file_contents",
                description: "Directly read the text contents of a file on the remote machine via SFTP (avoids shell quote escaping issues).",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        remotePath: { type: "string", description: "Remote path to the file." }
                    },
                    required: ["connectionId", "remotePath"]
                }
            },
            {
                name: "ssh_write_file_contents",
                description: "Directly write text content to a file on the remote machine via SFTP.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        remotePath: { type: "string", description: "Remote path to write to." },
                        content: { type: "string", description: "The content to write to the file." }
                    },
                    required: ["connectionId", "remotePath", "content"]
                }
            },
            {
                name: "ssh_upload_file",
                description: "Upload a single file from the local machine to the remote machine.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        localPath: { type: "string", description: "Local path to the source file." },
                        remotePath: { type: "string", description: "Remote path to the destination file." }
                    },
                    required: ["connectionId", "localPath", "remotePath"]
                }
            },
            {
                name: "ssh_download_file",
                description: "Download a single file from the remote machine to the local machine.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        remotePath: { type: "string", description: "Remote path to the source file." },
                        localPath: { type: "string", description: "Local path to the destination file." }
                    },
                    required: ["connectionId", "remotePath", "localPath"]
                }
            },
            {
                name: "ssh_upload_directory",
                description: "Recursively upload a local directory to the remote machine.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        localPath: { type: "string", description: "Local directory path to upload." },
                        remotePath: { type: "string", description: "Remote destination directory path." }
                    },
                    required: ["connectionId", "localPath", "remotePath"]
                }
            },
            {
                name: "ssh_download_directory",
                description: "Recursively download a remote directory to the local machine.",
                inputSchema: {
                    type: "object",
                    properties: {
                        connectionId: { type: "string", description: "The ID/tag of the connection." },
                        remotePath: { type: "string", description: "Remote directory path to download." },
                        localPath: { type: "string", description: "Local destination directory path." }
                    },
                    required: ["connectionId", "remotePath", "localPath"]
                }
            }
        ]
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "ssh_connect": {
                const res = await callDaemon("/connect", args);
                return {
                    content: [{ type: "text", text: `Successfully connected to SSH host!\nConnection Info: ${JSON.stringify(res, null, 2)}` }]
                };
            }
            case "ssh_disconnect": {
                await callDaemon("/disconnect", args);
                return {
                    content: [{ type: "text", text: `Disconnected connection: ${args?.connectionId}` }]
                };
            }
            case "ssh_list_connections": {
                const res = await callDaemon("/connections");
                if (res.length === 0) {
                    return {
                        content: [{ type: "text", text: "No active SSH connections open." }]
                    };
                }
                return {
                    content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
                };
            }
            case "ssh_execute_command": {
                const res = await callDaemon("/execute", args);
                return {
                    content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
                };
            }
            case "ssh_change_directory": {
                const res = await callDaemon("/cd", args);
                return {
                    content: [{ type: "text", text: `CWD updated to: ${res.cwd}` }]
                };
            }
            case "ssh_change_shell": {
                const res = await callDaemon("/shell", args);
                return {
                    content: [{ type: "text", text: `Active shell updated to: ${res.shell}` }]
                };
            }
            case "ssh_get_file_contents": {
                const res = await callDaemon("/get-file", args);
                return {
                    content: [{ type: "text", text: res.content }]
                };
            }
            case "ssh_write_file_contents": {
                await callDaemon("/write-file", args);
                return {
                    content: [{ type: "text", text: `Successfully wrote file to remote path: ${args?.remotePath}` }]
                };
            }
            case "ssh_upload_file": {
                await callDaemon("/upload-file", args);
                return {
                    content: [{ type: "text", text: `Successfully uploaded ${args?.localPath} to remote path: ${args?.remotePath}` }]
                };
            }
            case "ssh_download_file": {
                await callDaemon("/download-file", args);
                return {
                    content: [{ type: "text", text: `Successfully downloaded remote file ${args?.remotePath} to local path: ${args?.localPath}` }]
                };
            }
            case "ssh_upload_directory": {
                await callDaemon("/upload-dir", args);
                return {
                    content: [{ type: "text", text: `Successfully uploaded directory ${args?.localPath} to remote path: ${args?.remotePath}` }]
                };
            }
            case "ssh_download_directory": {
                await callDaemon("/download-dir", args);
                return {
                    content: [{ type: "text", text: `Successfully downloaded remote directory ${args?.remotePath} to local path: ${args?.localPath}` }]
                };
            }
            default:
                throw new Error(`Tool not found: ${name}`);
        }
    }
    catch (err) {
        return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Good SSH MCP Server running.");
}
main().catch((error) => {
    console.error("Fatal error running MCP Server:", error);
    process.exit(1);
});
