---
name: good-ssh-mcp
description: Installs, configures, and uses the stateful Good SSH MCP server and CLI tool. This skill teaches agents how to connect to remote servers, manage directories, run commands, and transfer files/folders statefully.
---

# Good SSH MCP Server & CLI Tool

Managing remote machines via SSH can be error-prone for AI agents due to quoting hassles, escaping issues, shell character limits, and the overhead of constantly reconnecting. This tool solves those issues by running a local background daemon that keeps SSH sessions alive statefully, resolves paths, and exposes simple, agent-friendly tools.

## Key Features

* **Stateful Sessions**: Reuses active background SSH connections, avoiding reconnect overhead.
* **Stateful Working Directory**: Tracks and maintains your current directory (`cwd`) across command executions without requiring chained `cd` statements.
* **Respects `~/.ssh/config` & SSH Agent**: Automatically parses your `~/.ssh/config` file to resolve host aliases, default usernames, custom ports, and `IdentityFile` paths, falling back to your local `ssh-agent` automatically for keyless login.
* **Quoting-Safe File Handling**: Reads and writes files directly via SFTP, avoiding terminal quote escaping, shell limits, and character encoding issues.

## Installation & Setup

You can run or install `good-ssh-mcp` using any of the following methods:

### Method 1: Direct Global Installation (Recommended)
Install the CLI and MCP binaries globally straight from the GitHub tarball archive (bypasses any local git configuration clashes in npm):
```bash
npm install -g https://github.com/ApexDevelopment/good-ssh-mcp/archive/refs/heads/main.tar.gz
```
This registers `good-ssh` (CLI), `good-ssh-mcp` (MCP Server), and `good-ssh-daemon` (Background daemon) globally on your local PATH.

### Method 2: On-the-Fly Execution via `npx` (Zero-Installation)
Execute command line commands or configure the MCP server dynamically without permanent global installation:
* **Running the CLI**:
  ```bash
  npx -y https://github.com/ApexDevelopment/good-ssh-mcp/archive/refs/heads/main.tar.gz connect <host>
  ```
* **For MCP server configuration** (Use this command directly inside Cursor/Claude Desktop settings):
  ```json
  "good-ssh-mcp": {
    "command": "npx",
    "args": ["-y", "https://github.com/ApexDevelopment/good-ssh-mcp/archive/refs/heads/main.tar.gz"]
  }
  ```

### Method 3: Local Build from Source
If you want to clone the repository and build manually:
1. **Clone the repository**:
   ```bash
   git clone https://github.com/ApexDevelopment/good-ssh-mcp.git
   cd good-ssh-mcp
   ```
2. **Install and compile**:
   ```bash
   npm install
   npm run build
   ```
3. **Link binaries globally**:
   ```bash
   npm link
   ```

---

## MCP Server Configuration

To configure this tool in your client (Cursor, Claude Desktop, etc.), add it as an MCP server with the following configurations:

### For Cursor/VSCode (mcp JSON config)
```json
{
  "mcpServers": {
    "good-ssh-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/good-ssh-mcp/dist/mcp/index.js"]
    }
  }
}
```

