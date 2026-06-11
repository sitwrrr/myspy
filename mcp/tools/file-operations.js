// file-operations.js - 文件操作 MCP 工具
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const tools = [
    {
        name: 'read_file',
        description: '读取文件内容',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '文件路径'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'write_file',
        description: '写入文件内容',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '文件路径'
                },
                content: {
                    type: 'string',
                    description: '文件内容'
                }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'create_directory',
        description: '创建目录',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '目录路径'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'list_directory',
        description: '列出目录内容',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '目录路径'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'file_exists',
        description: '检查文件或目录是否存在',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '文件或目录路径'
                }
            },
            required: ['path']
        }
    }
];

function handleRequest(request) {
    const { id, method, params } = request;

    if (method === 'initialize') {
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'file-operations', version: '1.0.0' } } };
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools } };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;
        try {
            let result = '';
            switch (name) {
                case 'read_file':
                    result = fs.readFileSync(args.path, 'utf8');
                    break;
                case 'write_file':
                    fs.writeFileSync(args.path, args.content, 'utf8');
                    result = `文件已写入: ${args.path}`;
                    break;
                case 'create_directory':
                    fs.mkdirSync(args.path, { recursive: true });
                    result = `目录已创建: ${args.path}`;
                    break;
                case 'list_directory':
                    const items = fs.readdirSync(args.path);
                    result = items.join('\n');
                    break;
                case 'file_exists':
                    result = fs.existsSync(args.path) ? '存在' : '不存在';
                    break;
                default:
                    return { jsonrpc: '2.0', id, error: { code: -32601, message: `工具 ${name} 不存在` } };
            }
            return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } };
        } catch (e) {
            return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `错误: ${e.message}` }] } };
        }
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `方法 ${method} 不存在` } };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
    try {
        const request = JSON.parse(line);
        const response = handleRequest(request);
        process.stdout.write(JSON.stringify(response) + '\n');
    } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '解析错误' } }) + '\n');
    }
});