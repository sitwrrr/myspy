// xiaomi-home.js - 小米智能家居 MCP 工具（控制灯光、空调、设备等）
const readline = require('readline');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_PATH = path.join(__dirname, '..', 'xiaomi_config.json');

// ===== 小米云 API =====

const SERVER_MAP = {
    'cn': 'https://api.io.mi.com/app',
    'de': 'https://api.io.mi.com/app',
    'us': 'https://api.io.mi.com/app',
    'ru': 'https://api.io.mi.com/app',
    'tw': 'https://api.io.mi.com/app',
    'sg': 'https://api.io.mi.com/app',
    'in': 'https://api.io.mi.com/app',
    'i2': 'https://api.io.mi.com/app',
};

class XiaomiClient {
    constructor(config) {
        this.username = config.username || '';
        this.password = config.password || '';
        this.server = config.server || 'cn';
        this.apiUrl = SERVER_MAP[this.server] || SERVER_MAP['cn'];
        this.token = null;
        this.userId = null;
        this.cookies = {};
        this.devices = null;
    }

    // HTTP 请求
    _request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const mod = parsed.protocol === 'https:' ? https : http;
            const reqOptions = {
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'MiHome/6.0',
                    ...options.headers
                },
                timeout: 15000
            };
            if (options.cookies) {
                reqOptions.headers['Cookie'] = Object.entries(options.cookies).map(([k,v]) => `${k}=${v}`).join('; ');
            }
            const req = mod.request(url, reqOptions, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    // 保存 cookies
                    const setCookies = res.headers['set-cookie'];
                    if (setCookies) {
                        for (const sc of setCookies) {
                            const [kv] = sc.split(';');
                            const [k, v] = kv.split('=');
                            this.cookies[k.trim()] = v.trim();
                        }
                    }
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode, body, headers: res.headers });
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
            if (options.body) req.write(options.body);
            req.end();
        });
    }

    // 登录获取 token
    async login() {
        if (!this.username || !this.password) {
            throw new Error('未配置小米账号，请在 mcp/xiaomi_config.json 中填写 username 和 password');
        }

        // Step 1: 获取登录页面的 cookie 和 sign
        const passHash = crypto.createHash('md5').update(this.password).digest('hex').toUpperCase();
        const sign = crypto.createHash('md5').update([
            'nonce', '89707236',
            'hide_register', 'false',
            'app_ver', '6.0.3',
            'hash', passHash,
            'sid', 'micoapi',
            '_nonce', '89707236'
        ].join('&')).digest('hex');

        const body = `_json=true&qs=%2Fhome%2Flogin_sns&sid=micoapi&_json=true&passToken=&callback=https%3A%2F%2Fsts.api.io.mi.com%2Fsts&user=${encodeURIComponent(this.username)}&hash=${passHash}&sign=${sign}&_serviceToken=&_nonce=89707236`;

        try {
            const resp = await this._request('https://account.xiaomi.com/pass/serviceLogin', {
                method: 'POST',
                body,
                cookies: { userId: '' }
            });

            // 解析响应
            const jsonStr = resp.body.replace('&&&START&&&', '').trim();
            const data = JSON.parse(jsonStr);

            if (data.code !== 0) {
                throw new Error(`登录失败: ${data.desc || '未知错误'}`);
            }

            // Step 2: 获取 service token
            const ssecurity = data.ssecurity;
            const location = data.location;

            if (!ssecurity || !location) {
                throw new Error('登录失败: 未获取到安全凭证');
            }

            // Step 3: 获取 serviceToken
            const nonce = data.nonce;
            const signStr = `nonce=${nonce}&${ssecurity}`;
            const clientSign = crypto.createHash('sha1').update(signStr).digest('base64');

            const tokenResp = await this._request(`${location}&clientSign=${encodeURIComponent(clientSign)}`, {
                cookies: this.cookies
            });

            // 从 cookies 中提取 serviceToken 和 userId
            this.token = this.cookies.serviceToken;
            this.userId = this.cookies.userId;

            if (!this.token) {
                throw new Error('登录失败: 未获取到 serviceToken');
            }

            return true;
        } catch (e) {
            throw new Error(`小米账号登录失败: ${e.message}`);
        }
    }

    // 发送 API 请求
    async _apiCall(params) {
        if (!this.token) await this.login();

        const nonce = Date.now();
        const sortedParams = Object.keys(params).sort().map(k => `${k}=${JSON.stringify(params[k])}`).join('&');
        const sig = crypto.createHmac('sha256', '').update([
            'nonce',
            nonce,
            'data',
            JSON.stringify(params)
        ].join('&')).digest('base64');

        const body = `data=${encodeURIComponent(JSON.stringify(params))}&signature=${encodeURIComponent(sig)}&_nonce=${nonce}&sid=micoapi`;

        const resp = await this._request(this.apiUrl, {
            method: 'POST',
            body,
            cookies: {
                userId: this.userId,
                serviceToken: this.token,
                sid: 'micoapi'
            }
        });

        const result = JSON.parse(resp.body);
        if (result.code !== 0) {
            // token 过期，重新登录
            if (result.code === -4 || result.code === -8) {
                this.token = null;
                return this._apiCall(params);
            }
            throw new Error(`API 错误: ${result.message || JSON.stringify(result)}`);
        }
        return result.result || result;
    }

    // 获取设备列表
    async getDevices() {
        if (this.devices) return this.devices;

        const result = await this._apiCall({
            id: 1,
            method: 'homeroom.gethome_list',
            params: {}
        });

        // 获取所有房间的设备
        const allDevices = [];
        if (result && result.homelist) {
            for (const home of result.homelist) {
                for (const room of (home.roomlist || [])) {
                    for (const did of (room.dids || [])) {
                        allDevices.push(did);
                    }
                }
            }
        }

        // 获取设备详情
        if (allDevices.length > 0) {
            const detailResult = await this._apiCall({
                id: 2,
                method: 'miot.spec.get_device_list',
                params: { dids: allDevices }
            });

            if (detailResult && detailResult.devices) {
                this.devices = detailResult.devices;
                return this.devices;
            }
        }

        // 备用：通过 devicelist 获取
        try {
            const altResult = await this._apiCall({
                id: 3,
                method: 'device.device_list',
                params: {}
            });
            if (altResult && altResult.list) {
                this.devices = altResult.list;
                return this.devices;
            }
        } catch (e) { /* 忽略 */ }

        this.devices = [];
        return this.devices;
    }

    // 发送设备指令
    async sendCommand(did, method, params) {
        return await this._apiCall({
            id: Date.now(),
            method,
            params: { did, params }
        });
    }

    // 控制设备（通用）
    async controlDevice(deviceName, action, value) {
        const devices = await this.getDevices();
        const device = devices.find(d =>
            (d.name || '').includes(deviceName) ||
            (d.model || '').includes(deviceName) ||
            (d.did === deviceName)
        );

        if (!device) {
            const names = devices.map(d => d.name || d.did).join('、');
            return `未找到设备"${deviceName}"。可用设备: ${names || '无'}`;
        }

        const did = device.did;

        // 根据设备类型和操作发送指令
        const commandMap = {
            '开灯': { method: 'set_properties', params: [{ did, siid: 2, piid: 1, value: true }] },
            '关灯': { method: 'set_properties', params: [{ did, siid: 2, piid: 1, value: false }] },
            '开': { method: 'set_properties', params: [{ did, siid: 2, piid: 1, value: true }] },
            '关': { method: 'set_properties', params: [{ did, siid: 2, piid: 1, value: false }] },
            '亮度': { method: 'set_properties', params: [{ did, siid: 2, piid: 2, value: parseInt(value) || 50 }] },
            '色温': { method: 'set_properties', params: [{ did, siid: 2, piid: 3, value: parseInt(value) || 4000 }] },
            '温度': { method: 'set_properties', params: [{ did, siid: 2, piid: 5, value: parseInt(value) || 26 }] },
            '制冷': { method: 'set_properties', params: [{ did, siid: 2, piid: 4, value: 0 }] },
            '制热': { method: 'set_properties', params: [{ did, siid: 2, piid: 4, value: 1 }] },
            '送风': { method: 'set_properties', params: [{ did, siid: 2, piid: 4, value: 2 }] },
            '除湿': { method: 'set_properties', params: [{ did, siid: 2, piid: 4, value: 3 }] },
        };

        const cmd = commandMap[action];
        if (!cmd) {
            return `不支持的操作"${action}"。支持: ${Object.keys(commandMap).join('、')}`;
        }

        try {
            await this.sendCommand(did, cmd.method, cmd.params);
            return `已将"${device.name}"执行: ${action}${value ? ' → ' + value : ''}`;
        } catch (e) {
            return `控制失败: ${e.message}`;
        }
    }

    // 获取设备状态
    async getDeviceStatus(deviceName) {
        const devices = await this.getDevices();
        const device = devices.find(d =>
            (d.name || '').includes(deviceName) ||
            (d.model || '').includes(deviceName) ||
            (d.did === deviceName)
        );

        if (!device) {
            const names = devices.map(d => d.name || d.did).join('、');
            return `未找到设备"${deviceName}"。可用设备: ${names || '无'}`;
        }

        // 获取设备属性
        try {
            const result = await this._apiCall({
                id: Date.now(),
                method: 'get_properties',
                params: [{ did: device.did }]
            });

            const status = {
                名称: device.name,
                型号: device.model,
                DID: device.did,
                属性: result || {}
            };

            return JSON.stringify(status, null, 2);
        } catch (e) {
            return `获取状态失败: ${e.message}`;
        }
    }
}

