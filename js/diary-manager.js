// DiaryManager.js - AI日记管理模块
const fs = require('fs');
const path = require('path');

class DiaryManager {
    constructor(config) {
        this.config = config;
        this.aiDiaryEnabled = config?.diary?.enabled ?? false;
        this.aiDiaryIdleTime = config?.diary?.idle_time ?? 20000;
        this.aiDiaryFile = config?.diary?.diary_file ?? 'AI记录室/AI日记.txt';
        this.aiDiaryPrompt = config?.diary?.prompt ?? '';
        this.lastInteractionTime = Date.now();
        this.diaryTimer = null;
    }

    // 启动AI日记定时器
    startTimer() {
        if (this.diaryTimer) clearTimeout(this.diaryTimer);
        this.diaryTimer = setTimeout(() => {
            this.checkAndWriteDiary();
        }, this.aiDiaryIdleTime);
    }

    // 重置日记定时器（用户交互时调用）
    resetTimer() {
        this.lastInteractionTime = Date.now();
        if (this.aiDiaryEnabled) this.startTimer();
    }

    // 检查并写入AI日记
    async checkAndWriteDiary() {
        try {
            // 检查时间阈值
            const timeSinceLastInteraction = Date.now() - this.lastInteractionTime;
            if (timeSinceLastInteraction < this.aiDiaryIdleTime) return;

            // 检查记忆库是否存在
            const memoryPath = path.join(__dirname, '..', 'AI记录室', '记忆库.txt');
            if (!fs.existsSync(memoryPath)) return;

            const memoryContent = fs.readFileSync(memoryPath, 'utf8');
            if (!memoryContent.includes('交互')) return;

            // 检查今天是否已写日记
            const diaryPath = path.join(__dirname, '..', this.aiDiaryFile);
            const today = new Date();
            const todayStr = `${today.getFullYear()}年${String(today.getMonth() + 1).padStart(2, '0')}月${String(today.getDate()).padStart(2, '0')}日`;

            if (fs.existsSync(diaryPath)) {
                const diaryContent = fs.readFileSync(diaryPath, 'utf8');
                if (diaryContent.includes(todayStr)) return;
            }

            // 提取今天的交互记录并生成日记
            const todayInteractions = this.extractTodayInteractions(memoryContent, todayStr);
            if (!todayInteractions) return;

            await this.generateDiary(todayInteractions, todayStr, diaryPath);
        } catch (error) {
            console.error('检查AI日记失败:', error);
        }
    }

    // 提取今天的交互记录
    extractTodayInteractions(memoryContent, dateStr) {
        const lines = memoryContent.split('\n');
        let todaySection = '';
        let inTodaySection = false;

        for (const line of lines) {
            if (line.includes(`[${dateStr}]`)) {
                inTodaySection = true;
                continue;
            }
            if (inTodaySection) {
                if (line.startsWith('------------------------------------')) break;
                todaySection += line + '\n';
            }
        }
        return todaySection.trim() || null;
    }

    // 生成AI日记
    async generateDiary(todayInteractions, dateStr, diaryPath) {
        try {
            const diaryPrompt = `${this.aiDiaryPrompt}\n\n今天的对话记录：\n${todayInteractions}\n\n请写一篇日记：`;

            // 直接调用 LLM API
            const url = this.config.llm.api_url + '/chat/completions';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.llm.api_key}`
                },
                body: JSON.stringify({
                    model: this.config.llm.model,
                    messages: [{ role: 'user', content: diaryPrompt }],
                    stream: false
                })
            });

            if (!response.ok) throw new Error(`API请求失败: ${response.status}`);

            const data = await response.json();
            const diaryContent = data.choices?.[0]?.message?.content || '';
            if (!diaryContent) return;

            // 保存日记
            const diaryDir = path.dirname(diaryPath);
            if (!fs.existsSync(diaryDir)) fs.mkdirSync(diaryDir, { recursive: true });

            const diaryEntry = `------------------------------------\n[${dateStr}] AI日记\n\n${diaryContent}\n\n`;
            fs.appendFileSync(diaryPath, diaryEntry, 'utf8');
            console.log('AI日记已保存');
        } catch (error) {
            console.error('生成AI日记失败:', error);
        }
    }
}

module.exports = { DiaryManager };
