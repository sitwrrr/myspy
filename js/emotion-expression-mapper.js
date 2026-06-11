// emotion-expression-mapper.js - 情绪表情映射器
const fs = require('fs');
const path = require('path');

class EmotionExpressionMapper {
    constructor() {
        this.model = null;
        this.expressionConfig = null;
        this.allCharacterConfigs = null;
        this.currentCharacter = null;
        this.defaultExpression = '表情1';
        this.emotions = ['开心', '生气', '难过', '惊讶', '害羞', '俏皮'];
    }

    init(model) {
        this.model = model;
        this.loadExpressionConfig();
    }

    loadExpressionConfig() {
        const configPath = path.join(__dirname, '..', 'emotion_expressions.json');
        try {
            if (fs.existsSync(configPath)) {
                this.allCharacterConfigs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                this.currentCharacter = this._getCharacterName();
                if (this.currentCharacter && this.allCharacterConfigs[this.currentCharacter]) {
                    this.expressionConfig = this.allCharacterConfigs[this.currentCharacter].emotion_expressions;
                    console.log(`表情配置已加载: ${this.currentCharacter}`, Object.keys(this.expressionConfig));
                }
            }
        } catch (e) {
            console.error('加载表情配置失败:', e.message);
        }

        if (!this.expressionConfig) {
            this.expressionConfig = this._createDefaultConfig();
        }
    }

    _getCharacterName() {
        try {
            if (this.model && this.model.internalModel && this.model.internalModel.settings) {
                const modelPath = this.model.internalModel.settings.url || '';
                const match = modelPath.match(/2D\/([^\/]+)\//);
                if (match) return match[1];
            }
        } catch (e) {}
        return 'default';
    }

    _createDefaultConfig() {
        const config = {
            '开心': [], '生气': [], '难过': [], '惊讶': [], '害羞': [], '俏皮': []
        };

        // 动态扫描 expressions 目录
        try {
            if (this.model && this.model.internalModel && this.model.internalModel.settings) {
                const modelPath = this.model.internalModel.settings.url || '';
                const modelDir = path.dirname(modelPath);
                const exprDir = path.join(modelDir, 'expressions');
                if (fs.existsSync(exprDir)) {
                    const files = fs.readdirSync(exprDir).filter(f => f.endsWith('.exp3.json'));
                    files.forEach(f => {
                        const name = path.basename(f, '.exp3.json');
                        config[name] = ['expressions/' + f];
                    });
                }
            }
        } catch (e) {
            console.warn('动态扫描表情目录失败:', e.message);
        }

        return config;
    }

    // 解析文本中的情绪标签
    parseEmotionTags(text) {
        const pattern = /<([^>]+)>/g;
        const tags = [];
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (this.emotions.includes(match[1])) {
                tags.push({ emotion: match[1], index: match.index, full: match[0] });
            }
        }
        return tags;
    }

    // 从文本中移除情绪标签
    removeEmotionTags(text) {
        return text.replace(/<(开心|生气|难过|惊讶|害羞|俏皮)>/g, '');
    }

    // 根据情绪触发表情
    triggerByEmotion(emotion) {
        if (!this.model) return false;

        if (this.expressionConfig && this.expressionConfig[emotion] && this.expressionConfig[emotion].length > 0) {
            const files = this.expressionConfig[emotion];
            const file = files[Math.floor(Math.random() * files.length)];
            const name = path.basename(file, '.exp3.json');
            return this._playExpression(name);
        }

        return this._playDefault();
    }

    // 播放指定表情
    _playExpression(expressionName) {
        if (!this.model) return false;
        try {
            this.model.expression(expressionName);
            console.log(`触发表情: ${expressionName}`);
            return true;
        } catch (e) {
            console.error('播放表情失败:', e.message);
            return false;
        }
    }

    // 播放默认表情（多级回退）
    _playDefault() {
        if (this._playExpression(this.defaultExpression)) return true;
        if (this._playExpression('表情1')) return true;
        if (this._playExpression('默认表情')) return true;
        if (this.expressionConfig) {
            for (const key of Object.keys(this.expressionConfig)) {
                if (this.expressionConfig[key].length > 0) {
                    const file = this.expressionConfig[key][0];
                    const name = path.basename(file, '.exp3.json');
                    if (this._playExpression(name)) return true;
                }
            }
        }
        return false;
    }

    // 解析文本中的情绪标签（位置感知，用于 TTS 同步）
    parseEmotionTagsWithPosition(text) {
        const pattern = /<([^>]+)>/g;
        const tags = [];
        let match;
        while ((match = pattern.exec(text)) !== null) {
            tags.push({
                emotion: match[1],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                fullTag: match[0]
            });
        }
        return tags;
    }

    // 按 TTS 播放位置触发表情
    triggerEmotionByTextPosition(text, charIndex) {
        if (!this.model) return false;
        const tags = this.parseEmotionTagsWithPosition(text);
        for (const tag of tags) {
            if (tag.startIndex <= charIndex && tag.endIndex > charIndex) {
                return this.triggerByEmotion(tag.emotion);
            }
        }
        return false;
    }

    // 清理文本中的情绪标记，准备 TTS 文本
    prepareTextForTTS(text) {
        return this.removeEmotionTags(text);
    }

    // 播放动作
    playMotion(index) {
        if (!this.model) return false;
        try {
            this.model.motion('Tap', index);
            return true;
        } catch (e) {
            console.error('播放动作失败:', e.message);
            return false;
        }
    }

    // 获取当前情绪绑定配置
    getEmotionBindings() {
        return this.expressionConfig || {};
    }

    // 热重载配置
    reloadConfig() {
        this.loadExpressionConfig();
    }
}

module.exports = { EmotionExpressionMapper };