// ===== 工具定义 =====

const tools = [
    {
        name: 'xiaomi_list_devices',
        description: '列出所有小米智能家居设备',
        inputSchema: {
            type: 'object',
            properties: {
                room: { type: 'string', description: '按房间筛选（可选）' }
            }
        }
    },
    {
        name: 'xiaomi_control',
        description: '控制小米设备（开关灯、调温度、调亮度等）',
        inputSchema: {
            type: 'object',
            properties: {
                device: { type: 'string', description: '设备名称' },
                action: { type: 'string', description: '操作：开、关、开灯、关灯、亮度、色温、温度、制冷、制热、送风、除湿' },
                value: { type: 'string', description: '参数值（亮度0-100、色温、温度等）' }
            },
            required: ['device', 'action']
        }
    },
    {
        name: 'xiaomi_status',
        description: '查看小米设备当前状态',
        inputSchema: {
            type: 'object',
            properties: {
                device: { type: 'string', description: '设备名称' }
            },
            required: ['device']
        }
    }
];

// ===== 工具实现 =====

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

let client = null;

function getClient() {
    if (!client) {
        const cfg = loadConfig();
        client = new XiaomiClient(cfg);
    }
    return client;
}

async function handleTool(name, args) {
    const c = getClient();

    switch (name) {
        case 'xiaomi_list_devices': {
            try {
                const devices = await c.getDevices();
                if (!devices || devices.length === 0) {
                    return '未找到设备。请检查 mcp/xiaomi_config.json 中的账号配置。';
                }
                let filtered = devices;
                if (args.room) {
                    filtered = devices.filter(d => (d.room_name || '').includes(args.room));
                }
                const list = filtered.map(d =>
                    `- ${d.name || '未知'} (${d.model || '未知'}) [${d.room_name || '未知房间'}]`
                ).join('\n');
                return `共 ${filtered.length} 个设备:\n${list}`;
            } catch (e) {
                return `获取设备列表失败: ${e.message}`;
            }
        }

        case 'xiaomi_control': {
            try {
                return await c.controlDevice(args.device, args.action, args.value);
            } catch (e) {
                return `控制失败: ${e.message}`;
            }
        }

        case 'xiaomi_status': {
            try {
                return await c.getDeviceStatus(args.device);
            } catch (e) {
                return `获取状态失败: ${e.message}`;
            }
        }

        default:
            return `未知工具: ${name}`;
    }
}

// ===== MCP JSON-RPC 处理 =====

function handleRequest(request) {
    const { id, method, params } = request;

    if (method === 'initialize') {
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'xiaomi-home', version: '1.0.0' } } };
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools } };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;
        return handleTool(name, args || {}).then(
            result => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } }),
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
