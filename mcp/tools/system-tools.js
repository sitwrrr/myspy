// system-tools.js - 系统工具 MCP 服务（执行命令、系统信息、进程管理）
const readline = require('readline');
const { exec, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tools = [
    {
        name: 'execute_command',
        description: '执行系统命令并返回输出（支持 shell 命令，如 dir、ipconfig、tasklist 等）',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: '要执行的命令'
                },
                cwd: {
                    type: 'string',
                    description: '工作目录（可选，默认当前目录）'
                },
                timeout: {
                    type: 'number',
                    description: '超时时间（毫秒），默认 30000'
                }
            },
            required: ['command']
        }
    },
    {
        name: 'get_system_info',
        description: '获取系统信息（操作系统、CPU、内存、磁盘、网络等）',
        inputSchema: {
            type: 'object',
            properties: {
                info_type: {
                    type: 'string',
                    description: '信息类型：all（全部）、os（系统）、cpu、memory、disk、network，默认 all'
                }
            }
        }
    },
    {
        name: 'list_processes',
        description: '列出正在运行的进程',
        inputSchema: {
            type: 'object',
            properties: {
                filter: {
                    type: 'string',
                    description: '进程名过滤关键词（可选）'
                }
            }
        }
    },
    {
        name: 'read_file_lines',
        description: '读取文件的指定行范围（适合读取日志或大文件的部分内容）',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '文件路径' },
                start: { type: 'number', description: '起始行号（从 1 开始）' },
                end: { type: 'number', description: '结束行号（可选，默认读到文件末尾）' }
            },
            required: ['path', 'start']
        }
    },
    {
        name: 'find_files',
        description: '在指定目录中搜索文件（支持通配符模式）',
        inputSchema: {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '搜索目录' },
                pattern: { type: 'string', description: '文件名模式（如 *.txt、*.js）' },
                max_results: { type: 'number', description: '最大返回数量，默认 50' }
            },
            required: ['dir', 'pattern']
        }
    }
];

// ===== 工具实现 =====

function runCommand(command, cwd, timeout) {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const options = {
            cwd: cwd || process.cwd(),
            timeout: timeout || 30000,
            maxBuffer: 1024 * 1024, // 1MB
            encoding: 'utf-8',
            shell: true,
            // Windows 下通过 cmd.exe 执行，避免 Git Bash 环境问题
            ...(isWin ? { shell: 'cmd.exe' } : {})
        };
        exec(command, options, (error, stdout, stderr) => {
            let output = '';
            if (stdout) output += stdout;
            if (stderr) output += (output ? '\n--- STDERR ---\n' : '') + stderr;
            if (error) {
                if (!output) output = `错误: ${error.message}`;
                if (error.killed) output += '\n命令已超时被终止';
            }
            // 截断过长输出
            if (output.length > 10000) {
                output = output.substring(0, 10000) + '\n\n... (输出已截断，共 ' + output.length + ' 字符)';
            }
            resolve(output || '命令执行完成（无输出）');
        });
    });
}

