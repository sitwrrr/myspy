const { app, BrowserWindow, ipcMain, screen, Menu, globalShortcut, desktopCapturer } = require('electron')
const path = require('path')
const fs = require('fs')

const configPath = path.join(app.getAppPath(), 'config.json')

function createWindow() {
    let config = {}
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
        console.error('读取配置失败:', e)
    }

    const primaryDisplay = screen.getPrimaryDisplay()

    // 计算所有显示器的边界（跟原项目一致）
    const displays = screen.getAllDisplays()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    displays.forEach(display => {
        const { x, y, width, height } = display.bounds
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + width)
        maxY = Math.max(maxY, y + height)
    })

    const winW = maxX - minX
    const winH = maxY - minY
    const winX = minX
    const winY = minY

    const win = new BrowserWindow({
        x: winX,
        y: winY,
        width: winW,
        height: winH,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        focusable: true,
        type: 'desktop',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        resizable: true,
        movable: true,
        skipTaskbar: true
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setMenu(null)
    win.setIgnoreMouseEvents(true, { forward: true })
    win.loadFile('index.html')

    // 桌宠窗口关闭时通知控制面板
    win.on('closed', () => {
        petWindow = null
        if (controlPanel && !controlPanel.isDestroyed()) {
            controlPanel.webContents.send('pet-stopped')
        }
    })

    // 禁用默认右键菜单
    win.webContents.on('context-menu', (event) => {
        event.preventDefault()
    })

    // 降低置顶检查频率，避免影响任务栏点击
    setInterval(() => {
        if (!win.isDestroyed() && !win.isFocused() && !win.isAlwaysOnTop()) {
            win.setAlwaysOnTop(true, 'screen-saver')
        }
    }, 5000)

    return win
}

// 创建控制面板窗口
function createControlPanel() {
    const panel = new BrowserWindow({
        width: 900,
        height: 600,
        title: 'myspy 控制面板',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })

    panel.setMenu(null)
    panel.loadFile(path.join(__dirname, 'webui', 'index.html'))

    return panel
}

let petWindow = null
let controlPanel = null

// PTT 全局快捷键管理
let pttKey = 'v'
function registerPTTShortcut() {
    globalShortcut.unregisterAll()
    try {
        globalShortcut.register(pttKey, () => {
            if (petWindow && !petWindow.isDestroyed()) {
                petWindow.webContents.send('ptt-key-down')
            }
        })
    } catch (e) {
        console.error('注册 PTT 快捷键失败:', e)
    }
}
function unregisterPTTShortcut() {
    globalShortcut.unregisterAll()
}

app.whenReady().then(() => {
    petWindow = createWindow()
    controlPanel = createControlPanel()

    // 启动 Skill 目录监控
    startSkillWatcher()

    // 关闭控制面板时退出整个应用
    controlPanel.on('closed', () => {
        app.quit()
    })

    // 读取初始 PTT 配置
    try {
        let pttConfig = {}
        try { pttConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) {}
        pttKey = pttConfig.asr?.ptt_key || 'v'
        if (pttConfig.asr?.ptt_enabled) {
            registerPTTShortcut()
        }
    } catch (e) {}

    console.log('myspy 启动完成')
})

// 删除插件状态文件的函数
function cleanPluginStatus() {
    const statusPath = path.join(app.getAppPath(), 'plugins', 'running_plugins.json')
    try { fs.unlinkSync(statusPath); console.log('已删除插件状态文件') } catch (e) {}
}

app.on('before-quit', () => { stopSkillWatcher(); cleanPluginStatus() })
app.on('will-quit', cleanPluginStatus)
app.on('window-all-closed', () => {
    cleanPluginStatus()
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

ipcMain.on('set-ignore-mouse-events', (event, { ignore, options }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
        win.setIgnoreMouseEvents(ignore, options || {})
    }
})

ipcMain.handle('get-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const bounds = win.getBounds()
    return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }
})

// 保存 UI 配置（模型位置等）
ipcMain.on('save-ui-config', (event, data) => {
    try {
        let config = {}
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) {}
        if (!config.ui) config.ui = {}
        Object.assign(config.ui, data)
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    } catch (e) {
        console.error('保存 UI 配置失败:', e)
    }
})

ipcMain.on('open-devtools', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
        win.webContents.openDevTools()
    }
})

// 启动桌宠
ipcMain.on('start-pet', () => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.destroy()
    }
    petWindow = createWindow()
    // 如果有暂存的 Skill，宠物窗口加载完成后发送
    if (_pendingSkill) {
        petWindow.webContents.on('did-finish-load', () => {
            petWindow.webContents.send('apply-skill', _pendingSkill)
        })
    }
    // 如果 PTT 启用，重新注册全局快捷键
    try {
        let pttConfig = {}
        try { pttConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) {}
        if (pttConfig.asr?.ptt_enabled) {
            pttKey = pttConfig.asr?.ptt_key || 'v'
            registerPTTShortcut()
        }
    } catch (e) {}
})

