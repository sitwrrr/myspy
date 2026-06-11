// app.js - 渲染进程入口
const fs = require('fs')
const path = require('path')
const { ipcRenderer } = require('electron')
const { TTSClient } = require('./js/tts-client')
const { ASRProcessor } = require('./js/asr-client')
const { PluginManager } = require('./js/core/plugin-manager.js')
const { ModelInteractionController } = require('./js/model/model-interaction.js')
const { LLMClient } = require('./js/llm-client')
const { TTSStreamProcessor } = require('./js/tts-stream-processor')
const { EmotionExpressionMapper } = require('./js/emotion-expression-mapper')
const { ScreenshotManager } = require('./js/screenshot-manager')
const { VRMModelSetup } = require('./js/model/vrm-model-setup.js')
const { VRMInteractionController } = require('./js/model/vrm-model-interaction.js')
const { UnifiedModelAdapter } = require('./js/model/unified-model-adapter.js')
const { UnifiedInteractionController } = require('./js/model/unified-interaction-controller.js')
const { appState } = require('./js/core/app-state.js')
const { ModelScanner } = require('./js/model/model-scanner.js')
const { DiaryManager } = require('./js/diary-manager')
const { MCPManager } = require('./js/mcp/mcp-manager')
const { logToTerminal } = require('./js/api-utils')

// 情绪表情映射器
const emotionMapper = new EmotionExpressionMapper()

// 日志记录
function log(msg, level = 'info') {
    console.log(msg)
    ipcRenderer.send('log-message', { level, message: msg, timestamp: Date.now() })
}

function logTool(msg, level = 'info') {
    console.log('[TOOL] ' + msg)
    ipcRenderer.send('log-message', { level, message: msg, timestamp: Date.now(), isTool: true })
}

// 加载配置
let config
try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
} catch (e) {
    console.error('配置失败:', e)
}

// 初始化TTS
const tts = new TTSClient(config)

// 初始化智能截图管理器
const screenshotManager = new ScreenshotManager(config)

// 初始化流式 TTS 处理器（延迟初始化，需要 modelCtrl）
let ttsStreamProcessor = null

// 对话历史（供插件系统使用）
const messages = [
    { role: 'system', content: config?.llm?.system_prompt || '你是一个可爱的AI桌宠助手。' }
]

// === Skill 系统（顶层变量，LLM 调用时动态注入）===
let _activeSkillContent = null  // { soul, skill }

// === 情绪→表情自动映射（5秒后自动恢复）===
let _currentEmotionExpressions = []  // 当前激活的表情参数列表
let _emotionTimer = null              // 自动恢复定时器

const EMOTION_EXPRESSION_MAP = {
    '开心': ['lianhong'],           // 脸红
    '生气': ['shengqi', 'jiao'],    // 生气+角
    '难过': ['yanlei', 'buan'],     // 眼泪+不安
    '惊讶': ['wuyu'],               // 无语
    '害羞': ['hailian', 'lianhong'], // 害羞+脸红
    '俏皮': ['shanzi']              // 扇子
}

function _applyEmotionExpression(emotion) {
    if (!model) return
    const inner = model.innerModel || model
    if (!inner.internalModel || !inner.internalModel.coreModel) return
    const cm = inner.internalModel.coreModel
    const fs = require('fs')

    // 清除旧定时器
    if (_emotionTimer) {
        clearTimeout(_emotionTimer)
        _emotionTimer = null
    }

    // 关闭上一个情绪的表情
    for (const p of _currentEmotionExpressions) {
        try { cm.setParameterValueById(p.Id, 0) } catch (e) {}
    }
    _currentEmotionExpressions = []

    // 开启新情绪的表情
    const exprNames = EMOTION_EXPRESSION_MAP[emotion]
    if (!exprNames) return

    const modelPath = config?.ui?.model_path || ''
    const charMatch = modelPath.match(/2D\/([^\/]+)\//)
    const charName = charMatch ? charMatch[1] : ''
    if (!charName) return

    for (const exprName of exprNames) {
        const exprPath = path.join(__dirname, '2D', charName, exprName + '.exp3.json')
        if (!fs.existsSync(exprPath)) continue
        try {
            const exprData = JSON.parse(fs.readFileSync(exprPath, 'utf8'))
            for (const p of (exprData.Parameters || [])) {
                try { cm.setParameterValueById(p.Id, p.Value) } catch (e) {}
                _currentEmotionExpressions.push({ id: p.id, value: p.Value })
            }
        } catch (e) {}
    }

    // 5秒后自动恢复
    _emotionTimer = setTimeout(() => {
        for (const p of _currentEmotionExpressions) {
            try { cm.setParameterValueById(p.id, 0) } catch (e) {}
        }
        _currentEmotionExpressions = []
        _emotionTimer = null
    }, 10000)
}

ipcRenderer.on('apply-skill', (event, skillContent) => {
    try {
        if (skillContent && skillContent.soul) {
            _activeSkillContent = skillContent
            const nameMatch = skillContent.soul.match(/^#\s+(.+)/m)
            const roleName = nameMatch ? nameMatch[1].trim() : 'AI'
            log('Skill 已激活: ' + roleName)
        }
    } catch (e) {
        log('Skill 激活失败: ' + e.message, 'error')
    }
})

ipcRenderer.on('remove-skill', () => {
    _activeSkillContent = null
    log('Skill 已停用')
})

// ===== 持久化对话历史 =====
function getHistoryPath() {
    const relativePath = config?.context?.history_file || 'AI记录室/对话历史.jsonl'
    return path.join(__dirname, relativePath)
}

function loadConversationHistory() {
    if (!config?.context?.persistent_history) return
    const historyPath = getHistoryPath()
    try {
        if (fs.existsSync(historyPath)) {
            const content = fs.readFileSync(historyPath, 'utf8')
            const lines = content.trim().split('\n')
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const msg = JSON.parse(line)
                        messages.push(msg)
                    } catch (e) {
                        console.error('解析对话历史行失败:', line.substring(0, 50))
                    }
                }
            }
            console.log(`已加载 ${messages.length - 1} 条历史对话`)
        }
    } catch (e) {
        console.error('加载对话历史失败:', e)
    }
}

