const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// 配置路径
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const PLUGINS_PATH = path.join(__dirname, '..', 'plugins');
const PROMPTS_PATH = path.join(__dirname, '..', 'prompts.json');

// 加载配置
let config = {};
try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
    console.error('读取配置失败:', e);
}

// 标签页切换
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

        item.classList.add('active');
        const tabId = 'tab-' + item.dataset.tab;
        document.getElementById(tabId).classList.add('active');
    });
});

// 子标签页切换
document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const parent = tab.parentElement;
        parent.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const panelParent = parent.parentElement;
        panelParent.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('subtab-' + tab.dataset.subtab)?.classList.add('active');
    });
});

// 日志显示
const MAX_LOG_LINES = 200;

function addLogLine(containerId, level, message, isTool = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const line = document.createElement('div');
    line.className = `log-line ${level}`;

    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const prefix = isTool ? '[TOOL] ' : '';
    line.textContent = `[${time}] ${prefix}${message}`;

    container.appendChild(line);

    // 限制日志行数
    while (container.children.length > MAX_LOG_LINES) {
        container.removeChild(container.firstChild);
    }

    // 自动滚动到底部
    container.scrollTop = container.scrollHeight;
}

// 接收日志消息
ipcRenderer.on('log-message', (event, logData) => {
    const containerId = logData.isTool ? 'tool-log' : 'pet-log';
    addLogLine(containerId, logData.level, logData.message, logData.isTool);
});

// 接收配置重载
ipcRenderer.on('reload-config', () => {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    updateMicButtonVisibility();
});

// 初始化对话设置
function initChatSettings() {
    document.getElementById('intro-text').value = config.ui?.intro_text || '';
    document.getElementById('show-chat-box').checked = config.ui?.show_chat_box !== false;
    // hide-model: 勾选表示隐藏，所以取反
    document.getElementById('hide-model').checked = config.ui?.show_model === false;
    // 字幕标签
    const subtitleLabels = config.subtitle_labels || {};
    document.getElementById('subtitle-enabled').checked = subtitleLabels.enabled !== false;
    document.getElementById('enable-context-limit').checked = config.context?.enable_limit !== false;
    document.getElementById('max-messages').value = config.context?.max_messages || 18;
    document.getElementById('persistent-history').checked = config.context?.persistent_history || false;
    document.getElementById('enable-asr').checked = config.asr?.enabled !== false;
    document.getElementById('enable-ptt').checked = config.asr?.ptt_enabled || false;
    document.getElementById('ptt-max-timeout').value = config.asr?.ptt_max_timeout || 10;
    document.getElementById('voice-barge-in').checked = config.asr?.voice_barge_in || false;

    // ASR 服务器地址
    document.getElementById('asr-vad-url').value = config.asr?.vad_url || 'ws://127.0.0.1:1000/v1/ws/vad';
    document.getElementById('asr-upload-url').value = config.asr?.asr_url || 'http://127.0.0.1:1000/v1/upload_audio';

    // BERT 配置
    document.getElementById('bert-enabled').checked = config.bert?.enabled || false;
    document.getElementById('bert-url').value = config.bert?.url || 'http://127.0.0.1:6007/classify';

    // MCP 配置
    document.getElementById('mcp-enabled').checked = config.mcp?.enabled || false;

    document.getElementById('enable-tts').checked = config.tts?.enabled !== false;

    const langMap = { 'zh': 0, 'en': 1, 'ja': 2 };
    document.getElementById('tts-language').selectedIndex = langMap[config.tts?.language] || 0;

    // 辅助视觉模型
    document.getElementById('use-vision-model').checked = config.vision?.use_vision_model || false;
    document.getElementById('vision-model-api-key').value = config.vision?.vision_model?.api_key || '';
    document.getElementById('vision-model-api-url').value = config.vision?.vision_model?.api_url || '';
    document.getElementById('vision-model-name').value = config.vision?.vision_model?.model || '';

    document.getElementById('temperature').value = config.llm?.temperature || 0.6;
    document.getElementById('enable-temperature').checked = config.llm?.temperature_enabled || false;

    // 控制麦克风按钮显示
    updateMicButtonVisibility();
}

// 控制麦克风按钮显示
function updateMicButtonVisibility() {
    const pttOnly = document.getElementById('enable-ptt')?.checked;
    const micBtn = document.getElementById('chat-mic-btn');
    if (micBtn) {
        micBtn.style.display = pttOnly ? 'none' : 'block';
    }
}

// 监听按键语音输入开关变化
document.getElementById('enable-ptt')?.addEventListener('change', () => {
    updateMicButtonVisibility();
});

// 保存视觉模型配置
document.getElementById('btn-save-vision')?.addEventListener('click', () => {
    if (!config.vision) config.vision = {};
    config.vision.use_vision_model = document.getElementById('use-vision-model').checked;
    if (!config.vision.vision_model) config.vision.vision_model = {};
    config.vision.vision_model.api_key = document.getElementById('vision-model-api-key').value;
    config.vision.vision_model.api_url = document.getElementById('vision-model-api-url').value;
    config.vision.vision_model.model = document.getElementById('vision-model-name').value;

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    ipcRenderer.send('reload-config');
    alert('视觉模型配置已保存！');
});