function getSystemInfo(infoType) {
    const type = infoType || 'all';
    const info = {};

    if (type === 'all' || type === 'os') {
        info.os = {
            操作系统: `${os.type()} ${os.release()}`,
            平台: os.platform(),
            架构: os.arch(),
            主机名: os.hostname(),
            运行时间: `${Math.floor(os.uptime() / 3600)}小时 ${Math.floor((os.uptime() % 3600) / 60)}分钟`
        };
    }

    if (type === 'all' || type === 'cpu') {
        const cpus = os.cpus();
        info.cpu = {
            型号: cpus[0]?.model || '未知',
            核心数: cpus.length,
            速度: `${cpus[0]?.speed || 0} MHz`
        };
    }

    if (type === 'all' || type === 'memory') {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        info.memory = {
            总内存: `${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
            可用内存: `${(freeMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
            已用内存: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)} GB`,
            使用率: `${((1 - freeMem / totalMem) * 100).toFixed(1)}%`
        };
    }

    if (type === 'all' || type === 'disk') {
        try {
            // Windows: 使用 wmic 获取磁盘信息
            const diskOutput = execSync('wmic logicaldisk where "DriveType=3" get DeviceID,Size,FreeSpace /format:csv', {
                encoding: 'utf-8', timeout: 5000, shell: 'cmd.exe'
            });
            const lines = diskOutput.trim().split('\n').filter(l => l.includes(','));
            info.disk = [];
            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 4 && parts[1]) {
                    const drive = parts[1];
                    const free = parseInt(parts[2]) || 0;
                    const total = parseInt(parts[3]) || 0;
                    if (total > 0) {
                        info.disk.push({
                            盘符: drive,
                            总容量: `${(total / 1024 / 1024 / 1024).toFixed(1)} GB`,
                            可用: `${(free / 1024 / 1024 / 1024).toFixed(1)} GB`,
                            使用率: `${((1 - free / total) * 100).toFixed(1)}%`
                        });
                    }
                }
            }
        } catch (e) {
            info.disk = '获取磁盘信息失败';
        }
    }

    if (type === 'all' || type === 'network') {
        const nets = os.networkInterfaces();
        info.network = {};
        for (const [name, addrs] of Object.entries(nets)) {
            const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
            if (ipv4) {
                info.network[name] = { IP: ipv4.address, MAC: ipv4.mac };
            }
        }
    }

    return info;
}

function listProcesses(filter) {
    try {
        // Windows: tasklist
        const output = execSync('tasklist /fo csv /nh', { encoding: 'utf-8', timeout: 10000, shell: 'cmd.exe' });
        const lines = output.trim().split('\n');
        const processes = [];
        for (const line of lines) {
            // CSV 格式: "name","PID","session","session#","mem"
            const match = line.match(/"([^"]+)","(\d+)"/);
            if (match) {
                const name = match[1];
                const pid = match[2];
                if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
                processes.push({ 进程名: name, PID: pid });
            }
        }
        if (processes.length > 200) {
            return { 总数: processes.length, 进程: processes.slice(0, 200), 提示: '仅显示前 200 个' };
        }
        return { 总数: processes.length, 进程: processes };
    } catch (e) {
        return `获取进程列表失败: ${e.message}`;
    }
}

function readFileLines(filePath, start, end) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const s = Math.max(0, (start || 1) - 1);
        const e = end ? Math.min(end, lines.length) : lines.length;
        const selected = lines.slice(s, e);
        return selected.map((line, i) => `${s + i + 1}\t${line}`).join('\n');
    } catch (e) {
        return `读取失败: ${e.message}`;
    }
}

function findFiles(dir, pattern, maxResults) {
    const max = maxResults || 50;
    const results = [];

    function search(currentDir, depth) {
        if (depth > 5 || results.length >= max) return;
        try {
            const items = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const item of items) {
                if (results.length >= max) break;
                const fullPath = path.join(currentDir, item.name);
                if (item.isDirectory()) {
                    if (!item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== '__pycache__') {
                        search(fullPath, depth + 1);
                    }
                } else {
                    // 简单通配符匹配
                    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
                    if (regex.test(item.name)) {
                        results.push(fullPath);
                    }
                }
            }
        } catch (e) { /* 跳过无权限目录 */ }
    }

    search(dir, 0);
    return results.length > 0 ? results.join('\n') : '未找到匹配的文件';
}

async function handleTool(name, args) {
    switch (name) {
        case 'execute_command':
            return await runCommand(args.command, args.cwd, args.timeout);
        case 'get_system_info':
            return JSON.stringify(getSystemInfo(args.info_type), null, 2);
        case 'list_processes':
            return JSON.stringify(listProcesses(args.filter), null, 2);
        case 'read_file_lines':
            return readFileLines(args.path, args.start, args.end);
        case 'find_files':
            return findFiles(args.dir, args.pattern, args.max_results);
        default:
            return `未知工具: ${name}`;
    }
}

// ===== MCP JSON-RPC 处理 =====

function handleRequest(request) {
    const { id, method, params } = request;

    if (method === 'initialize') {
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'system-tools', version: '1.0.0' } } };
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools } };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;
        return handleTool(name, args || {}).then(
            result => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] } }),
            e => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `错误: ${e.message}` }] } })
        );
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `方法 ${method} 不存在` } };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
    try {
        const request = JSON.parse(line);
        const response = handleRequest(request);
        Promise.resolve(response).then(r => {
            process.stdout.write(JSON.stringify(r) + '\n');
        });
    } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '解析错误' } }) + '\n');
    }
});
