// mcp-stdio-transport.js - MCP Stdio 传输（JSON-RPC 2.0 over stdin/stdout）
const { spawn } = require('child_process');
const path = require('path');
const { logToTerminal } = require('../api-utils.js');

class MCPStdioTransport {
    constructor(name, config, toolRegistry) {
        this.name = name;
        this.config = config;
        this.toolRegistry = toolRegistry;
        this.process = null;
        this.buffer = '';
        this.pendingRequests = new Map();
        this.isReady = false;
    }

    // 启动服务器
    async start() {
        return new Promise((resolve, reject) => {
            const command = this.config.command;
            const args = this.config.args || [];
            const cwd = this.config.cwd || path.join(__dirname, '..', '..');

            const env = { ...process.env, FASTMCP_QUIET: '1' };

            this.process = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
                cwd,
                env
            });

            this.process.stdout.on('data', (data) => this._onStdout(data));
            this.process.stderr.on('data', (data) => {
                logToTerminal('warn', `[MCP:${this.name}] stderr: ${data}`);
            });

            this.process.on('error', (err) => {
                logToTerminal('error', `[MCP:${this.name}] 启动失败: ${err.message}`);
                reject(err);
            });

            this.process.on('exit', (code) => {
                logToTerminal('info', `[MCP:${this.name}] 进程退出，代码: ${code}`);
                this.isReady = false;
            });

            // 初始化握手
            this._initialize().then(resolve).catch(reject);
        });
    }

    // 发送 JSON-RPC 请求
    _sendRequest(method, params = {}) {
        const id = `${this.name}_${method}_${Date.now()}`;
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.process.stdin.write(JSON.stringify(request) + '\n');
        });
    }

    // 处理 stdout 数据
    _onStdout(data) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const message = JSON.parse(line);
                if (message.id && this.pendingRequests.has(message.id)) {
                    const { resolve, reject } = this.pendingRequests.get(message.id);
                    this.pendingRequests.delete(message.id);

                    if (message.error) {
                        reject(new Error(message.error.message || 'MCP 调用失败'));
                    } else {
                        resolve(message.result);
                    }
                }
            } catch (e) {
                logToTerminal('error', `[MCP:${this.name}] 解析消息失败: ${e.message}`);
            }
        }
    }

    // 初始化握手
    async _initialize() {
        try {
            await this._sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'myspy-mcp-client', version: '1.0.0' }
            });

            // 获取工具列表
            const result = await this._sendRequest('tools/list');
            if (result && result.tools) {
                this.toolRegistry.registerTools(this.name, result.tools, 'mcp');
                logToTerminal('info', `[MCP:${this.name}] 已注册 ${result.tools.length} 个工具`);
            }

            this.isReady = true;
        } catch (err) {
            logToTerminal('error', `[MCP:${this.name}] 初始化失败: ${err.message}`);
            throw err;
        }
    }

    // 调用工具
    async callTool(name, args) {
        const result = await this._sendRequest('tools/call', { name, arguments: args });
        if (result && result.content) {
            const textItem = result.content.find(c => c.type === 'text');
            if (textItem) return textItem.text;
        }
        return JSON.stringify(result);
    }

    // 停止服务器
    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.isReady = false;
    }
}

module.exports = { MCPStdioTransport };