// 热保存对话设置
function saveChatSettings() {
    if (!config.ui) config.ui = {};
    config.ui.intro_text = document.getElementById('intro-text').value;
    config.ui.show_chat_box = document.getElementById('show-chat-box').checked;
    // hide-model: 勾选表示隐藏，取反存为 show_model
    config.ui.show_model = !document.getElementById('hide-model').checked;
    // 模型类型
    // 字幕标签
    if (!config.subtitle_labels) config.subtitle_labels = {};
    config.subtitle_labels.enabled = document.getElementById('subtitle-enabled').checked;
    if (!config.context) config.context = {};
    config.context.enable_limit = document.getElementById('enable-context-limit').checked;
    config.context.max_messages = parseInt(document.getElementById('max-messages').value) || 18;
    config.context.persistent_history = document.getElementById('persistent-history').checked;

    if (!config.asr) config.asr = {};
    config.asr.enabled = document.getElementById('enable-asr').checked;
    config.asr.ptt_enabled = document.getElementById('enable-ptt').checked;
    config.asr.ptt_max_timeout = parseInt(document.getElementById('ptt-max-timeout').value) || 10;
    config.asr.voice_barge_in = document.getElementById('voice-barge-in').checked;
    config.asr.vad_url = document.getElementById('asr-vad-url').value;
    config.asr.asr_url = document.getElementById('asr-upload-url').value;

    if (!config.bert) config.bert = {};
    config.bert.enabled = document.getElementById('bert-enabled').checked;
    config.bert.url = document.getElementById('bert-url').value;

    if (!config.mcp) config.mcp = {};
    config.mcp.enabled = document.getElementById('mcp-enabled').checked;

    if (!config.tts) config.tts = {};
    config.tts.enabled = document.getElementById('enable-tts').checked;
    const langSelect = document.getElementById('tts-language');
    config.tts.language = langSelect.options[langSelect.selectedIndex].value;

    if (!config.llm) config.llm = {};
    config.llm.temperature = parseFloat(document.getElementById('temperature').value) || 0.6;
    config.llm.temperature_enabled = document.getElementById('enable-temperature').checked;

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// 绑定对话设置事件
function sendReloadConfig() {
    saveChatSettings();
    ipcRenderer.send('reload-config', {
        ptt_enabled: document.getElementById('enable-ptt')?.checked || false,
        ptt_key: 'v'
    });
}

document.querySelectorAll('#tab-chat input, #tab-chat select').forEach(el => {
    el.addEventListener('change', () => {
        sendReloadConfig();
    });
    el.addEventListener('input', () => {
        saveChatSettings();
    });
});

// 绑定 V键超时事件
document.getElementById('ptt-max-timeout')?.addEventListener('change', () => {
    saveChatSettings();
    sendReloadConfig();
});

// 绑定 ASR 服务器地址事件（在桌宠管理标签页）
document.getElementById('asr-vad-url')?.addEventListener('change', () => {
    saveChatSettings();
    sendReloadConfig();
});
document.getElementById('asr-upload-url')?.addEventListener('change', () => {
    saveChatSettings();
    sendReloadConfig();
});

// 初始化 LLM 配置
function initLLMSettings() {
    document.getElementById('llm-api-url').value = config.llm?.api_url || '';
    document.getElementById('llm-api-key').value = config.llm?.api_key || '';
    document.getElementById('llm-model').value = config.llm?.model || '';
    document.getElementById('llm-system-prompt').value = config.llm?.system_prompt || '';
}

// 保存 LLM 配置
document.getElementById('btn-save-llm')?.addEventListener('click', () => {
    if (!config.llm) config.llm = {};
    config.llm.api_url = document.getElementById('llm-api-url').value;
    config.llm.api_key = document.getElementById('llm-api-key').value;
    config.llm.model = document.getElementById('llm-model').value;
    config.llm.system_prompt = document.getElementById('llm-system-prompt').value;

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    alert('LLM 配置已保存！');
});

// 复位皮套位置
document.getElementById('btn-reset-position')?.addEventListener('click', () => {
    if (!config.ui) config.ui = {};
    config.ui.model_x = null;
    config.ui.model_y = null;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    ipcRenderer.send('reset-pet-position');
});

// 加载插件列表
async function loadPlugins() {
    const pluginList = document.getElementById('plugin-list');
    if (!pluginList) return;

    // 保存滚动位置
    const scrollContainer = pluginList.closest('.content') || pluginList.parentElement;
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    pluginList.innerHTML = '';

    try {
        const builtInDir = path.join(PLUGINS_PATH, 'built-in');
        if (!fs.existsSync(builtInDir)) return;

        const plugins = fs.readdirSync(builtInDir).filter(f => {
            return fs.statSync(path.join(builtInDir, f)).isDirectory();
        });

        // 读取启用状态
        let enabledPlugins = [];
        try {
            const enabledPath = path.join(PLUGINS_PATH, 'enabled_plugins.json');
            const data = JSON.parse(fs.readFileSync(enabledPath, 'utf8'));
            enabledPlugins = Array.isArray(data) ? data : [];
        } catch (e) {}

        // 读取运行状态
        let runningPlugins = [];
        try {
            const statusPath = path.join(PLUGINS_PATH, 'running_plugins.json');
            runningPlugins = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        } catch (e) {}

        // 获取插件健康状态
        let healthStatus = {};
        try {
            healthStatus = await ipcRenderer.invoke('check-plugin-health');
        } catch (e) {}

        plugins.forEach(pluginName => {
            const card = document.createElement('div');
            card.className = 'plugin-card';

            // 读取插件描述
            let displayName = pluginName;
            let description = '';
            try {
                const metaPath = path.join(builtInDir, pluginName, 'metadata.json');
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                displayName = meta.displayName || pluginName;
                description = meta.description || '';
            } catch (e) {}

            const isConfigable = ['translation', 'schedule', 'pc-control',
                'music', 'mood-chat', 'memos', 'diary', 'context-compressor', 'auto-chat',
                'bilibili-live'].includes(pluginName);

            // 状态显示：健康检查 > 代码加载状态
            let statusClass = 'stopped';
            let statusText = '未运行';
            const health = healthStatus[pluginName];
            if (health === 'healthy' || health === 'ok') {
                statusClass = 'running';
                statusText = '运行中';
            } else if (health === 'error') {
                statusClass = 'warning';
                statusText = '异常';
            } else if (health === 'offline') {
                statusClass = 'stopped';
                statusText = '离线';
            } else if (runningPlugins.includes(pluginName)) {
                statusClass = 'running';
                statusText = '运行中';
            }

            card.innerHTML = `
                <div class="plugin-info">
                    <div class="plugin-name">${displayName}</div>
                    ${description ? `<div class="plugin-desc">${description}</div>` : ''}
                </div>
                <div class="plugin-actions">
                    <span class="plugin-status ${statusClass}">
                        ${statusText}
                    </span>
                    <div class="toggle ${enabledPlugins.includes(pluginName) ? 'active' : ''}"
                         data-plugin="${pluginName}"></div>
                    ${isConfigable ? `<button class="btn btn-small btn-config" data-plugin="${pluginName}">配置</button>` : ''}
                </div>
            `;

            pluginList.appendChild(card);
        });

        // 绑定开关事件
        document.querySelectorAll('.toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const pluginName = toggle.dataset.plugin;
                toggle.classList.toggle('active');
                const isEnabled = toggle.classList.contains('active');

                if (isEnabled && !enabledPlugins.includes(pluginName)) {
                    enabledPlugins.push(pluginName);
                } else if (!isEnabled) {
                    enabledPlugins = enabledPlugins.filter(p => p !== pluginName);
                }

                const enabledPath = path.join(PLUGINS_PATH, 'enabled_plugins.json');
                fs.writeFileSync(enabledPath, JSON.stringify(enabledPlugins, null, 2), 'utf8');
            });
        });

        // 绑定配置按钮
        document.querySelectorAll('.btn-config').forEach(btn => {
            btn.addEventListener('click', () => {
                openPluginConfig(btn.dataset.plugin);
            });
        });

        // 恢复滚动位置
        if (scrollContainer) scrollContainer.scrollTop = scrollTop;

    } catch (e) {
        console.error('加载插件列表失败:', e);
    }
}

// ===== MCP 服务管理 =====
const MCP_CONFIG_PATH = path.join(__dirname, '..', 'mcp', 'mcp_config.json');
const MCP_TOOLS_DIR = path.join(__dirname, '..', 'mcp', 'tools');

