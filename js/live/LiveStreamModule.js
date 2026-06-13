// js/live/LiveStreamModule.js
// HTTP 轮询实时接收 B站弹幕（短号自动解析 + Set 去重）

let logToTerminal;
try { logToTerminal = require('../api-utils').logToTerminal; } catch (e) {}

class LiveStreamModule {
    constructor(config) {
        this.roomId = config.roomId || 30230160;
        this.checkInterval = config.checkInterval || 3000;
        this.maxMessages = config.maxMessages || 50;
        this.onNewMessage = config.onNewMessage || null;

        this.isRunning = false;
        this.checkTimer = null;
        this.messageCache = [];
        this._seenIds = new Set();
        this._realRoomId = null;
    }

    start() {
        if (this.isRunning) return false;
        this.isRunning = true;
        this._fetchBarrage();
        this.checkTimer = setInterval(() => this._fetchBarrage(), this.checkInterval);
        if (logToTerminal) logToTerminal('info', `[B站弹幕] 已启动，监听房间: ${this.roomId}，间隔: ${this.checkInterval}ms`);
        return true;
    }

    stop() {
        if (!this.isRunning) return false;
        if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
        this.isRunning = false;
        if (logToTerminal) logToTerminal('info', '[B站弹幕] 已停止');
        return true;
    }

    async _resolveRoomId() {
        try {
            const resp = await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${this.roomId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const data = await resp.json();
            if (data.code === 0 && data.data && data.data.room_id) {
                this._realRoomId = data.data.room_id;
                if (logToTerminal) logToTerminal('info', `[B站弹幕] 房间号 ${this.roomId} -> 真实房间号 ${this._realRoomId}`);
                return;
            }
        } catch (e) {}
        this._realRoomId = this.roomId;
    }

    async _fetchBarrage() {
        try {
            if (!this._realRoomId) await this._resolveRoomId();
            const roomId = this._realRoomId || this.roomId;
            const url = `https://api.live.bilibili.com/ajax/msg?roomid=${roomId}`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': `https://live.bilibili.com/${roomId}`
                }
            });

            if (!response.ok) return;
            const data = await response.json();
            if (!data || !data.data) return;

            const allMessages = [
                ...(data.data.admin || []),
                ...(data.data.room || [])
            ];

            for (const msg of allMessages) {
                const idStr = msg.id_str || '';
                if (idStr && this._seenIds.has(idStr)) continue;

                const nickname = msg.nickname || '未知用户';
                const text = msg.text || '';
                if (!text.trim()) continue;

                if (idStr) this._seenIds.add(idStr);

                this.messageCache.push({ nickname, text, timestamp: Date.now(), id: idStr });
                if (this.messageCache.length > this.maxMessages) this.messageCache.shift();

                if (this.onNewMessage) {
                    this.onNewMessage({ nickname, text, id: idStr });
                }
            }

            // 防止内存泄漏：保留最近 500 条 ID
            if (this._seenIds.size > 500) {
                const arr = Array.from(this._seenIds);
                this._seenIds = new Set(arr.slice(-300));
            }
        } catch (e) {
            if (logToTerminal) logToTerminal('error', `[B站弹幕] 获取弹幕失败: ${e.message}`);
        }
    }

    setRoomId(roomId) {
        if (!roomId) return false;
        this.roomId = roomId;
        this._realRoomId = null;
        this._seenIds.clear();
        if (this.isRunning) { this.stop(); this.start(); }
        return true;
    }

    getMessages() { return [...this.messageCache]; }
    clearMessages() { this.messageCache = []; }

    getStatus() {
        return {
            isRunning: this.isRunning,
            roomId: this.roomId,
            checkInterval: this.checkInterval,
            messageCount: this.messageCache.length
        };
    }
}

module.exports = { LiveStreamModule };