function saveConversationHistory() {
    if (!config?.context?.persistent_history) return
    const historyPath = getHistoryPath()
    try {
        const dir = path.dirname(historyPath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        // 保存 user、assistant 和压缩摘要（system消息含[历史对话总结]）
        const toSave = messages.filter(m => {
            if (m.role === 'user' || m.role === 'assistant') return true
            if (m.role === 'system' && m.content && m.content.includes('[历史对话总结]')) return true
            return false
        })
        const lines = toSave.map(m => JSON.stringify(m)).join('\n') + '\n'
        fs.writeFileSync(historyPath, lines, 'utf8')
    } catch (e) {
        console.error('保存对话历史失败:', e)
    }
}

// 启动时加载历史
loadConversationHistory()

// 设置插件系统需要的全局变量
const diaryManager = new DiaryManager(config)
global.voiceChat = {
    messages: messages,
    API_URL: config?.llm?.api_url || '',
    API_KEY: config?.llm?.api_key || '',
    MODEL: config?.llm?.model || '',
    ttsProcessor: tts,
    diaryManager: diaryManager,
    sendToLLM: async (content) => { await sendMessage(content) },
    setModel: (m) => { global.currentModel = m },
    setEmotionMapper: null
}

// 上下文裁剪
function trimMessages() {
    if (!config?.context?.enable_limit) return

    const maxMessages = config.context.max_messages || 18
    const systemMessages = messages.filter(msg => msg.role === 'system')
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system')

    if (nonSystemMessages.length > maxMessages) {
        const recentMessages = nonSystemMessages.slice(-maxMessages)
        messages.length = 0
        messages.push(...systemMessages, ...recentMessages)
        log('上下文裁剪: 保留 ' + recentMessages.length + ' 条非系统消息')
    }
}

global.showSubtitle = function(text) {
    const el = document.getElementById('subtitle-text')
    const container = document.getElementById('subtitle-container')
    if (el && container) {
        // 字幕禁用时不显示
        if (config?.subtitle_labels?.enabled === false) return
        el.textContent = text
        container.style.display = 'block'
        container.scrollTop = container.scrollHeight
    }
}

// 渐进更新字幕（流式显示用）
let _subtitleUpdateTimer = null
let _subtitleHideTimer = null

global.updateSubtitle = function(text, isFinal = false) {
    const el = document.getElementById('subtitle-text')
    const container = document.getElementById('subtitle-container')
    if (!el || !container) return
    if (config?.subtitle_labels?.enabled === false) return

    container.style.display = 'block'

    // 直接设置文本（跟原项目一样简单）
    el.textContent = text
    container.scrollTop = container.scrollHeight

    // 每次更新都重置隐藏计时器，5秒后自动隐藏
    if (_subtitleHideTimer) clearTimeout(_subtitleHideTimer)
    _subtitleHideTimer = setTimeout(() => {
        container.style.display = 'none'
    }, 5000)
}

// 隐藏字幕
global.hideSubtitle = function() {
    const container = document.getElementById('subtitle-container')
    if (container) {
        container.style.display = 'none'
    }
}

// 保持兼容性
global.setSubtitlePrefix = function(prefix) {}
global.setSubtitleHideDelay = function(ms) {}

// ASR 语音识别
const asrProcessor = new ASRProcessor(config)
asrProcessor.setOnSpeechRecognized((text) => {
    if (text && text.trim()) {
        showSubtitle((config?.subtitle_labels?.user || '你') + ': ' + text)
        sendMessage(text)
    }
})

// 连接语音打断
if (config.asr?.voice_barge_in) {
    asrProcessor.setTTSProcessor(tts)
}

global.modelController = null

// DOM
const chatInput = document.getElementById('chat-input')
const chatSendBtn = document.getElementById('chat-send-btn')
const subtitleContainer = document.getElementById('subtitle-container')
const subtitleText = document.getElementById('subtitle-text')
const chatContainer = document.getElementById('text-chat-container')

let model = null
let modelCtrl = null

// 鼠标是否在交互区域（模型或聊天框）
let mouseOverInteractive = false

// 聊天框穿透控制（跟原项目一致）
chatContainer.addEventListener('mouseenter', () => {
    ipcRenderer.send('set-ignore-mouse-events', { ignore: false, options: { forward: false } })
})
chatContainer.addEventListener('mouseleave', () => {
    ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } })
})
chatInput.addEventListener('focus', () => {
    ipcRenderer.send('set-ignore-mouse-events', { ignore: false, options: { forward: false } })
})
chatInput.addEventListener('blur', () => {
    ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } })
})

function showSubtitle(text) {
    // 字幕禁用时不显示
    if (config?.subtitle_labels?.enabled === false) return
    subtitleText.textContent = text
    subtitleContainer.style.display = 'block'
    setTimeout(() => subtitleContainer.style.display = 'none', 5000)
}