async function loadMCPServices() {
    const toolListEl = document.getElementById('mcp-tool-list');
    const serverListEl = document.getElementById('mcp-server-list');
    const toolCountEl = document.getElementById('mcp-tool-count');
    if (!toolListEl || !serverListEl) return;

    // 读取 MCP 配置
    let mcpConfig = {};
    try {
        if (fs.existsSync(MCP_CONFIG_PATH)) {
            mcpConfig = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {}

    const servers = mcpConfig.servers || {};

    // 服务中文名映射
    const SERVER_NAMES = {
        'file-operations': '文件操作',
        'browser-control': '浏览器控制',
        'system-tools': '系统工具',
        'xiaomi-home': '小米家居'
    };

    // 渲染服务列表
    serverListEl.innerHTML = '';
    for (const [name, srv] of Object.entries(servers)) {
        const card = document.createElement('div');
        card.className = 'mcp-server-card';

        const command = srv.command || '';
        const args = (srv.args || []).join(' ');
        const isDisabled = srv.disabled || false;
        const isRunning = config?.mcp?.enabled && !isDisabled;
        const displayName = SERVER_NAMES[name] || name;

        card.innerHTML = `
            <div class="mcp-server-header">
                <span class="mcp-server-name">${displayName}</span>
                <span class="mcp-server-detail" style="color:#555; font-size:12px; margin-left:8px;">${name}</span>
                <div class="mcp-server-actions" style="margin-left:auto;">
                    <div class="toggle ${!isDisabled ? 'active' : ''}" data-mcp-toggle="${name}" title="${isDisabled ? '已禁用，点击启用' : '已启用，点击禁用'}"></div>
                    <span class="mcp-server-status ${isRunning ? 'running' : 'stopped'}">
                        ${isDisabled ? '已禁用' : isRunning ? '运行中' : '已停止'}
                    </span>
                </div>
            </div>
            <div class="mcp-server-detail">命令: ${command} ${args}</div>
            <div class="mcp-server-actions">
                <button class="btn btn-small btn-mcp-config" data-server="${name}">配置</button>
                <button class="btn btn-small btn-mcp-tools" data-server="${name}">查看工具</button>
            </div>
        `;
        serverListEl.appendChild(card);
    }

    // 渲染工具列表
    toolListEl.innerHTML = '';
    let toolCount = 0;

    // 从每个服务器的 JS 文件中提取工具定义
    for (const [serverName, srv] of Object.entries(servers)) {
        const args = srv.args || [];
        const scriptPath = args[args.length - 1];
        if (!scriptPath) continue;

        const fullPath = path.join(__dirname, '..', scriptPath);
        try {
            if (!fs.existsSync(fullPath)) continue;
            const content = fs.readFileSync(fullPath, 'utf-8');

            // 提取工具名称和描述（从 tools 数组的 name 和 description 字段）
            const nameMatches = content.match(/name:\s*['"]([^'"]+)['"]/g) || [];
            const descMatches = content.match(/description:\s*['"]([^'"]+)['"]/g) || [];

            for (let i = 0; i < nameMatches.length; i++) {
                const name = nameMatches[i].match(/name:\s*['"]([^'"]+)['"]/)?.[1];
                const desc = descMatches[i]?.match(/description:\s*['"]([^'"]+)['"]/)?.[1] || '';
                if (name && !name.startsWith('server') && !name.includes('initialize')) {
                    toolCount++;
                    const item = document.createElement('div');
                    item.className = 'mcp-tool-item';
                    item.innerHTML = `
                        <span class="mcp-tool-name">${name}</span>
                        <span class="mcp-tool-desc">${desc}</span>
                        <span class="mcp-tool-server">${serverName}</span>
                    `;
                    toolListEl.appendChild(item);
                }
            }
        } catch (e) {}
    }

    toolCountEl.textContent = `共 ${toolCount} 个工具`;

    // 绑定配置按钮
    serverListEl.querySelectorAll('.btn-mcp-config').forEach(btn => {
        btn.addEventListener('click', () => {
            const serverName = btn.dataset.server;
            openMCPConfig(serverName, servers[serverName]);
        });
    });

    // 绑定查看工具按钮
    serverListEl.querySelectorAll('.btn-mcp-tools').forEach(btn => {
        btn.addEventListener('click', () => {
            // 滚动到工具列表
            toolListEl.scrollIntoView({ behavior: 'smooth' });
        });
    });

    // 绑定服务启用/禁用开关
    serverListEl.querySelectorAll('[data-mcp-toggle]').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const serverName = toggle.dataset.mcpToggle;
            let mcpConfig = {};
            try {
                if (fs.existsSync(MCP_CONFIG_PATH)) {
                    mcpConfig = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
                }
            } catch (e) {}

            if (mcpConfig.servers && mcpConfig.servers[serverName]) {
                const current = mcpConfig.servers[serverName].disabled || false;
                mcpConfig.servers[serverName].disabled = !current;
                try {
                    fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2), 'utf-8');
                    loadMCPServices();
                } catch (e) {}
            }
        });
    });
}

function openMCPConfig(serverName, serverConfig) {
    const modal = document.getElementById('plugin-config-modal');
    const title = document.getElementById('plugin-config-title');
    const body = document.getElementById('plugin-config-body');
    const saveBtn = document.getElementById('btn-save-plugin-config');

    title.textContent = `MCP 服务配置 - ${serverName}`;

    let argsStr = '';
    if (serverConfig.args) {
        argsStr = serverConfig.args.join(' ');
    }

    // xiaomi-home 额外显示小米账号配置
    let extraFields = '';
    if (serverName === 'xiaomi-home') {
        let xiaomiCfg = {};
        try {
            if (fs.existsSync(XIAOMI_CONFIG_PATH)) {
                xiaomiCfg = JSON.parse(fs.readFileSync(XIAOMI_CONFIG_PATH, 'utf-8'));
            }
        } catch (e) {}

        extraFields = `
            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 15px 0;">
            <h4 style="color: #b0b0b8; margin-bottom: 12px;">小米账号配置</h4>
            <div class="form-row">
                <label>小米账号：</label>
                <input type="text" id="mcp-xiaomi-user" value="${xiaomiCfg.username || ''}" placeholder="手机号或邮箱">
            </div>
            <div class="form-row">
                <label>账号密码：</label>
                <input type="password" id="mcp-xiaomi-pass" value="${xiaomiCfg.password || ''}" placeholder="小米账号密码">
            </div>
            <div class="form-row">
                <label>服务器区域：</label>
                <select id="mcp-xiaomi-server">
                    <option value="cn" ${xiaomiCfg.server === 'cn' ? 'selected' : ''}>cn - 中国大陆</option>
                    <option value="tw" ${xiaomiCfg.server === 'tw' ? 'selected' : ''}>tw - 台湾</option>
                    <option value="sg" ${xiaomiCfg.server === 'sg' ? 'selected' : ''}>sg - 新加坡</option>
                    <option value="us" ${xiaomiCfg.server === 'us' ? 'selected' : ''}>us - 美国</option>
                    <option value="de" ${xiaomiCfg.server === 'de' ? 'selected' : ''}>de - 德国</option>
                    <option value="ru" ${xiaomiCfg.server === 'ru' ? 'selected' : ''}>ru - 俄罗斯</option>
                    <option value="in" ${xiaomiCfg.server === 'in' ? 'selected' : ''}>in - 印度</option>
                </select>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="form-row">
            <label>命令：</label>
            <input type="text" id="mcp-cfg-command" value="${serverConfig.command || 'node'}" class="mcp-cfg-field">
        </div>
        <div class="form-row">
            <label>参数：</label>
            <input type="text" id="mcp-cfg-args" value="${argsStr}" placeholder="例如：./mcp/tools/xxx.js" class="mcp-cfg-field">
        </div>
        ${extraFields}
        <div class="hint" style="margin-top: 10px;">
            提示：修改后需重启桌宠生效。配置文件位于 mcp/mcp_config.json。
        </div>
    `;

    modal.style.display = 'flex';

    // 保存按钮
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    newSaveBtn.addEventListener('click', () => {
        const newCommand = document.getElementById('mcp-cfg-command').value.trim();
        const newArgsStr = document.getElementById('mcp-cfg-args').value.trim();
        const newArgs = newArgsStr.split(/\s+/).filter(Boolean);

        let mcpConfig = {};
        try {
            if (fs.existsSync(MCP_CONFIG_PATH)) {
                mcpConfig = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
            }
        } catch (e) {}

        if (!mcpConfig.servers) mcpConfig.servers = {};
        mcpConfig.servers[serverName] = {
            command: newCommand,
            args: newArgs
        };

        try {
            fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2), 'utf-8');

            // xiaomi-home 同时保存小米配置
            if (serverName === 'xiaomi-home') {
                const xiaomiCfg = {
                    username: document.getElementById('mcp-xiaomi-user')?.value.trim() || '',
                    password: document.getElementById('mcp-xiaomi-pass')?.value || '',
                    server: document.getElementById('mcp-xiaomi-server')?.value || 'cn'
                };
                fs.writeFileSync(XIAOMI_CONFIG_PATH, JSON.stringify(xiaomiCfg, null, 2), 'utf-8');
                ipcRenderer.invoke('mcp-reload-config').catch(() => {});
            }

            modal.style.display = 'none';
            loadMCPServices();
        } catch (e) {
            alert('保存失败: ' + e.message);
        }
    });
}

