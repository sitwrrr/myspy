// mcp-tool-registry.js - MCP 工具注册表
class MCPToolRegistry {
    constructor() {
        this.tools = new Map(); // name -> { name, description, parameters, server, type }
    }

    // 注册工具
    registerTools(serverName, tools, transportType) {
        for (const tool of tools) {
            this.tools.set(tool.name, {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema || tool.parameters || {},
                server: serverName,
                type: transportType
            });
        }
    }

    // 查找工具
    findTool(toolName) {
        return this.tools.get(toolName) || null;
    }

    // 判断是否为 MCP 工具
    isMCPTool(toolName) {
        const tool = this.tools.get(toolName);
        return tool && (tool.type === 'mcp' || tool.type === 'mcp_http');
    }

    // 转换为 OpenAI Function Calling 格式
    toOpenAIFormat() {
        const result = [];
        for (const [, tool] of this.tools) {
            result.push({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            });
        }
        return result;
    }

    // 获取工具数量
    getToolCount() {
        return this.tools.size;
    }

    // 清空
    clear() {
        this.tools.clear();
    }
}

module.exports = { MCPToolRegistry };