async function main() {
    try {
        const bounds = await ipcRenderer.invoke('get-window-bounds')
        const actualWidth = bounds.width
        const actualHeight = bounds.height

        // 保存缩放因子到全局
        window.actualWidth = actualWidth
        window.actualHeight = actualHeight
        window.canvasScaleFactor = 2

        let app = null

        // ===== 自动检测模型 =====
        // 1. 优先使用配置的模型路径
        // 2. 根据文件扩展名自动检测类型（.vrm → VRM, .model3.json → Live2D）
        // 3. 如果没配置，扫描 2D/ 和 3D/ 目录自动选择
        let modelPath = config?.ui?.model_path || ''
        let modelType = config?.ui?.model_type || ''

        // 如果没配置模型路径，扫描目录自动选择
        if (!modelPath) {
            const scanned = ModelScanner.getDefaultModel(__dirname)
            if (scanned) {
                modelPath = scanned.path
                modelType = scanned.type
                logToTerminal('info', `自动检测到模型: ${scanned.name} (${scanned.type})`)
            }
        }

        // 根据文件扩展名自动检测类型（覆盖配置）
        if (modelPath) {
            const detectedType = ModelScanner.detectType(modelPath)
            if (detectedType) {
                modelType = detectedType
            }
        }

        // 兜底默认值
        if (!modelType) modelType = 'live2d'
        if (!modelPath) modelPath = '2D/feiniu/hiyori_pro_t11.model3.json'

        logToTerminal('info', `模型类型: ${modelType}, 路径: ${modelPath}`)

        if (modelType === 'vrm') {
            // VRM 3D 模型
            logToTerminal('info', '正在加载VRM 3D模型...')
            try {
                const result = await VRMModelSetup.initialize(
                    modelCtrl, config,
                    config?.tts?.enabled !== false,
                    config?.asr?.enabled !== false,
                    tts, global.voiceChat
                )

                // 用统一适配器包装 VRM 模型
                model = new UnifiedModelAdapter(result.model, result.app, 'vrm', config)
                global.currentModel = model
                global.pixiApp = result.app

                // VRM模式：替换modelController并更新TTS唇形回调
                if (result.vrmController) {
                    modelCtrl = result.vrmController
                }

                logToTerminal('info', 'VRM 模型加载完成')
            } catch (vrmErr) {
                logToTerminal('error', 'VRM 加载失败: ' + vrmErr.message)
                console.error('VRM 加载失败:', vrmErr)
            }
        } else {
            // Live2D 模型
            // 2x canvas（跟原项目一致，支持高分辨率）
            app = new PIXI.Application({
                view: document.getElementById('canvas'),
                autoStart: true,
                transparent: true,
                width: actualWidth * 2,
                height: actualHeight * 2
            })
            app.view.style.width = `${actualWidth}px`
            app.view.style.height = `${actualHeight}px`

            const live2dModel = await PIXI.live2d.Live2DModel.from(modelPath)
            app.stage.addChild(live2dModel)

            // 用统一适配器包装 Live2D 模型
            model = new UnifiedModelAdapter(live2dModel, app, 'live2d', config)

            // 模型可见性
            model.visible = config?.ui?.show_model !== false

            console.log(`=== 模型调试 ===`)
            console.log(`模型尺寸: ${model.width}x${model.height}`)
            console.log(`模型缩放: ${model.scale.x}`)
            console.log(`Canvas尺寸: ${app.view.width}x${app.view.height}`)
            console.log(`窗口尺寸: ${actualWidth}x${actualHeight}`)
            console.log(`模型可见: ${model.visible}`)

            // 初始化统一交互控制器
            const unifiedCtrl = new UnifiedInteractionController()
            unifiedCtrl.init(model, config)
            unifiedCtrl.setupInitialModelProperties()

            // 初始化情绪表情映射器
            emotionMapper.init(model.innerModel)
            model.setEmotionMapper(emotionMapper)

            console.log(`模型位置: (${model.x}, ${model.y})`)
            console.log(`模型最终缩放: ${model.scale.x}`)

            // 嘴型控制器（包装 unifiedCtrl）
            modelCtrl = {
                setMouthOpenY: (v) => unifiedCtrl.setMouthOpenY(v)
            }
        }

        // 初始化流式 TTS 处理器（先销毁旧的）
        if (tts.enabled) {
            if (ttsStreamProcessor) ttsStreamProcessor.destroy()
            ttsStreamProcessor = new TTSStreamProcessor(config, tts, modelCtrl)
        }

        // 设置全局模型引用（供插件使用）
        global.modelController = modelCtrl
        global.currentModel = model

        // 监听模型切换
        ipcRenderer.on('switch-model', async (event, newPath) => {
            try {
                // 自动检测新模型类型
                const newType = ModelScanner.detectType(newPath) || config?.ui?.model_type || 'live2d'
                log('切换模型: ' + newPath + ' (类型: ' + newType + ')')

                if (newType === 'vrm') {
                    // VRM 模型切换需要重启
                    log('VRM 模型切换需要重启桌宠生效')
                } else {
                    // Live2D 模型切换
                    if (model && model.innerModel) {
                        app.stage.removeChild(model.innerModel)
                    }
                    const live2dModel = await PIXI.live2d.Live2DModel.from(newPath)
                    app.stage.addChild(live2dModel)
                    model = new UnifiedModelAdapter(live2dModel, app, 'live2d', config)
                    model.visible = config?.ui?.show_model !== false
                    const unifiedCtrl = new UnifiedInteractionController()
                    unifiedCtrl.init(model, config)
                    unifiedCtrl.setupInitialModelProperties()
                    emotionMapper.init(model.innerModel)
                    model.setEmotionMapper(emotionMapper)
                    modelCtrl = { setMouthOpenY: (v) => unifiedCtrl.setMouthOpenY(v) }
                    global.currentModel = model
                    log('模型已切换: ' + newPath)
                }
            } catch (e) {
                console.error('切换模型失败:', e)
            }
        })

        // 监听复位位置
        ipcRenderer.on('reset-pet-position', () => {
            if (model) {
                // 通过统一交互控制器复位
                if (modelCtrl && modelCtrl.setupInitialModelProperties) {
                    modelCtrl.setupInitialModelProperties()
                }
                log('皮套位置已复位')
            }
        })

        // 监听配置重载
        ipcRenderer.on('reload-config', () => {
            try {
                const oldConfig = JSON.parse(JSON.stringify(config))
                config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))

                // 文字输入框
                const showChatBox = config?.ui?.show_chat_box !== false
                const oldShowChatBox = oldConfig?.ui?.show_chat_box !== false
                if (showChatBox !== oldShowChatBox) {
                    log('文字输入框已' + (showChatBox ? '显示' : '隐藏'))
                }
                chatContainer.style.display = showChatBox ? 'block' : 'none'

                // ASR 启用
                const asrEnabled = config?.asr?.enabled !== false
                if (asrEnabled !== (oldConfig?.asr?.enabled !== false)) {
                    log('ASR: ' + (asrEnabled ? '启用' : '禁用'))
                }

                // 按键说话
                const pttEnabled = config?.asr?.ptt_enabled || false
                if (pttEnabled !== (oldConfig?.asr?.ptt_enabled || false)) {
                    log('按键说话: ' + (pttEnabled ? '启用' : '禁用'))
                    asrProcessor.pttModeEnabled = pttEnabled
                    // 重置录音状态，防止状态残留
                    asrProcessor.isRecording = false
                    asrProcessor.asrLocked = false
                }

                // V键超时
                const pttTimeout = parseInt(config?.asr?.ptt_max_timeout) || 10
                const oldPttTimeout = parseInt(oldConfig?.asr?.ptt_max_timeout) || 10
                if (pttTimeout !== oldPttTimeout) {
                    asrProcessor.pttMaxTimeout = pttTimeout * 1000
                    log('V键超时: ' + pttTimeout + '秒')
                }

                // TTS 启用
                const ttsEnabled = config?.tts?.enabled !== false
                if (tts.enabled !== ttsEnabled) {
                    log('TTS: ' + (ttsEnabled ? '启用' : '禁用'))
                }
                tts.enabled = ttsEnabled

                // TTS 语言
                const oldLang = tts.language
                tts.language = config?.tts?.language || 'zh'
                if (oldLang !== tts.language) {
                    log('TTS 语言: ' + tts.language)
                }

                // 模型可见性
                if (model) {
                    const showModel = config?.ui?.show_model !== false
                    const oldShowModel = oldConfig?.ui?.show_model !== false
                    if (showModel !== oldShowModel) {
                        log('模型已' + (showModel ? '显示' : '隐藏'))
                    }
                    model.visible = showModel
                }

                // 字幕标签
                const subtitleEnabled = config?.subtitle_labels?.enabled !== false
                const oldSubtitleEnabled = oldConfig?.subtitle_labels?.enabled !== false
                if (subtitleEnabled !== oldSubtitleEnabled) {
                    log('字幕已' + (subtitleEnabled ? '启用' : '禁用'))
                }
                const newUser = config?.subtitle_labels?.user || ''
                const oldUser = oldConfig?.subtitle_labels?.user || ''
                const newAi = config?.subtitle_labels?.ai || ''
                const oldAi = oldConfig?.subtitle_labels?.ai || ''
                if (newUser !== oldUser || newAi !== oldAi) {
                    log('字幕标签: ' + (newUser || '用户') + ' / ' + (newAi || 'AI'))
                }

                // 上下文限制
                const contextLimit = config?.context?.enable_limit !== false
                const oldContextLimit = oldConfig?.context?.enable_limit !== false
                if (contextLimit !== oldContextLimit) {
                    log('上下文限制已' + (contextLimit ? '启用' : '禁用'))
                }

                // 最大消息数
                const maxMessages = config?.context?.max_messages || 18
                const oldMaxMessages = oldConfig?.context?.max_messages || 18
                if (maxMessages !== oldMaxMessages) {
                    log('最大消息数已调整为: ' + maxMessages)
                }

                // 温度
                const temperature = config?.llm?.temperature || 0.7
                const oldTemperature = oldConfig?.llm?.temperature || 0.7
                if (temperature !== oldTemperature) {
                    log('温度已调整为: ' + temperature)
                }

                // 温度开关
                const tempEnabled = config?.llm?.temperature_enabled || false
                const oldTempEnabled = oldConfig?.llm?.temperature_enabled || false
                if (tempEnabled !== oldTempEnabled) {
                    log('温度设置已' + (tempEnabled ? '启用' : '禁用'))
                }

                // 语音打断
                const bargeIn = config?.asr?.voice_barge_in || false
                const oldBargeIn = oldConfig?.asr?.voice_barge_in || false
                if (bargeIn !== oldBargeIn) {
                    log('语音打断: ' + (bargeIn ? '启用' : '禁用'))
                    if (bargeIn) {
                        asrProcessor.setTTSProcessor(tts)
                    } else {
                        asrProcessor.setTTSProcessor(null)
                    }
                }

                // MCP 启用状态热重载
                const mcpEnabled = config?.mcp?.enabled || false
                const oldMcpEnabled = oldConfig?.mcp?.enabled || false
                if (mcpEnabled !== oldMcpEnabled) {
                    log('MCP: ' + (mcpEnabled ? '启用' : '禁用'))
                    logToTerminal('info', 'MCP: ' + (mcpEnabled ? '已启用' : '已禁用'))
                    if (global.mcpManager) {
                        global.mcpManager.isEnabled = mcpEnabled
                    }
                }

                // BERT 分类热重载
                const bertEnabled = config?.bert?.enabled || false
                if (bertEnabled !== (oldConfig?.bert?.enabled || false)) {
                    log('BERT: ' + (bertEnabled ? '启用' : '禁用'))
                    logToTerminal('info', 'BERT: ' + (bertEnabled ? '已启用' : '已禁用'))
                }
                if (screenshotManager) {
                    screenshotManager.bertEnabled = bertEnabled
                    screenshotManager.bertUrl = config?.bert?.url || screenshotManager.bertUrl
                }

                // 同步 voiceChat API 信息（插件 callLLM 使用）
                if (global.voiceChat) {
                    global.voiceChat.API_URL = config?.llm?.api_url || ''
                    global.voiceChat.API_KEY = config?.llm?.api_key || ''
                    global.voiceChat.MODEL = config?.llm?.model || ''
                }

            } catch (e) {
                log('重载配置失败: ' + e.message, 'error')
            }
        })

        // MCP 配置热重载（WebUI 保存小米配置后触发）
        ipcRenderer.on('mcp-reload-config', () => {
            try {
                // 重新读取小米配置（下次 MCP 调用时自动生效）
                log('MCP 配置已热重载')
            } catch (e) {
                log('MCP 热重载失败: ' + e.message, 'error')
            }
        })

        // 情绪表情映射热重载
        ipcRenderer.on('reload-emotion-config', () => {
            try {
                emotionMapper.reloadConfig()
                log('情绪表情映射已热重载')
            } catch (e) {
                log('情绪映射热重载失败: ' + e.message, 'error')
            }
        })

        // 预览表情
        ipcRenderer.on('preview-expression', (event, exprName) => {
            try {
                if (model) {
                    // 尝试直接调用表情（可能失败，因为未注册到model3.json）
                    try {
                        model.expression(exprName)
                    } catch (e) {
                        // 如果失败，用参数模拟微笑效果作为预览
                        const inner = model.innerModel || model
                        if (inner.internalModel && inner.internalModel.coreModel) {
                            const cm = inner.internalModel.coreModel
                            try { cm.setParameterValueById('ParamEyeLSmile', 1) } catch (e) {}
                            try { cm.setParameterValueById('ParamEyeRSmile', 1) } catch (e) {}
                            try { cm.setParameterValueById('ParamMouthForm', 0.5) } catch (e) {}
                            setTimeout(() => {
                                try { cm.setParameterValueById('ParamEyeLSmile', 0) } catch (e) {}
                                try { cm.setParameterValueById('ParamEyeRSmile', 0) } catch (e) {}
                                try { cm.setParameterValueById('ParamMouthForm', 0) } catch (e) {}
                            }, 2000)
                        }
                    }
                    log('预览表情: ' + exprName)
                }
            } catch (e) {
                log('预览表情失败: ' + e.message, 'error')
            }
        })

        // 切换表情（开/关）
        ipcRenderer.on('toggle-expression', (event, data) => {
            try {
                if (!model) return
                const inner = model.innerModel || model
                if (!inner.internalModel || !inner.internalModel.coreModel) return
                const cm = inner.internalModel.coreModel

                // 读取表情文件获取参数
                const fs = require('fs')
                const modelPath = config?.ui?.model_path || ''
                const charMatch = modelPath.match(/2D\/([^\/]+)\//)
                const charName = charMatch ? charMatch[1] : ''
                const exprPath = path.join(__dirname, '2D', charName, data.file)
                if (!fs.existsSync(exprPath)) {
                    log('表情文件不存在: ' + data.file, 'warn')
                    return
                }
                const exprData = JSON.parse(fs.readFileSync(exprPath, 'utf8'))
                const params = exprData.Parameters || []

                if (data.active) {
                    // 开启：设置参数值
                    for (const p of params) {
                        try { cm.setParameterValueById(p.Id, p.Value) } catch (e) {}
                    }
                    log('开启表情: ' + data.name + ' (' + params.map(p => p.Id).join(', ') + ')')
                } else {
                    // 关闭：重置参数为默认值（0）
                    for (const p of params) {
                        try { cm.setParameterValueById(p.Id, 0) } catch (e) {}
                    }
                    log('关闭表情: ' + data.name)
                }
            } catch (e) {
                log('切换表情失败: ' + e.message, 'error')
            }
        })

        log('myspy 启动完成')

        // ASR 启用后，启动麦克风（PTT 和监听模式都需要）
        if (config?.asr?.enabled !== false) {
            setTimeout(() => {
                asrProcessor.startRecording()
                log('ASR 录音已启动')
            }, 3000)
        }

        // 开场白
        const introText = config?.ui?.intro_text
        if (introText) {
            setTimeout(async () => {
                showSubtitle(introText)
                // TTS 播完后再隐藏字幕
                if (config?.tts?.enabled) {
                    await tts.speak(introText, modelCtrl)
                } else {
                    await new Promise(r => setTimeout(r, 5000))
                }
                const container = document.getElementById('subtitle-container')
                if (container) container.style.display = 'none'
            }, 1000)
        }

        // 文字输入框可见性
        const showChatBox = config?.ui?.show_chat_box !== false
        chatContainer.style.display = showChatBox ? 'block' : 'none'

        // 初始化插件系统（仅 loadAll，startAll 延后到子系统就绪后）
        let pluginManager
        try {
            pluginManager = new PluginManager(config)
            await pluginManager.loadAll()
            global.pluginManager = pluginManager
            logTool('插件系统加载完成')

            // 写入插件运行状态到文件，并定期更新
            const statusPath = path.join(__dirname, 'plugins', 'running_plugins.json')
            const updateStatus = () => {
                const loaded = Array.from(pluginManager._plugins.keys())
                fs.writeFileSync(statusPath, JSON.stringify(loaded, null, 2))
            }
            updateStatus()
            setInterval(updateStatus, 5000)
        } catch (e) {
            console.error('插件系统加载失败:', e)
        }

        // 初始化 MCP 系统
        try {
            const mcpManager = new MCPManager(config)
            await mcpManager.initialize()
            global.mcpManager = mcpManager
            logTool('MCP 系统加载完成')
        } catch (e) {
            console.error('MCP 系统加载失败:', e)
        }

        // 所有子系统就绪后，启动插件
        if (pluginManager) {
            await pluginManager.startAll()
            logTool('插件系统已启动')
        }

    } catch (e) {
        console.error('初始化失败:', e)
    }
}