// ===== 小米配置路径 =====
const XIAOMI_CONFIG_PATH = path.join(__dirname, '..', 'mcp', 'xiaomi_config.json');

// 打开插件配置弹窗
function openPluginConfig(pluginName) {
    const modal = document.getElementById('plugin-config-modal');
    const title = document.getElementById('plugin-config-title');
    const body = document.getElementById('plugin-config-body');

    title.textContent = pluginName + ' 配置';

    // 读取插件配置
    const configPath = path.join(PLUGINS_PATH, 'built-in', pluginName, 'plugin_config.json');
    let pluginConfig = {};
    try {
        pluginConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        body.innerHTML = '<p>无法读取配置文件</p>';
        modal.style.display = 'flex';
        return;
    }

    // 生成配置表单
    let html = '';
    for (const [key, field] of Object.entries(pluginConfig)) {
        if (typeof field !== 'object' || !field.type) continue;

        // 处理嵌套对象
        if (field.type === 'object' && field.fields) {
            html += `<div class="form-group">`;
            html += `<h4>${field.title || key}</h4>`;
            if (field.description) {
                html += `<div class="hint">${field.description}</div>`;
            }
            for (const [subKey, subField] of Object.entries(field.fields)) {
                html += renderField(subKey, subField, key);
            }
            html += `</div>`;
            continue;
        }

        html += renderField(key, field);
    }

    body.innerHTML = html;
    modal.style.display = 'flex';

    // 保存按钮
    document.getElementById('btn-save-plugin-config').onclick = () => {
        // 收集所有输入值
        body.querySelectorAll('[data-key]').forEach(input => {
            const keys = input.dataset.key.split('.');
            const value = input.type === 'checkbox' ? input.checked : input.value;

            if (keys.length === 2) {
                // 嵌套对象：backend_llm.model
                const [parentKey, childKey] = keys;
                if (!pluginConfig[parentKey].fields[childKey]) return;
                if (input.type === 'number') {
                    pluginConfig[parentKey].fields[childKey].value = parseFloat(value) || 0;
                } else {
                    pluginConfig[parentKey].fields[childKey].value = value;
                }
            } else {
                // 顶层字段
                const key = keys[0];
                if (!pluginConfig[key]) return;
                if (input.type === 'number') {
                    pluginConfig[key].value = parseFloat(value) || 0;
                } else {
                    pluginConfig[key].value = value;
                }
            }
        });

        fs.writeFileSync(configPath, JSON.stringify(pluginConfig, null, 2), 'utf8');
        modal.style.display = 'none';
    };
}

// 渲染单个字段
function renderField(key, field, parentKey = null) {
    const dataKey = parentKey ? `${parentKey}.${key}` : key;
    const value = field.value ?? field.default ?? '';
    let html = '';

    if (field.type === 'bool') {
        html += `<div class="form-row">`;
        html += `<label class="checkbox-label">`;
        html += `<input type="checkbox" data-key="${dataKey}" ${value ? 'checked' : ''}>`;
        html += `${field.title || key}`;
        html += `</label>`;
        if (field.description) {
            html += `<div class="hint">${field.description}</div>`;
        }
        html += `</div>`;
    } else if (field.type === 'text') {
        html += `<div class="form-row">`;
        html += `<label>${field.title || key}：</label>`;
        html += `<textarea data-key="${dataKey}" rows="3">${value}</textarea>`;
        if (field.description) {
            html += `<div class="hint">${field.description}</div>`;
        }
        html += `</div>`;
    } else if (field.type === 'int' || field.type === 'float') {
        html += `<div class="form-row">`;
        html += `<label>${field.title || key}：</label>`;
        html += `<input type="number" data-key="${dataKey}" value="${value}" step="${field.type === 'float' ? '0.01' : '1'}">`;
        if (field.description) {
            html += `<div class="hint">${field.description}</div>`;
        }
        html += `</div>`;
    } else {
        html += `<div class="form-row">`;
        html += `<label>${field.title || key}：</label>`;
        html += `<input type="text" data-key="${dataKey}" value="${value}">`;
        if (field.description) {
            html += `<div class="hint">${field.description}</div>`;
        }
        html += `</div>`;
    }

    return html;
}

// 关闭弹窗
document.getElementById('btn-close-modal')?.addEventListener('click', () => {
    document.getElementById('plugin-config-modal').style.display = 'none';
});

// 桌宠管理
document.getElementById('btn-start-pet')?.addEventListener('click', () => {
    // 清空日志
    const petLog = document.getElementById('pet-log');
    const toolLog = document.getElementById('tool-log');
    if (petLog) petLog.innerHTML = '';
    if (toolLog) toolLog.innerHTML = '';
    ipcRenderer.send('start-pet');
    document.getElementById('pet-status').textContent = '运行中';
    document.getElementById('status-dot').classList.add('running');
});

document.getElementById('btn-stop-pet')?.addEventListener('click', () => {
    ipcRenderer.send('stop-pet');
    document.getElementById('pet-status').textContent = '未运行';
    document.getElementById('status-dot').classList.remove('running');
});