// 停止桌宠
ipcMain.on('stop-pet', () => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.destroy()
        petWindow = null
    }
    // 注销 PTT 全局快捷键
    unregisterPTTShortcut()
    // 清空插件运行状态
    cleanPluginStatus()
})

// 获取桌宠状态
ipcMain.handle('get-pet-status', () => {
    return petWindow && !petWindow.isDestroyed()
})

// 切换模型
ipcMain.on('switch-model', (event, modelPath) => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('switch-model', modelPath)
    }
})

// Skill 人设切换（支持宠物窗口未创建时暂存）
let _pendingSkill = null

ipcMain.on('apply-skill', (event, skillContent) => {
    _pendingSkill = skillContent
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('apply-skill', skillContent)
    }
})

ipcMain.on('remove-skill', () => {
    _pendingSkill = null
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('remove-skill')
    }
})

// 预览表情
ipcMain.on('preview-expression', (event, exprName) => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('preview-expression', exprName)
    }
})

// 切换表情（开/关）
ipcMain.on('toggle-expression', (event, data) => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('toggle-expression', data)
    }
})

// 复位皮套位置
ipcMain.on('reset-pet-position', () => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('reset-pet-position')
    }
})

// 通知桌宠重新加载配置
ipcMain.on('reload-config', (event, data) => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('reload-config')
    }
    // 更新 PTT 全局快捷键
    if (data && data.ptt_enabled !== undefined) {
        if (data.ptt_enabled) {
            pttKey = data.ptt_key || 'v'
            registerPTTShortcut()
        } else {
            unregisterPTTShortcut()
        }
    }
})

// MCP 配置热重载（通知桌宠进程重新读取 MCP 配置）
ipcMain.handle('mcp-reload-config', () => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('mcp-reload-config')
    }
})

// === 情绪表情映射配置 ===
ipcMain.handle('scan-expressions', (event, characterPath) => {
    try {
        const results = []
        // 搜索1：expressions/ 子目录
        const exprDir = path.join(characterPath, 'expressions')
        if (fs.existsSync(exprDir)) {
            fs.readdirSync(exprDir)
                .filter(f => f.endsWith('.exp3.json'))
                .forEach(f => results.push({ name: path.basename(f, '.exp3.json'), file: 'expressions/' + f }))
        }
        // 搜索2：模型根目录下的 .exp3.json 文件
        if (fs.existsSync(characterPath)) {
            fs.readdirSync(characterPath)
                .filter(f => f.endsWith('.exp3.json'))
                .forEach(f => {
                    if (!results.some(r => r.name === path.basename(f, '.exp3.json'))) {
                        results.push({ name: path.basename(f, '.exp3.json'), file: f })
                    }
                })
        }
        return results
    } catch (e) {
        console.error('扫描表情目录失败:', e.message)
        return []
    }
})

ipcMain.handle('load-emotion-config', () => {
    try {
        const configPath = path.join(__dirname, 'emotion_expressions.json')
        if (!fs.existsSync(configPath)) return {}
        return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
        console.error('加载情绪配置失败:', e.message)
        return {}
    }
})

ipcMain.handle('save-emotion-config', (event, data) => {
    try {
        const configPath = path.join(__dirname, 'emotion_expressions.json')
        fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8')
        // 通知宠物窗口热重载
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send('reload-emotion-config')
        }
        return true
    } catch (e) {
        console.error('保存情绪配置失败:', e.message)
        return false
    }
})