// 构建 LLM 请求体
function buildRequestBody(messages, tools) {
    const body = {
        model: config.llm.model,
        messages: messages
    }
    if (tools && tools.length > 0) {
        body.tools = tools
    }
    if (config.llm.temperature_enabled) {
        body.temperature = config.llm.temperature || 0.7
    }
    return body
}

// 截图并返回 base64
async function takeScreenshot() {
    try {
        const { ipcRenderer } = require('electron')
        const base64 = await ipcRenderer.invoke('take-screenshot')
        return base64 || null
    } catch (e) {
        log('截图失败: ' + e.message, 'warn')
        return null
    }
}

// 构建带图片的消息
function buildMessagesWithImage(messages, screenshotBase64) {
    if (!screenshotBase64) return messages

    const result = messages.map(msg => ({ ...msg }))
    // 找到最后一条用户消息，附加图片
    for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].role === 'user') {
            const existingContent = typeof result[i].content === 'string'
                ? [{ type: 'text', text: result[i].content }]
                : result[i].content
            result[i] = {
                role: 'user',
                content: [
                    ...existingContent,
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } }
                ]
            }
            break
        }
    }
    return result
}

// 清洗消息以兼容各种 LLM API
function cleanMessagesForAPI(messages) {
    return messages.map(msg => {
        const cleaned = { ...msg }
        // null content → 空字符串
        if (cleaned.content === null || cleaned.content === undefined) {
            cleaned.content = ''
        }
        // tool message 对象 → JSON.stringify
        if (cleaned.role === 'tool' && typeof cleaned.content === 'object' && cleaned.content !== null) {
            cleaned.content = JSON.stringify(cleaned.content)
        }
        // 字符串内容：过滤控制字符，截断超长内容
        if (typeof cleaned.content === 'string') {
            cleaned.content = cleaned.content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            if (cleaned.content.length > 8000) {
                cleaned.content = cleaned.content.substring(0, 8000) + '...(内容已截断)'
            }
        }
        return cleaned
    })
}