// 刷新模型列表
async function refreshModels() {
    const modelList = document.getElementById('model-list');
    if (!modelList) return;

    modelList.innerHTML = '';
    // 当前使用的模型路径（自动检测类型）
    const currentModelPath = config?.ui?.model_path || config?.ui?.vrm_model_path || '';
    const currentModelType = config?.ui?.model_type || 'live2d';

    // ===== Live2D 模型 =====
    const section2d = document.createElement('div');
    section2d.innerHTML = '<div style="color:#888;font-size:13px;font-weight:600;margin:8px 0 4px;">Live2D</div>';
    modelList.appendChild(section2d);

    const modelDir = path.join(__dirname, '..', '2D');
    let has2D = false;
    if (fs.existsSync(modelDir)) {
        fs.readdirSync(modelDir).forEach(folder => {
            const folderPath = path.join(modelDir, folder);
            if (fs.statSync(folderPath).isDirectory()) {
                fs.readdirSync(folderPath).forEach(file => {
                    if (file.endsWith('.model3.json')) {
                        has2D = true;
                        const item = document.createElement('div');
                        item.className = 'model-item';
                        const fullPath = '2D/' + folder + '/' + file;
                        // 高亮当前模型（同时检查类型和路径）
                        const isCurrent = currentModelPath === fullPath || (currentModelType === 'live2d' && !currentModelPath);
                        item.textContent = fullPath;
                        if (isCurrent) item.style.borderLeft = '3px solid #66bb6a';
                        item.addEventListener('click', () => {
                            if (confirm('确定切换到 Live2D: ' + fullPath + '？')) {
                                config.ui.model_type = 'live2d';
                                config.ui.model_path = fullPath;
                                fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
                                ipcRenderer.send('switch-model', fullPath);
                                refreshModels();
                                loadEmotionMapping();
                            }
                        });
                        modelList.appendChild(item);
                    }
                });
            }
        });
    }
    if (!has2D) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#555;font-size:13px;padding:4px 0;';
        empty.textContent = '无模型';
        modelList.appendChild(empty);
    }

    // ===== VRM 3D 模型 =====
    const section3d = document.createElement('div');
    section3d.innerHTML = '<div style="color:#888;font-size:13px;font-weight:600;margin:12px 0 4px;">VRM 3D</div>';
    modelList.appendChild(section3d);

    const vrmDir = path.join(__dirname, '..', '3D');
    let has3D = false;
    if (fs.existsSync(vrmDir)) {
        fs.readdirSync(vrmDir).forEach(file => {
            if (file.endsWith('.vrm')) {
                has3D = true;
                const item = document.createElement('div');
                item.className = 'model-item';
                const fullPath = '3D/' + file;
                // 高亮当前模型
                const isCurrent = currentModelPath === fullPath;
                item.textContent = fullPath;
                if (isCurrent) item.style.borderLeft = '3px solid #66bb6a';
                item.addEventListener('click', () => {
                    if (confirm('确定切换到 VRM: ' + fullPath + '？')) {
                        config.ui.model_type = 'vrm';
                        config.ui.model_path = fullPath;
                        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
                        refreshModels();
                        alert('已切换，重启桌宠后生效');
                    }
                });
                modelList.appendChild(item);
            }
        });
    }
    if (!has3D) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#555;font-size:13px;padding:4px 0;';
        empty.textContent = '无模型';
        modelList.appendChild(empty);
    }

    // 刷新后加载情绪映射配置
    loadEmotionMapping();
}

document.getElementById('btn-refresh-models')?.addEventListener('click', refreshModels);

// === 情绪表情映射配置 ===
const EMOTIONS = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];
const EMOTION_CONFIG_PATH = path.join(__dirname, '..', 'emotion_expressions.json');

// === 模型表情控制面板 ===
let _activeExpressions = new Set()  // 当前激活的表情

// 表情文件名 → 中文名映射
const EXPR_NAME_MAP = {
    'bai': '白发', 'baiduanfa': '白短发', 'baipanfa': '白盘发',
    'buan': '不安', 'hailian': '害羞', 'heichangfa': '黑长发',
    'heiduanfa': '黑短发', 'heipanfa': '黑盘发', 'heisi': '黑丝',
    'hexie': '黑鞋', 'huatong': '话筒', 'jiao': '角',
    'lianhong': '脸红', 'majia': '马甲', 'paizi': '牌子',
    'pijian': '披肩', 'qianqi': '嫌弃', 'shanzi': '扇子',
    'shengqi': '生气', 'wuyu': '无语', 'xie': '鞋子',
    'yanjing': '眼镜', 'yanlei': '眼泪'
}

async function loadEmotionMapping() {
    const fieldsDiv = document.getElementById('emotion-mapping-fields');
    if (!fieldsDiv) return;

    const modelPath = config?.ui?.model_path || '';
    const match = modelPath.match(/2D\/([^\/]+)\//);
    const characterName = match ? match[1] : null;

    if (!characterName || !modelPath.includes('2D/')) {
        fieldsDiv.innerHTML = '<p style="color:#888;font-size:12px;">仅 Live2D 模型支持表情控制</p>';
        return;
    }

    // 扫描表情文件
    const modelDir = path.join(__dirname, '..', '2D', characterName);
    const expressions = await ipcRenderer.invoke('scan-expressions', modelDir);

    if (expressions.length === 0) {
        fieldsDiv.innerHTML = '<p style="color:#888;font-size:12px;">当前模型没有可用的表情文件</p>';
        return;
    }

    // 构建按钮面板
    let html = `<div style="margin-bottom:8px;color:#aaa;font-size:12px;">角色: ${characterName} | 表情: ${expressions.length}个 | 点击按钮切换开/关</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">`;

    for (const expr of expressions) {
        const isActive = _activeExpressions.has(expr.name);
        const bgColor = isActive ? '#66bb6a' : '#333';
        const textColor = isActive ? '#fff' : '#ccc';
        const displayName = EXPR_NAME_MAP[expr.name] || expr.name
        html += `<button class="expr-toggle-btn" data-expr="${expr.name}" data-file="${expr.file}" `;
        html += `style="background:${bgColor};color:${textColor};border:1px solid #555;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;transition:all 0.2s;"`;
        html += ` title="${expr.name}">`;
        html += `${displayName}</button>`;
    }

    html += `</div>`;
    html += `<div style="margin-top:10px;color:#888;font-size:11px;">激活的表情会实时应用到模型上</div>`;

    fieldsDiv.innerHTML = html;

    // 绑定按钮点击事件
    fieldsDiv.querySelectorAll('.expr-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const exprName = btn.dataset.expr;
            const exprFile = btn.dataset.file;

            if (_activeExpressions.has(exprName)) {
                // 关闭表情
                _activeExpressions.delete(exprName)
                ipcRenderer.send('toggle-expression', { name: exprName, file: exprFile, active: false })
                btn.style.background = '#333'
                btn.style.color = '#ccc'
            } else {
                // 开启表情
                _activeExpressions.add(exprName)
                ipcRenderer.send('toggle-expression', { name: exprName, file: exprFile, active: true })
                btn.style.background = '#66bb6a'
                btn.style.color = '#fff'
            }
        });
    });
}

// 模型切换后刷新情绪映射配置
const _origRefreshModels = refreshModels;
// 在 refreshModels 结束后加载情绪映射

