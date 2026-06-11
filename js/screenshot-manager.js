// screenshot-manager.js - 智能截图管理器（BERT 预判）
const { ipcRenderer } = require('electron');

class ScreenshotManager {
    constructor(config) {
        this.enabled = config?.vision?.auto_screenshot || false;
        this.bertEnabled = config?.bert?.enabled || false;
        this.bertUrl = config?.bert?.url || 'http://127.0.0.1:6007/classify';
    }

    /**
     * 判断是否需要截图
     * @param {string} text - 用户输入文本
     * @returns {Promise<boolean>}
     */
    async shouldTakeScreenshot(text) {
        if (!this.enabled) return false;
        if (!this.bertEnabled) return false;
        if (!text || text.trim().length === 0) return false;

        try {
            const response = await fetch(this.bertUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                console.error(`BERT 请求失败: ${response.status}`);
                return false;
            }

            const data = await response.json();
            const needVision = data["Vision"] === "是";
            if (needVision) console.log('BERT 判断：需要截图');
            return needVision;
        } catch (e) {
            console.error('BERT 分类错误:', e.message);
            return false;
        }
    }

    /**
     * 执行截图
     * @returns {Promise<string|null>} base64 图片数据
     */
    async takeScreenshot() {
        try {
            const base64 = await ipcRenderer.invoke('take-screenshot');
            return base64 || null;
        } catch (e) {
            console.error('截图失败:', e.message);
            return null;
        }
    }
}

module.exports = { ScreenshotManager };