// 调用 LLM API（非流式）
async function callLLM(messages, tools = null, apiUrl = null, apiKey = null) {
    const url = apiUrl || config.llm.api_url + '/chat/completions'
    const key = apiKey || config.llm.api_key
    // 动态注入 Skill 内容（完全替换系统消息）
    let cleaned = cleanMessagesForAPI(messages)
    if (_activeSkillContent && _activeSkillContent.soul) {
        const nameMatch = _activeSkillContent.soul.match(/^#\s+(.+)/m)
        const roleName = nameMatch ? nameMatch[1].trim() : 'AI'
        const persona = `你是${roleName}。按以下规则与用户对话。回复要短(1-3 句),不要解释你的人格,直接说话。\n\n${_activeSkillContent.soul}\n\n${_activeSkillContent.skill || ''}\n\n你可以用情绪标签：<开心> <生气> <难过> <惊讶> <害羞> <俏皮>，自然地用就行，想用就用，不想用就不用。`
        cleaned = cleaned.filter(m => m.role !== 'system')
        cleaned.unshift({ role: 'system', content: persona })
    }
    const body = buildRequestBody(cleaned, tools)
    log('LLM请求: ' + url + ' 消息数: ' + messages.length)
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(body)
    })
    log('LLM响应状态: ' + r.status)
    const result = await r.json()
    if (result.error) {
        log('LLM错误: ' + JSON.stringify(result.error), 'error')
    }
    return result
}