// 语音克隆 - 文件上传
let selectedModelFile = null;
let selectedCkptFile = null;
let selectedAudioFile = null;

function setupFileDrop(dropId, inputId, statusId, onSelect) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const status = document.getElementById(statusId);

    if (!drop || !input || !status) return;

    drop.addEventListener('click', () => input.click());

    drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('dragover');
    });

    drop.addEventListener('dragleave', () => {
        drop.classList.remove('dragover');
    });

    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            onSelect(e.dataTransfer.files[0], status);
        }
    });

    input.addEventListener('change', () => {
        if (input.files.length > 0) {
            onSelect(input.files[0], status);
        }
    });
}

setupFileDrop('model-file-drop', 'model-file-input', 'model-file-status', (file, status) => {
    selectedModelFile = file;
    status.textContent = `已选择: ${file.name}`;
    status.classList.add('uploaded');
});

setupFileDrop('ckpt-file-drop', 'ckpt-file-input', 'ckpt-file-status', (file, status) => {
    selectedCkptFile = file;
    status.textContent = `已选择: ${file.name}`;
    status.classList.add('uploaded');
});

setupFileDrop('audio-file-drop', 'audio-file-input', 'audio-file-status', (file, status) => {
    selectedAudioFile = file;
    status.textContent = `已选择: ${file.name}`;
    status.classList.add('uploaded');
});

// 语音克隆 - 生成 bat 文件
document.getElementById('btn-generate-tts-bat')?.addEventListener('click', () => {
    const refText = document.getElementById('tts-ref-text').value.trim();
    const roleName = document.getElementById('tts-role-name').value.trim();
    const refLang = document.getElementById('tts-ref-lang').value;
    const statusEl = document.getElementById('tts-status');

    if (!selectedModelFile) {
        statusEl.textContent = '状态：请选择 SoVITS 模型文件（.pth）';
        statusEl.style.color = '#f44336';
        return;
    }
    if (!selectedAudioFile) {
        statusEl.textContent = '状态：请选择参考音频（.wav）';
        statusEl.style.color = '#f44336';
        return;
    }
    if (!roleName) {
        statusEl.textContent = '状态：请输入角色名称';
        statusEl.style.color = '#f44336';
        return;
    }
    if (!refText) {
        statusEl.textContent = '状态：请输入参考音频文本';
        statusEl.style.color = '#f44336';
        return;
    }

    try {
        // 创建 Voice_Model_Factory/角色名 目录
        const voiceModelDir = path.join(__dirname, '..', 'Voice_Model_Factory');
        const roleDir = path.join(voiceModelDir, roleName);
        if (!fs.existsSync(roleDir)) {
            fs.mkdirSync(roleDir, { recursive: true });
        }

        // 保存 SoVITS 模型文件
        const modelPath = path.join(roleDir, `${roleName}.pth`);
        fs.copyFileSync(selectedModelFile.path, modelPath);

        // 保存 GPT 模型文件（如果有）
        if (selectedCkptFile) {
            const ckptPath = path.join(roleDir, `${roleName}.ckpt`);
            fs.copyFileSync(selectedCkptFile.path, ckptPath);
        }

        // 保存音频文件
        const audioPath = path.join(roleDir, `${roleName}.wav`);
        fs.copyFileSync(selectedAudioFile.path, audioPath);

        // 生成 bat 文件（.ckpt 可选，不传则用默认 GPT 模型）
        // 用 %~dp0 相对路径，移植到其他电脑也能用
        let batCmd = `python api.py -p 5006 -d cuda -s "%~dp0${roleName}.pth" -dr "%~dp0${roleName}.wav" -dt "${refText}" -dl ${refLang}`;
        if (selectedCkptFile) {
            batCmd = `python api.py -p 5006 -d cuda -s "%~dp0${roleName}.pth" -g "%~dp0${roleName}.ckpt" -dr "%~dp0${roleName}.wav" -dt "${refText}" -dl ${refLang}`;
        }

        const batContent = `@echo off\r\nchcp 65001 >nul\r\nset "PATH=%~dp0..\\..\\GPT-SoVITS-Bundle\\runtime;%PATH%"\r\ncd %~dp0..\\..\\GPT-SoVITS-Bundle\r\necho Starting GPT-SoVITS TTS Server...\r\necho Address: http://127.0.0.1:5006\r\n${batCmd}\r\npause\r\n`;

        const batPath = path.join(roleDir, `${roleName}_tts.bat`);
        fs.writeFileSync(batPath, batContent, 'utf8');

        const ckptMsg = selectedCkptFile ? '，使用自定义 GPT 模型' : '，使用默认 GPT 模型';
        statusEl.textContent = `状态：已保存到 Voice_Model_Factory/${roleName}/${ckptMsg}`;
        statusEl.style.color = '#5a9adf';
    } catch (e) {
        statusEl.textContent = `状态：生成失败 - ${e.message}`;
        statusEl.style.color = '#f44336';
    }
});

// 初始化
initChatSettings();
initLLMSettings();
loadPlugins();
loadMCPServices();
refreshModels();

// 检测桌宠状态
ipcRenderer.invoke('get-pet-status').then(running => {
    if (running) {
        document.getElementById('pet-status').textContent = '运行中';
        document.getElementById('status-dot').classList.add('running');
    }
});

// 定期刷新插件状态
setInterval(loadPlugins, 5000);
setInterval(loadMCPServices, 5000);

// === Skill 人设管理 ===
let currentActiveSkill = null

async function loadSkillList() {
    const listDiv = document.getElementById('skill-list')
    if (!listDiv) return

    const skills = await ipcRenderer.invoke('scan-skills')
    if (skills.length === 0) {
        listDiv.innerHTML = '<p style="color:#888;font-size:12px;">没有找到 Skill。将包含 SOUL.md 或 SKILL.md 的文件夹放入 skills/ 目录。</p>'
        return
    }

    let html = ''
    for (const skill of skills) {
        const isActive = currentActiveSkill === skill.name
        const borderColor = isActive ? '#66bb6a' : '#333'
        html += `<div class="skill-item" data-skill="${skill.name}" style="border:1px solid ${borderColor};border-radius:6px;padding:10px;margin-bottom:8px;cursor:pointer;transition:border-color 0.2s;">`
        html += `<div style="display:flex;justify-content:space-between;align-items:center;">`
        html += `<div>`
        html += `<strong style="color:#eee;">${skill.displayName}</strong>`
        if (skill.description) html += `<div style="color:#888;font-size:12px;margin-top:2px;">${skill.description}</div>`
        html += `</div>`
        html += `<div>`
        if (isActive) {
            html += `<button class="btn btn-danger btn-sm skill-toggle" data-skill="${skill.name}" data-action="disable">停用</button>`
        } else {
            html += `<button class="btn btn-primary btn-sm skill-toggle" data-skill="${skill.name}" data-action="enable">启用</button>`
        }
        html += `</div></div></div>`
    }
    listDiv.innerHTML = html

    // 绑定点击预览
    listDiv.querySelectorAll('.skill-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('skill-toggle')) return
            previewSkill(el.dataset.skill)
        })
    })

    // 绑定启用/禁用按钮
    listDiv.querySelectorAll('.skill-toggle').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation()
            const skillName = btn.dataset.skill
            const action = btn.dataset.action
            if (action === 'enable') {
                await enableSkill(skillName)
            } else {
                await disableSkill()
            }
        })
    })
}

