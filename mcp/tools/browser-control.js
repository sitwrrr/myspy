// browser-control.js - 浏览器控制 MCP 工具（打开网页、搜索信息、获取页面内容）
const readline = require('readline');
const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const url = require('url');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const tools = [
    {
        name: 'open_url',
        description: '在默认浏览器中打开一个网页',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要打开的网页 URL'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'fetch_page',
        description: '获取网页内容并提取纯文本（去掉 HTML 标签、脚本、样式），返回页面文本摘要',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要获取的网页 URL'
                },
                max_length: {
                    type: 'number',
                    description: '返回文本的最大字符数，默认 8000'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'search_web',
        description: '使用搜索引擎搜索信息，返回搜索结果列表（标题、链接、摘要）',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词'
                },
                num_results: {
                    type: 'number',
                    description: '返回结果数量，默认 5'
                }
            },
            required: ['query']
        }
    }
];

// ===== HTTP 请求工具 =====

function httpGet(targetUrl, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.get(targetUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                ...options.headers
            },
            timeout: options.timeout || 15000
        }, (res) => {
            // 跟随重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, targetUrl).href;
                return httpGet(redirectUrl, options).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                resolve({ status: res.statusCode, headers: res.headers, body });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    });
}

// ===== HTML 文本提取 =====

function extractText(html) {
    let text = html;
    // 移除 script、style、noscript 等
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    text = text.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    // 将 br、p、div、li 等块级标签转换为换行
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, '\n');
    // 移除所有 HTML 标签
    text = text.replace(/<[^>]+>/g, '');
    // 解码 HTML 实体
    text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
    text = text.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&ensp;/g, ' ').replace(/&emsp;/g, ' ');
    // 清理多余空白
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

// ===== Bing 搜索结果提取 =====

function decodeHtmlEntities(str) {
    return str
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/&ensp;/g, ' ').replace(/&emsp;/g, ' ').replace(/&sect;/g, '·');
}

function extractSearchResults(html) {
    const results = [];
    // Bing 搜索结果：匹配 <li class="b_algo"> 块
    const blockRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = blockRegex.exec(html)) !== null) {
        const block = match[1];
        // 标题在 <h2><a> 中
        const h2Match = block.match(/<h2[^>]*><a[^>]+href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i);
        // 摘要在 <p> 中
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        if (h2Match) {
            const title = decodeHtmlEntities(h2Match[2].replace(/<[^>]+>/g, '').trim());
            const href = h2Match[1];
            const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, '').trim()) : '';
            if (title) results.push({ title, url: href, snippet });
        }
    }
    // 备用：直接匹配 <h2><a> 结构
    if (results.length === 0) {
        const h2Regex = /<h2[^>]*><a[^>]+href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi;
        while ((match = h2Regex.exec(html)) !== null) {
            const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '').trim());
            if (title) results.push({ title, url: match[1], snippet: '' });
        }
    }
    return results;
}

// ===== 工具实现 =====

async function handleTool(name, args) {
    switch (name) {
        case 'open_url': {
            const targetUrl = args.url;
            if (!targetUrl) return '错误: URL 不能为空';
            // Windows: start 命令打开默认浏览器
            exec(`start "" "${targetUrl}"`, (err) => {
                if (err) console.error('打开浏览器失败:', err.message);
            });
            return `已在浏览器中打开: ${targetUrl}`;
        }

        case 'fetch_page': {
            const targetUrl = args.url;
            if (!targetUrl) return '错误: URL 不能为空';
            const maxLength = args.max_length || 8000;
            try {
                const resp = await httpGet(targetUrl);
                if (resp.status !== 200) {
                    return `HTTP 错误: ${resp.status}`;
                }
                const contentType = resp.headers['content-type'] || '';
                if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
                    return `不支持的内容类型: ${contentType}`;
                }
                let text = extractText(resp.body);
                if (text.length > maxLength) {
                    text = text.substring(0, maxLength) + '\n\n... (内容已截断)';
                }
                return text || '页面内容为空';
            } catch (e) {
                return `获取页面失败: ${e.message}`;
            }
        }

        case 'search_web': {
            const query = args.query;
            if (!query) return '错误: 搜索关键词不能为空';
            const numResults = args.num_results || 5;
            try {
                const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`;
                const resp = await httpGet(searchUrl);
                if (resp.status !== 200) {
                    return `搜索引擎返回错误: ${resp.status}`;
                }
                const results = extractSearchResults(resp.body);
                if (results.length === 0) {
                    return '未找到搜索结果';
                }
                const top = results.slice(0, numResults);
                return top.map((r, i) =>
                    `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
                ).join('\n\n');
            } catch (e) {
                return `搜索失败: ${e.message}`;
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
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'browser-control', version: '1.0.0' } } };
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
        // tools/call 返回 Promise，需要 await
        Promise.resolve(response).then(r => {
            process.stdout.write(JSON.stringify(r) + '\n');
        });
    } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '解析错误' } }) + '\n');
    }
});
