// mcp-manager.js - MCP 中央管理器
const fs = require('fs');
const path = require('path');
const { MCPToolRegistry } = require('./mcp-tool-registry.js');
const { MCPStdioTransport } = require('./mcp-stdio-transport.js');
const { logToTerminal } = require('../api-utils.js');

class MCPManager {
    constructor(config) {
        this.config = config?.mcp || {};
        this.isEnabled = this.config.enabled || false;
        this.toolRegistry = new MCPToolRegistry();
        this.transports = new Map();
        this.startupTimeout = this.config.startup_timeout || 20000;
    }

    // 初始化
    async initialize() {
        if (!this.isEnabled) {
            logToTerminal('info', '[MCP] MCP 已禁用');
            return;
        }

        logToTerminal('info', '[MCP] 开始初始化...');
        const servers = this._loadServersConfig();

        // 分离 JS 和 Python 服务器
        const jsServers = [];
        const pyServers = [];
        for (const [name, config] of Object.entries(servers)) {
            if (name.endsWith('_disabled') || config.disabled) continue;
            const command = config.command || '';
            if (command === 'python' || command === 'python3' || command.endsWith('.py')) {
                pyServers.push([name, config]);
            } else {
                jsServers.push([name, config]);
            }
        }

        logToTerminal('info', `[MCP] 找到 ${jsServers.length} 个 JS 服务器, ${pyServers.length} 个 Python 服务器`);

        // 先启动 JS 服务器
        const jsPromises = jsServers.map(([name, config]) => this._startServer(name, config));
        await Promise.allSettled(jsPromises);

        // 后台启动 Python 服务器
        for (const [name, config] of pyServers) {
            this._startServer(name, config).catch(err => {
                logToTerminal('error', `[MCP] Python 服务器 ${name} 启动失败: ${err.message}`);
            });
        }

        logToTerminal('info', `[MCP] 初始化完成，已注册 ${this.toolRegistry.getToolCount()} 个工具`);
    }

    // 加载服务器配置
    _loadServersConfig() {
        const configPath = this.config.config_path;
        if (configPath) {
            const fullPath = path.join(__dirname, '..', '..', configPath);
            if (fs.existsSync(fullPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                    return data.servers || data;
                } catch (e) {
                    logToTerminal('error', '[MCP] 配置文件读取失败: ' + e.message);
                }
            }
        }
        return this.config.servers || {};
    }

    // 启动单个服务器
    async _startServer(name, config) {
        try {
            logToTerminal('info', `[MCP] 启动服务器: ${name}`);
            const transport = new MCPStdioTransport(name, config, this.toolRegistry);
            await transport.start();
            this.transports.set(name, transport);
            logToTerminal('info', `[MCP] 服务器 ${name} 启动成功`);
        } catch (err) {
            logToTerminal('error', `[MCP] 服务器 ${name} 启动失败: ${err.message}`);
        }
    }

    // 获取工具列表（供 LLM 使用）
    getToolsForLLM() {
        return this.toolRegistry.toOpenAIFormat();
    }

    // 处理工具调用
    async handleToolCalls(toolCalls) {
        const results = [];
        for (const toolCall of toolCalls) {
            const name = toolCall.function.name;
            if (!this.toolRegistry.isMCPTool(name)) continue;

            try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const tool = this.toolRegistry.findTool(name);
                const transport = this.transports.get(tool.server);
                if (!transport) throw new Error(`服务器 ${tool.server} 未找到`);

                const result = await transport.callTool(name, args);
                results.push({ tool_call_id: toolCall.id, content: result });
            } catch (err) {
                results.push({ tool_call_id: toolCall.id, content: `错误: ${err.message}` });
            }
        }
        return results;
    }

    // 停止所有服务器
    stop() {
        for (const [name, transport] of this.transports) {
            transport.stop();
        }
        this.transports.clear();
        this.toolRegistry.clear();
    }
}

module.exports = { MCPManager };