let previewedSkill = null

async function previewSkill(skillName) {
    const previewDiv = document.getElementById('skill-preview')
    if (!previewDiv) return

    // 点击已预览的 Skill 则收起
    if (previewedSkill === skillName) {
        previewedSkill = null
        previewDiv.innerHTML = '<p style="color:#888;font-size:12px;">点击 Skill 名称查看内容</p>'
        return
    }

    previewedSkill = skillName
    const content = await ipcRenderer.invoke('load-skill-content', skillName)
    let html = `<div style="margin-bottom:8px;color:#66bb6a;font-size:12px;">当前预览: ${skillName}（再次点击收起）</div>`
    if (content.soul) {
        html += `<div style="margin-bottom:12px;"><h4 style="color:#66bb6a;margin-bottom:4px;">SOUL.md</h4><pre style="color:#ccc;font-size:12px;white-space:pre-wrap;background:#1a1a1a;padding:8px;border-radius:4px;max-height:200px;overflow-y:auto;">${content.soul}</pre></div>`
    }
    if (content.skill) {
        html += `<div><h4 style="color:#66bb6a;margin-bottom:4px;">SKILL.md</h4><pre style="color:#ccc;font-size:12px;white-space:pre-wrap;background:#1a1a1a;padding:8px;border-radius:4px;max-height:200px;overflow-y:auto;">${content.skill}</pre></div>`
    }
    previewDiv.innerHTML = html || '<p style="color:#888;">无内容</p>'
}

async function enableSkill(skillName) {
    const content = await ipcRenderer.invoke('load-skill-content', skillName)
    if (!content.soul && !content.skill) {
        alert('Skill 内容为空')
        return
    }
    currentActiveSkill = skillName
    ipcRenderer.send('apply-skill', content)
    loadSkillList()
    alert(`已启用: ${skillName}`)
}

async function disableSkill() {
    currentActiveSkill = null
    ipcRenderer.send('remove-skill')
    loadSkillList()
    alert('Skill 已停用')
}

// 页面加载时刷新 Skill 列表
loadSkillList()

// skills 目录变化时自动刷新列表
ipcRenderer.on('skills-changed', () => {
    loadSkillList()
})

// 桌宠窗口关闭时更新状态
ipcRenderer.on('pet-stopped', () => {
    document.getElementById('pet-status').textContent = '未运行';
    document.getElementById('status-dot').classList.remove('running');
});

// ==================== 提示词广场 ====================

// 加载提示词列表
function loadPrompts() {
    const list = document.getElementById('prompt-plaza-list');
    if (!list) return;
    list.innerHTML = '';

    let prompts = [];
    try {
        prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
    } catch (e) {
        list.innerHTML = '<div class="hint">无法读取提示词文件</div>';
        return;
    }

    if (prompts.length === 0) {
        list.innerHTML = '<div class="hint">暂无提示词，点击上方按钮添加</div>';
        return;
    }

    prompts.forEach((p, index) => {
        const card = document.createElement('div');
        card.className = 'prompt-card';
        card.innerHTML = `
            <div class="prompt-card-info">
                <div class="prompt-card-title">${p.title}</div>
                <div class="prompt-card-desc">${p.description || ''}</div>
            </div>
            <div class="prompt-card-actions">
                <button class="btn-apply" data-index="${index}">应用</button>
                <button class="btn-edit-prompt" data-index="${index}">编辑</button>
                <button class="btn-delete-prompt" data-index="${index}">删除</button>
            </div>
        `;
        list.appendChild(card);
    });

    // 绑定应用按钮
    list.querySelectorAll('.btn-apply').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            applyPrompt(idx);
        });
    });

    // 绑定删除按钮
    list.querySelectorAll('.btn-delete-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            deletePrompt(idx);
        });
    });

    // 绑定编辑按钮
    list.querySelectorAll('.btn-edit-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            editPrompt(idx);
        });
    });
}

// 应用提示词到系统提示词输入框
function applyPrompt(index) {
    let prompts = [];
    try {
        prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
    } catch (e) { return; }

    const prompt = prompts[index];
    if (!prompt || !prompt.content) return;

    document.getElementById('llm-system-prompt').value = prompt.content;
}

// 编辑提示词
function editPrompt(index) {
    let prompts = [];
    try {
        prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
    } catch (e) { return; }

    const prompt = prompts[index];
    if (!prompt) return;

    const modal = document.getElementById('plugin-config-modal');
    const title = document.getElementById('plugin-config-title');
    const body = document.getElementById('plugin-config-body');

    title.textContent = '编辑提示词';
    body.innerHTML = `
        <div class="prompt-add-form">
            <div>
                <label>标题：</label>
                <input type="text" id="edit-prompt-title" value="${prompt.title}">
            </div>
            <div>
                <label>简介：</label>
                <input type="text" id="edit-prompt-desc" value="${prompt.description || ''}">
            </div>
            <div>
                <label>提示词内容：</label>
                <textarea id="edit-prompt-content" rows="6">${prompt.content}</textarea>
            </div>
        </div>
    `;
    modal.style.display = 'flex';

    document.getElementById('btn-save-plugin-config').onclick = () => {
        const newTitle = document.getElementById('edit-prompt-title').value.trim();
        const newDesc = document.getElementById('edit-prompt-desc').value.trim();
        const newContent = document.getElementById('edit-prompt-content').value.trim();

        if (!newTitle) { alert('请输入标题'); return; }
        if (!newContent) { alert('请输入提示词内容'); return; }

        prompts[index] = { title: newTitle, description: newDesc, content: newContent };
        fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2), 'utf8');
        modal.style.display = 'none';
        loadPrompts();
    };
}

// 删除提示词
function deletePrompt(index) {
    let prompts = [];
    try {
        prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
    } catch (e) { return; }

    if (!confirm('确定删除提示词"' + prompts[index].title + '"？')) return;

    prompts.splice(index, 1);
    fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2), 'utf8');
    loadPrompts();
}

// 添加提示词弹窗
document.getElementById('btn-add-prompt')?.addEventListener('click', () => {
    const modal = document.getElementById('plugin-config-modal');
    const title = document.getElementById('plugin-config-title');
    const body = document.getElementById('plugin-config-body');

    title.textContent = '添加提示词';
    body.innerHTML = `
        <div class="prompt-add-form">
            <div>
                <label>标题：</label>
                <input type="text" id="new-prompt-title" placeholder="输入提示词名称">
            </div>
            <div>
                <label>简介：</label>
                <input type="text" id="new-prompt-desc" placeholder="简单描述这个提示词的作用">
            </div>
            <div>
                <label>提示词内容：</label>
                <textarea id="new-prompt-content" rows="6" placeholder="输入完整的系统提示词内容"></textarea>
            </div>
        </div>
    `;
    modal.style.display = 'flex';

    // 保存按钮
    document.getElementById('btn-save-plugin-config').onclick = () => {
        const newTitle = document.getElementById('new-prompt-title').value.trim();
        const newDesc = document.getElementById('new-prompt-desc').value.trim();
        const newContent = document.getElementById('new-prompt-content').value.trim();

        if (!newTitle) { alert('请输入标题'); return; }
        if (!newContent) { alert('请输入提示词内容'); return; }

        let prompts = [];
        try {
            prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));
        } catch (e) {}

        prompts.push({ title: newTitle, description: newDesc, content: newContent });
        fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2), 'utf8');
        modal.style.display = 'none';
        loadPrompts();
    };
});