// 流式 LLM 调用 - 逐块返回文本
async function callLLMStream(messages, tools = null, onChunk = null) {
    const url = config.llm.api_url + '/chat/completions'
    const key = config.llm.api_key
    // 动态注入 Skill 内容到系统消息（完全替换）
    let cleaned = cleanMessagesForAPI(messages)
    if (_activeSkillContent && _activeSkillContent.soul) {
        const nameMatch = _activeSkillContent.soul.match(/^#\s+(.+)/m)
        const roleName = nameMatch ? nameMatch[1].trim() : 'AI'
        const persona = `你是${roleName}。按以下规则与用户对话。回复要短(1-3 句),不要解释你的人格,直接说话。\n\n${_activeSkillContent.soul}\n\n${_activeSkillContent.skill || ''}`
        // 移除所有系统消息，只保留 Skill 的
        cleaned = cleaned.filter(m => m.role !== 'system')
        cleaned.unshift({ role: 'system', content: persona })
    }
    const body = buildRequestBody(cleaned, tools)
    body.stream = true

    log('LLM流式请求: ' + url + ' 消息数: ' + messages.length)

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(body)
    })

    log('LLM流式响应状态: ' + response.status)

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API错误 ${response.status}: ${errorText}`)
    }

    // 读取 SSE 流
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullContent = ''
    let hasToolCalls = false
    let toolCallsData = []

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''  // 保留未完成的行

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('data: [DONE]')) continue

            if (trimmed.startsWith('data:')) {
                const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5)
                try {
                    const chunk = JSON.parse(jsonStr)
                    const choice = chunk.choices?.[0]

                    if (!choice) continue

                    // 检查是否有工具调用
                    if (choice.delta?.tool_calls) {
                        hasToolCalls = true
                        for (const tc of choice.delta.tool_calls) {
                            if (tc.index !== undefined) {
                                if (!toolCallsData[tc.index]) {
                                    toolCallsData[tc.index] = {
                                        id: tc.id || '',
                                        type: tc.type || 'function',
                                        function: { name: '', arguments: '' }
                                    }
                                }
                                if (tc.id) toolCallsData[tc.index].id = tc.id
                                if (tc.function?.name) toolCallsData[tc.index].function.name += tc.function.name
                                if (tc.function?.arguments) toolCallsData[tc.index].function.arguments += tc.function.arguments
                            }
                        }
                    }

                    // 检查文本内容
                    const delta = choice.delta
                    if (delta?.content) {
                        fullContent += delta.content
                        if (onChunk) onChunk(delta.content)
                    }
                } catch (e) {
                    // 解析失败跳过
                }
            }
        }
    }

    // 如果有工具调用，返回特殊格式
    if (hasToolCalls && toolCallsData.length > 0) {
        return {
            content: fullContent || null,
            tool_calls: toolCallsData.filter(Boolean)
        }
    }

    return { content: fullContent }
}

// 发送消息
async function sendMessage(text) {
    // 清除之前的打断标志
    appState.clearInterrupted()

    if (!text) {
        text = chatInput.value.trim()
    }
    if (!text || !config) return
    chatInput.value = ''
    showSubtitle('你: ' + text)

    messages.push({ role: 'user', content: text })

    // 裁剪上下文
    trimMessages()

    try {
        // 插件：用户输入钩子
        if (global.pluginManager) {
            const inputEvent = {
                text,
                messages,
                _stopped: false,
                _defaultPrevented: false,
                source: 'user-input',
                stopPropagation() { this._stopped = true },
                preventDefault() { this._defaultPrevented = true },
                setText(newText) { this.text = newText },
                addContext(key, value) { if (!this._context) this._context = {}; this._context[key] = value },
                getContextAdditions() { return this._context || {} }
            }
            await global.pluginManager.runUserInputHooks(inputEvent)
            if (inputEvent._stopped) return
        }

        // 获取所有工具（MCP + 插件）
        let allTools = []
        if (global.mcpManager && global.mcpManager.isEnabled) {
            const mcpTools = global.mcpManager.getToolsForLLM()
            if (mcpTools && mcpTools.length > 0) {
                allTools.push(...mcpTools)
            }
        }
        if (global.pluginManager) {
            const pluginTools = global.pluginManager.getAllTools()
            if (pluginTools && pluginTools.length > 0) {
                allTools.push(...pluginTools)
            }
        }

        // 始终发送工具（跟原项目一致）
        const shouldSendTools = allTools.length > 0

        // BERT 智能截图判断（在 LLM 调用前）
        let screenshotBase64 = null
        if (screenshotManager) {
            const needScreenshot = await screenshotManager.shouldTakeScreenshot(text)
            if (needScreenshot) {
                screenshotBase64 = await screenshotManager.takeScreenshot()
                if (screenshotBase64) {
                    log('BERT 判断需要截图，已截取，长度: ' + screenshotBase64.length)
                }
            }
        }

        // 构建发送给 API 的消息（带图片）
        let messagesForAPI = buildMessagesWithImage(messages, screenshotBase64)

        // 如果有截图且开了视觉模型，先用视觉模型处理图片
        const useVisionModel = config?.vision?.use_vision_model && config?.vision?.vision_model
        if (screenshotBase64 && useVisionModel) {
            log('使用视觉模型处理图片')
            const visionApiUrl = config.vision.vision_model.api_url + '/chat/completions'
            const visionApiKey = config.vision.vision_model.api_key
            const visionD = await callLLM(messagesForAPI, null, visionApiUrl, visionApiKey)
            const visionReply = visionD.choices?.[0]?.message?.content || ''

            if (visionReply) {
                // 视觉模型的结果作为上下文，让主模型生成桌宠口吻的回复
                messages.push({ role: 'assistant', content: '[图片分析] ' + visionReply })
                messagesForAPI = buildMessagesWithImage(messages, null) // 不再带图片
            }
        }

        // 插件：LLM 请求钩子
        if (global.pluginManager) {
            await global.pluginManager.runLLMRequestHooks({ messages: messagesForAPI, tools: allTools })
        }

        // 调用主 LLM（流式）
        let replyBuffer = ''

        // 重置流式 TTS 处理器
        if (ttsStreamProcessor) ttsStreamProcessor.reset()

        let d
        try {
            d = await callLLMStream(messagesForAPI, shouldSendTools ? allTools : null, (chunk) => {
                replyBuffer += chunk
                // TTS 开启时由 TTS 逐字控制字幕，不显示完整文本
                if (!ttsStreamProcessor) {
                    updateSubtitle(emotionMapper.removeEmotionTags(replyBuffer))
                }

                // 流式 TTS（去掉情绪标签再传入）
                if (ttsStreamProcessor) {
                    ttsStreamProcessor.addStreamingText(emotionMapper.removeEmotionTags(chunk))
                }
            })
        } catch (llmError) {
            // 多模态不支持时，剥离图片重试
            const hasImages = messagesForAPI.some(m =>
                Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
            )
            if (hasImages) {
                log('LLM不支持图片，剥离图片重试')
                messagesForAPI = cleanMessagesForAPI(messages.map(msg => {
                    if (Array.isArray(msg.content)) {
                        return { ...msg, content: msg.content.filter(c => c.type !== 'image_url') }
                    }
                    return msg
                }))
                replyBuffer = ''
                if (ttsStreamProcessor) ttsStreamProcessor.reset()
                d = await callLLMStream(messagesForAPI, shouldSendTools ? allTools : null, (chunk) => {
                    replyBuffer += chunk
                    if (!ttsStreamProcessor) {
                        updateSubtitle(emotionMapper.removeEmotionTags(replyBuffer))
                    }
                    if (ttsStreamProcessor) ttsStreamProcessor.addStreamingText(emotionMapper.removeEmotionTags(chunk))
                })
            } else {
                throw llmError
            }
        }

        // LLM 流结束，刷出 TTS 剩余文本
        if (ttsStreamProcessor) {
            ttsStreamProcessor.finalizeStreamingText()
        }

        // 检查是否有工具调用
        log('LLM流式响应完成')
        let finalText = ''

        // 连续工具调用循环（最多30轮）
        const MAX_TOOL_ITERATIONS = 30
        const MAX_CONSECUTIVE_FAILURES = 3
        let iteration = 0
        let consecutiveFailures = 0

        while (d.tool_calls && d.tool_calls.length > 0 && iteration < MAX_TOOL_ITERATIONS) {
            // 检查用户是否打断
            if (appState.isInterrupted()) {
                log('用户打断，终止工具调用循环')
                appState.clearInterrupted()
                if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                    messages.pop()
                }
                break
            }
            iteration++
            logTool(`工具调用轮次 ${iteration}: ${d.tool_calls.length} 个工具`)

            // 先添加 assistant 消息（含 tool_calls），只加一次
            // 如果 content 为空但有 tool_calls，仍需保留 tool_calls 供后续 tool result 关联
            messages.push({
                role: 'assistant',
                content: d.content || null,
                tool_calls: d.tool_calls
            })

            // 执行所有工具调用
            for (const toolCall of d.tool_calls) {
                const toolName = toolCall.function.name
                const toolArgs = JSON.parse(toolCall.function.arguments || '{}')
                logTool('调用工具: ' + toolName)

                // 执行工具（MCP 优先，然后是插件）
                let toolResult = ''
                try {
                    if (global.mcpManager && global.mcpManager.isEnabled && global.mcpManager.toolRegistry.isMCPTool(toolName)) {
                        logTool('执行 MCP 工具: ' + toolName)
                        const mcpResults = await global.mcpManager.handleToolCalls([toolCall])
                        if (mcpResults.length > 0) {
                            toolResult = mcpResults[0].content
                        }
                        logTool('MCP 工具结果: ' + String(toolResult).substring(0, 100))
                    } else if (global.pluginManager) {
                        logTool('执行插件工具: ' + toolName)
                        toolResult = await global.pluginManager.executeTool(toolName, toolArgs)
                        logTool('工具结果: ' + String(toolResult).substring(0, 100))
                    } else {
                        log('pluginManager 不存在', 'warn')
                    }
                    consecutiveFailures = 0 // 成功则重置计数
                } catch (toolError) {
                    toolResult = `工具执行错误: ${toolError.message}`
                    consecutiveFailures++
                    logTool('工具执行失败: ' + toolError.message)
                    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        log('连续失败 ' + consecutiveFailures + ' 次，终止工具调用循环', 'warn')
                        break
                    }
                }

                // 截图工具特殊处理：提取 base64 用于视觉分析
                if (typeof toolResult === 'object' && toolResult._isScreenshot) {
                    messages.push({
                        role: 'tool',
                        name: toolName,
                        tool_call_id: toolCall.id,
                        content: toolResult.message
                    })
                    finalText = toolResult.message
                    // 将截图注入为 user 消息供 LLM 分析
                    const imageBase64 = toolResult.base64
                    log('截图base64长度: ' + (imageBase64 ? imageBase64.length : 0))
                    if (imageBase64 && imageBase64.length > 0) {
                        messages.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: '当前电脑屏幕内容:' },
                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                            ]
                        })
                        log('截图已添加到消息，供 AI 分析')
                    } else {
                        log('截图数据为空，跳过图片注入', 'warn')
                    }
                } else {
                    messages.push({
                        role: 'tool',
                        name: toolName,
                        tool_call_id: toolCall.id,
                        content: String(toolResult)
                    })
                    finalText = String(toolResult)
                }
            }

            // 再次调用 LLM（流式）
            let replyBuffer = ''

            // 重置流式 TTS 处理器
            if (ttsStreamProcessor) ttsStreamProcessor.reset()

            d = await callLLMStream(messages, shouldSendTools ? allTools : null, (chunk) => {
                replyBuffer += chunk
                // TTS 开启时由 TTS 逐字控制字幕，不显示完整文本
                if (!ttsStreamProcessor) {
                    updateSubtitle(emotionMapper.removeEmotionTags(replyBuffer))
                }

                // 流式 TTS（去掉情绪标签再传入）
                if (ttsStreamProcessor) {
                    ttsStreamProcessor.addStreamingText(emotionMapper.removeEmotionTags(chunk))
                }
            })

            // LLM 流结束，刷出 TTS 剩余文本
            if (ttsStreamProcessor) {
                ttsStreamProcessor.finalizeStreamingText()
            }

            finalText = replyBuffer
            log(`轮次 ${iteration} LLM 响应完成`)
        }

        // 最终回复（无工具调用时 finalText 还是空，需要从 replyBuffer 取）
        if (!finalText && replyBuffer) {
            finalText = replyBuffer
        }
        if (d.tool_calls && d.tool_calls.length > 0) {
            log('达到最大工具调用轮次，停止循环', 'warn')
        }

        // 解析情绪标签并触发表情
        const emotionTags = emotionMapper.parseEmotionTags(finalText)
        log(`情绪标签解析: ${emotionTags.length}个 | 原始文本: ${JSON.stringify(finalText.substring(0, 150))}`)
        if (emotionTags.length > 0) {
            emotionMapper.triggerByEmotion(emotionTags[0].emotion)
            try { _applyEmotionExpression(emotionTags[0].emotion) } catch (e) { log('情绪表情应用失败: ' + e.message, 'warn') }
            finalText = emotionMapper.removeEmotionTags(finalText)
        }

        // 显示最终字幕（仅当有内容时）
        if (finalText) {
            // TTS 开启时由 TTS 逐字控制，不显示完整文本
            if (!ttsStreamProcessor) {
                updateSubtitle(finalText, true)
            }
            // 5秒后自动隐藏字幕
            setTimeout(() => {
                const container = document.getElementById('subtitle-container')
                if (container) container.style.display = 'none'
            }, 5000)
        }
        // 保存助手回复（优先用 finalText，回退到 replyBuffer）
        const assistantContent = finalText || replyBuffer || ''
        if (assistantContent) {
            messages.push({ role: 'assistant', content: assistantContent })
        }

        // 插件：LLM 响应钩子（上下文压缩等）- 先压缩再保存
        if (global.pluginManager) {
            await global.pluginManager.runLLMResponseHooks({ text: finalText })
        }

        // 保存对话历史（在压缩之后，保存压缩后的状态）
        saveConversationHistory()

        if (model) model.motion('Tap')

    } catch (e) {
        showSubtitle('错误: ' + e.message)
    }
}

chatSendBtn.addEventListener('click', () => sendMessage())
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage() })

// 窗口关闭时清理 MCP
window.addEventListener('beforeunload', () => {
    if (global.mcpManager) {
        global.mcpManager.stop()
    }
})

// PTT 按键监听
const pttKey = (config.asr?.ptt_key || 'v').toLowerCase()
let pttActive = false

const isInputFocused = () => {
    const el = document.activeElement
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== pttKey) return
    if (!config.asr?.ptt_enabled) return
    if (e.repeat || pttActive || isInputFocused()) return
    pttActive = true
    asrProcessor.pttStartRecording()
    showSubtitle('录音中...')
})

document.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() !== pttKey || !pttActive) return
    pttActive = false
    if (!config.asr?.ptt_enabled) return
    asrProcessor.pttStopRecording()
})

// 全局快捷键（窗口失焦时也能用）
ipcRenderer.on('ptt-key-down', () => {
    if (!config.asr?.ptt_enabled) return
    if (pttActive) return
    pttActive = true
    asrProcessor.pttStartRecording()
    showSubtitle('录音中...')
})

// 自定义右键菜单
const contextMenu = document.getElementById('custom-context-menu')
let contextMenuTarget = null

document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    contextMenuTarget = e.target

    // 显示菜单
    contextMenu.style.display = 'block'
    contextMenu.style.left = e.clientX + 'px'
    contextMenu.style.top = e.clientY + 'px'

    // 边界检测
    const rect = contextMenu.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
        contextMenu.style.left = (e.clientX - rect.width) + 'px'
    }
    if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = (e.clientY - rect.height) + 'px'
    }
})

document.addEventListener('click', () => {
    contextMenu.style.display = 'none'
})

document.querySelectorAll('.ctx-menu-item').forEach(item => {
    item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'copy') {
            document.execCommand('copy')
        } else if (action === 'paste') {
            navigator.clipboard.readText().then(text => {
                if (contextMenuTarget && contextMenuTarget.tagName === 'INPUT') {
                    contextMenuTarget.value += text
                }
            })
        } else if (action === 'devtools') {
            ipcRenderer.send('open-devtools')
        }
        contextMenu.style.display = 'none'
    })
})

main()