// === Skill 管理 ===
ipcMain.handle('scan-skills', () => {
    try {
        const skillsDir = path.join(__dirname, 'skills')
        if (!fs.existsSync(skillsDir)) return []
        const skills = []
        for (const name of fs.readdirSync(skillsDir)) {
            const dir = path.join(skillsDir, name)
            if (!fs.statSync(dir).isDirectory()) continue
            const meta = { name, displayName: name, description: '', hasSoul: false, hasSkill: false }
            const soulPath = path.join(dir, 'SOUL.md')
            const skillPath = path.join(dir, 'SKILL.md')
            if (fs.existsSync(soulPath)) {
                meta.hasSoul = true
                const content = fs.readFileSync(soulPath, 'utf8')
                // 从第一行提取标题
                const titleMatch = content.match(/^#\s+(.+)/m)
                if (titleMatch) meta.displayName = titleMatch[1].trim()
                // 从第二行提取描述
                const descMatch = content.match(/^>\s*(.+)/m)
                if (descMatch) meta.description = descMatch[1].trim()
            }
            if (fs.existsSync(skillPath)) meta.hasSkill = true
            if (meta.hasSoul || meta.hasSkill) skills.push(meta)
        }
        return skills
    } catch (e) {
        console.error('扫描 Skill 失败:', e.message)
        return []
    }
})

// === Skill 目录监控 ===
let _skillWatcher = null
function startSkillWatcher() {
    const skillsDir = path.join(__dirname, 'skills')
    if (!fs.existsSync(skillsDir)) return
    try {
        _skillWatcher = fs.watch(skillsDir, { recursive: true }, (eventType, filename) => {
            if (filename && controlPanel && !controlPanel.isDestroyed()) {
                controlPanel.webContents.send('skills-changed')
            }
        })
    } catch (e) {
        console.error('Skill 监控启动失败:', e.message)
    }
}
function stopSkillWatcher() {
    if (_skillWatcher) { _skillWatcher.close(); _skillWatcher = null }
}

ipcMain.handle('load-skill-content', (event, skillName) => {
    try {
        const dir = path.join(__dirname, 'skills', skillName)
        const result = {}
        const soulPath = path.join(dir, 'SOUL.md')
        const skillPath = path.join(dir, 'SKILL.md')
        if (fs.existsSync(soulPath)) result.soul = fs.readFileSync(soulPath, 'utf8')
        if (fs.existsSync(skillPath)) result.skill = fs.readFileSync(skillPath, 'utf8')
        return result
    } catch (e) {
        console.error('读取 Skill 内容失败:', e.message)
        return {}
    }
})

// 转发日志到控制面板
ipcMain.on('log-message', (event, logData) => {
    if (controlPanel && !controlPanel.isDestroyed()) {
        controlPanel.webContents.send('log-message', logData)
    }
})

// 插件健康检查
ipcMain.handle('check-plugin-health', async (event) => {
    const results = {}
    const builtInDir = path.join(app.getAppPath(), 'plugins', 'built-in')
    const axios = require('axios')

    try {
        // 只检查已启用的插件
        let enabledPlugins = []
        try {
            const enabledPath = path.join(app.getAppPath(), 'plugins', 'enabled_plugins.json')
            enabledPlugins = JSON.parse(fs.readFileSync(enabledPath, 'utf8'))
        } catch (_) {}

        for (const name of enabledPlugins) {
            const pluginDir = path.join(builtInDir, name)
            if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) continue

            // 读取插件配置
            let cfg = {}
            try {
                const cfgPath = path.join(builtInDir, name, 'plugin_config.json')
                if (fs.existsSync(cfgPath)) {
                    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
                    // 解析 schema 格式
                    for (const [key, def] of Object.entries(raw)) {
                        if (def !== null && typeof def === 'object' && 'type' in def) {
                            cfg[key] = def.value !== undefined ? def.value : def.default
                        } else {
                            cfg[key] = def
                        }
                    }
                }
            } catch (_) {}

            // 根据插件类型做不同检测
            if (name === 'memos') {
                // 检测后端服务
                const apiUrl = cfg.api_url || 'http://127.0.0.1:8003'
                try {
                    const resp = await axios.get(`${apiUrl}/health`, { timeout: 2000 })
                    results[name] = resp.data.status === 'healthy' ? 'healthy' : 'error'
                } catch (_) {
                    results[name] = 'offline'
                }
            } else if (name === 'code-executor') {
                // 检测 Python 是否存在
                const pythonPath = path.join(pluginDir, '..', '..', '..', 'venv', 'Scripts', 'python.exe')
                results[name] = fs.existsSync(pythonPath) ? 'ok' : 'offline'
            } else {
                // screenshot、context-compressor 等无外部依赖的插件
                results[name] = 'ok'
            }
        }
    } catch (_) {}

    return results
})

// 截屏 - 使用 Electron 内置 desktopCapturer
ipcMain.handle('take-screenshot', async (event) => {
    const { nativeImage } = require('electron')
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
    })
    if (!sources || sources.length === 0) {
        throw new Error('无法获取屏幕源')
    }
    // 获取光标所在屏幕
    const cursorPoint = screen.getCursorScreenPoint()
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint)
    // 找到匹配的屏幕源
    let source = sources[0]
    for (const s of sources) {
        if (s.display_id && String(s.display_id) === String(currentDisplay.id)) {
            source = s
            break
        }
    }
    const thumbnail = source.thumbnail
    if (thumbnail.isEmpty()) {
        throw new Error('截图缩略图为空')
    }
    // 转换为 JPEG base64
    const jpgBuffer = thumbnail.toJPEG(85)
    return jpgBuffer.toString('base64')
})