// 初始化提示词广场
loadPrompts();

// 提示词广场导航
function switchToTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tabName}"]`)?.classList.add('active');
    document.getElementById('tab-' + tabName)?.classList.add('active');
}

document.getElementById('btn-goto-prompts')?.addEventListener('click', () => {
    switchToTab('prompts');
});

document.getElementById('btn-back-llm')?.addEventListener('click', () => {
    switchToTab('llm');
});

// ==================== 对话历史 ====================

const historyState = {
    messages: [],
    page: 1,
    pageSize: 50,
    total: 0,
    isLoading: false,
    pollInterval: null
};

function getHistoryPath() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const relativePath = config?.context?.history_file || '../AI记录室/对话历史.jsonl';
    return path.join(__dirname, '..', relativePath);
}

function loadAllHistoryMessages() {
    const historyPath = getHistoryPath();
    if (!fs.existsSync(historyPath)) return [];

    try {
        const content = fs.readFileSync(historyPath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        const messages = [];
        for (const line of lines) {
            try { messages.push(JSON.parse(line)); } catch (e) {}
        }
        return messages;
    } catch (e) {
        return [];
    }
}

function loadConversationHistory() {
    const container = document.getElementById('history-container');
    const countEl = document.getElementById('history-count');
    if (!container) return;

    const allMessages = loadAllHistoryMessages();
    historyState.messages = allMessages;
    historyState.total = allMessages.length;

    countEl.textContent = `共 ${historyState.total} 条对话`;

    if (allMessages.length === 0) {
        container.innerHTML = '<div class="hint">暂无对话历史</div>';
        return;
    }

    // 显示最后一页
    const startIdx = Math.max(0, allMessages.length - historyState.pageSize);
    const pageMessages = allMessages.slice(startIdx);
    historyState.page = Math.ceil(allMessages.length / historyState.pageSize) || 1;

    renderHistoryMessages(pageMessages, container, false);
}

function renderHistoryMessages(messages, container, prepend) {
    const userLabel = 'user';
    const aiLabel = 'AI';

    const fragment = document.createDocumentFragment();

    // 加载更多按钮（在顶部）
    if (prepend && historyState.page > 1) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.className = 'history-load-more';
        loadMoreDiv.innerHTML = '<button id="btn-load-more-history" class="btn">加载更早的对话</button>';
        fragment.appendChild(loadMoreDiv);
    }

    for (const msg of messages) {
        // 跳过空的 assistant 消息（工具调用中间步骤）
        if (msg.role === 'assistant' && (!msg.content || msg.content.trim() === '') && msg.tool_calls) {
            continue;
        }
        const div = document.createElement('div');
        div.className = 'history-message';

        const roleClass = msg.role === 'user' ? 'user' : 'ai';
        const roleName = msg.role === 'user' ? userLabel : aiLabel;
        let contentHtml = `<span class="history-role ${roleClass}">${roleName}:</span> `;

        if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
                if (item.type === 'text') {
                    contentHtml += escapeHtml(item.text || '');
                } else if (item.type === 'image_url') {
                    const url = item.image_url?.url || '';
                    if (url.startsWith('data:image/')) {
                        contentHtml += `<img src="${url}" style="max-width:100%;border-radius:6px;margin:8px 0;cursor:pointer;" onclick="previewImage(this.src)">`;
                    }
                }
            }
        } else {
            contentHtml += escapeHtml(msg.content || '');
        }

        div.innerHTML = contentHtml;
        fragment.appendChild(div);
    }

    if (prepend) {
        const scrollBefore = container.scrollHeight;
        container.insertBefore(fragment, container.firstChild);
        container.scrollTop = container.scrollHeight - scrollBefore;
    } else {
        container.appendChild(fragment);
        container.scrollTop = container.scrollHeight;
    }

    // 绑定加载更多按钮
    const loadMoreBtn = document.getElementById('btn-load-more-history');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', loadMoreHistory);
    }
}

function loadMoreHistory() {
    if (historyState.isLoading || historyState.page <= 1) return;
    historyState.isLoading = true;

    const container = document.getElementById('history-container');
    const startIdx = Math.max(0, (historyState.page - 2) * historyState.pageSize);
    const endIdx = (historyState.page - 1) * historyState.pageSize;
    const pageMessages = historyState.messages.slice(startIdx, endIdx);

    historyState.page--;
    renderHistoryMessages(pageMessages, container, true);
    historyState.isLoading = false;
}

// 自动刷新
function startHistoryPolling() {
    stopHistoryPolling();
    historyState.pollInterval = setInterval(() => {
        if (!historyState.isLoading) {
            const oldTotal = historyState.total;
            const allMessages = loadAllHistoryMessages();
            historyState.messages = allMessages;
            historyState.total = allMessages.length;

            // 有新消息时刷新最后一页
            if (allMessages.length > oldTotal) {
                const container = document.getElementById('history-container');
                const startIdx = Math.max(0, allMessages.length - historyState.pageSize);
                const pageMessages = allMessages.slice(startIdx);
                historyState.page = Math.ceil(allMessages.length / historyState.pageSize) || 1;
                container.innerHTML = '';
                renderHistoryMessages(pageMessages, container, false);
            }

            document.getElementById('history-count').textContent = `共 ${historyState.total} 条对话`;
        }
    }, 2000);
}

function stopHistoryPolling() {
    if (historyState.pollInterval) {
        clearInterval(historyState.pollInterval);
        historyState.pollInterval = null;
    }
}

// 刷新历史
document.getElementById('btn-refresh-history')?.addEventListener('click', loadConversationHistory);

// 清空历史
document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    const historyPath = getHistoryPath();
    try {
        fs.writeFileSync(historyPath, '', 'utf8');
        loadConversationHistory();
    } catch (e) {}
});

// 切换到对话历史标签时加载并开始轮询
document.querySelector('.nav-item[data-tab="history"]')?.addEventListener('click', () => {
    setTimeout(() => {
        loadConversationHistory();
        startHistoryPolling();
    }, 100);
});

// 离开对话历史标签时停止轮询
document.querySelectorAll('.nav-item').forEach(item => {
    if (item.dataset.tab !== 'history') {
        item.addEventListener('click', stopHistoryPolling);
    }
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function previewImage(src) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:999999;display:flex;justify-content:center;align-items:center;cursor:pointer;';
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:98%;max-height:98%;object-fit:contain;';
    overlay.appendChild(img);
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
}