### For Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "good-ssh-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/good-ssh-mcp/dist/mcp/index.js"]
    }
  }
}
```

---

## Core Features & Workflow

When using this tool, follow this workflow:

1. **Establish a Stateful Connection**: Use `ssh_connect` to connect to a host. You can specify a unique `connectionId` (e.g. `prod-web-1`) to identify this connection.
2. **Explore Host Metadata**: Run `ssh_list_connections` to see all active connections, their remote OS (`linux`, `darwin`, `windows`), remote shell (`/bin/bash`, `powershell`, `cmd`), and current working directory (`cwd`).
3. **Execute Commands Statefuly**: Use `ssh_execute_command` to execute commands. The CWD is preserved statefully between calls, meaning you don't need to chain `cd` commands.
4. **Change Working Directory**: Use `ssh_change_directory` to change the working directory. It validates that the directory exists on the remote host and resolves it to an absolute path.
5. **Manage Files & Folders**: 
   - Use `ssh_get_file_contents` to read text files directly.
   - Use `ssh_write_file_contents` to write text files directly.
   - Use `ssh_upload_file` / `ssh_download_file` to copy individual files.
   - Use `ssh_upload_directory` / `ssh_download_directory` to copy folders recursively.
6. **Disconnect**: Use `ssh_disconnect` to close a session, or use the CLI command `good-ssh shutdown` to shut down the background daemon and terminate all active connections.

---

## Tool API Reference

### 1. `ssh_connect`
Establishes a stateful SSH connection.
- **Arguments**:
  - `host` (string, required): The target host address or a Host alias from your `~/.ssh/config` file.
  - `port` (number, optional): Remote SSH port. If omitted, defaults to the port in `~/.ssh/config`, falling back to 22.
  - `username` (string, optional): Remote SSH username. Optional if defined under a matching Host section in `~/.ssh/config`.
  - `password` (string, optional): Optional password authentication.
  - `privateKey` (string, optional): A filepath (e.g., `~/.ssh/id_rsa`) or raw private key PEM string. Optional if `IdentityFile` is defined in `~/.ssh/config`.
  - `passphrase` (string, optional): For encrypted private keys.
  - `connectionId` (string, optional): Custom unique identifier. Defaults to the Host alias if used, or `username@host:port`.

### 2. `ssh_disconnect`
Closes a connection.
- **Arguments**:
  - `connectionId` (string, required)

### 3. `ssh_list_connections`
Lists all active connections. No parameters.

### 4. `ssh_execute_command`
Executes a command.
- **Arguments**:
  - `connectionId` (string, required)
  - `command` (string, required)
  - `cwd` (string, optional): Temporary CWD override for this command.
  - `env` (object, optional): Key-value pairs for remote environment variables.

### 5. `ssh_change_directory`
Updates the stateful CWD for a connection.
- **Arguments**:
  - `connectionId` (string, required)
  - `path` (string, required): Directory path (absolute or relative).

### 6. `ssh_change_shell`
Updates the active execution shell for a connection.
- **Arguments**:
  - `connectionId` (string, required)
  - `shell` (string, required): Target shell (e.g. `powershell`, `cmd`, `/bin/bash`, `/bin/zsh`, `/usr/bin/pwsh`).

### 7. `ssh_get_file_contents` / `ssh_write_file_contents`
Directly read/write files via SFTP to avoid terminal quoting issues.
- **Arguments**:
  - `connectionId` (string, required)
  - `remotePath` (string, required)
  - `content` (string, required, only for `ssh_write_file_contents`)

### 8. `ssh_upload_file` / `ssh_download_file`
Upload/download single files.
- **Arguments**:
  - `connectionId` (string, required)
  - `localPath` (string, required)
  - `remotePath` (string, required)

### 9. `ssh_upload_directory` / `ssh_download_directory`
Recursively transfer directories.
- **Arguments**:
  - `connectionId` (string, required)
  - `localPath` (string, required)
  - `remotePath` (string, required)

---

## CLI Tool Usage

The CLI tool `good-ssh` provides exact feature parity with the MCP endpoint, communicating with the same background daemon so active sessions are shared:

```bash
# Connect to a host
good-ssh connect 192.168.1.50 -u root --id my-server

# List active connections
good-ssh list

# Execute a command
good-ssh exec my-server "ls -la"

# Change directory
good-ssh cd my-server /var/log

# Change active shell statefully
good-ssh shell my-server powershell

# Read a remote file
good-ssh cat my-server /var/log/nginx/error.log

# Write a remote file
good-ssh write my-server /tmp/config.json "{\"env\": \"prod\"}"
# OR pipe to stdin
echo 'Hello Remote' | good-ssh write my-server /tmp/test.txt

# Upload a folder recursively
good-ssh upload my-server ./local-folder /remote/folder

# Download a folder recursively
good-ssh download my-server /remote/folder ./local-folder

# Terminate a connection
good-ssh disconnect my-server

# Terminate the background daemon and disconnect all sessions
good-ssh shutdown
```
