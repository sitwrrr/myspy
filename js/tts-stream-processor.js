// tts-stream-processor.js - 流式 TTS 处理器
// 接收 LLM 流式文本，按标点分段，逐段合成并播放

class TTSStreamProcessor {
    constructor(config, ttsClient, modelController) {
        this.enabled = config.tts?.enabled || false
        this.ttsClient = ttsClient
        this.modelController = modelController

        // 标点符号集（只在句子结束时分段，减少电音感）
        this.punctuations = ['。', '？', '！', '!', '；', ';', '\n']

        // 待分段的文本缓冲
        this.pendingSegment = ''

        // 文本分段队列
        this.textSegmentQueue = []

        // 音频播放队列
        this.audioQueue = []

        // 状态标记
        this.isProcessing = false
        this.isFinalized = false
        this.abortGeneration = 0
        this.isPlayingSubtitle = false  // 标记 TTS 是否正在播放字幕
        this.ttsActive = false          // TTS 是否已开始播放（用于通知外部停止 updateSubtitle）

        // 处理线程和播放线程
        this._processingTimer = null
        this._playbackTimer = null

        // 启动后台线程
        this._startProcessingThread()
        this._startPlaybackThread()
    }

    // 接收流式文本（LLM 每输出一块就调用一次）
    addStreamingText(text) {
        if (!this.enabled || !text) return

        // 按标点分段
        this.pendingSegment += text
        let processedSegment = ''

        for (let i = 0; i < this.pendingSegment.length; i++) {
            const char = this.pendingSegment[i]
            processedSegment += char

            if (this.punctuations.includes(char) && processedSegment.trim()) {
                this.textSegmentQueue.push(processedSegment)
                processedSegment = ''
            }
        }

        this.pendingSegment = processedSegment
    }

    // LLM 流结束时调用，刷出剩余文本
    finalizeStreamingText() {
        if (!this.enabled) return

        this.isFinalized = true

        // 把剩余的文本也加入队列
        if (this.pendingSegment.trim()) {
            this.textSegmentQueue.push(this.pendingSegment)
            this.pendingSegment = ''
        }
    }

    // 处理线程：从队列取文本，调用 TTS 合成
    _startProcessingThread() {
        this._processingTimer = setInterval(async () => {
            if (this.isProcessing) return
            if (this.textSegmentQueue.length === 0) return

            const segment = this.textSegmentQueue.shift()
            this.isProcessing = true

            try {
                const currentAbort = this.abortGeneration
                // 清理标签后再合成
                const cleanSegment = segment
                    .replace(/\[.*?\]/g, '')
                    .replace(/<.*?>/g, '')
                    .replace(/[（(].*?[）)]/g, '')
                    .replace(/\*.*?\*/g, '')
                    .trim()
                if (!cleanSegment || cleanSegment.length < 2) {
                    this.isProcessing = false
                    return
                }
                const audioBlob = await this.ttsClient.synthesize(cleanSegment)

                // 检查是否被中断
                if (this.abortGeneration !== currentAbort) return

                this.audioQueue.push({
                    blob: audioBlob,
                    text: cleanSegment
                })
            } catch (error) {
                console.error('TTS 合成失败:', error.message)
            } finally {
                this.isProcessing = false
            }
        }, 20)  // 缩短到20ms，加快响应
    }

    // 播放线程：从队列取音频，依次播放
    _startPlaybackThread() {
        this._playbackTimer = setInterval(async () => {
            if (this.audioQueue.length === 0) {
                // 所有音频播放完毕，且没有正在处理的合成任务
                if (!this.ttsClient.isPlaying && !this.isProcessing && this.textSegmentQueue.length === 0) {
                    this.ttsActive = false
                    this._scheduleHideSubtitle()
                }
                return
            }
            if (this.ttsClient.isPlaying) return

            // 清除隐藏定时器（还有新音频要播放）
            if (this._hideTimeout) {
                clearTimeout(this._hideTimeout)
                this._hideTimeout = null
            }

            const audioData = this.audioQueue.shift()
            const audioUrl = URL.createObjectURL(audioData.blob)

            try {
                // 传入文本，让 playAudio 做逐字字幕显示
                this.isPlayingSubtitle = true
                this.ttsActive = true  // 通知外部：TTS 已开始播放，停止 updateSubtitle
                await this.ttsClient.playAudio(audioUrl, this.modelController, audioData.text)
            } finally {
                this.isPlayingSubtitle = false
                URL.revokeObjectURL(audioUrl)
            }
        }, 10)  // 缩短到10ms，减少段间间隙
    }

    // 安排字幕隐藏
    _scheduleHideSubtitle() {
        if (this._hideTimeout) return  // 已经在倒计时了
        this._hideTimeout = setTimeout(() => {
            if (typeof hideSubtitle === 'function') {
                hideSubtitle()
            }
            this._hideTimeout = null
        }, 3000)
    }

    // 停止所有处理
    stop() {
        this.abortGeneration++
        this.textSegmentQueue = []
        this.audioQueue = []
        this.ttsClient.stop()
    }

    // 重置状态
    reset() {
        this.stop()
        this.pendingSegment = ''
        this.isFinalized = false
    }

    // 清理资源
    destroy() {
        if (this._processingTimer) clearInterval(this._processingTimer)
        if (this._playbackTimer) clearInterval(this._playbackTimer)
        this.reset()
    }

    // 检查是否还有内容在处理/播放
    isComplete() {
        return this.textSegmentQueue.length === 0 &&
               this.audioQueue.length === 0 &&
               !this.isProcessing &&
               !this.ttsClient.isPlaying
    }
}

module.exports = { TTSStreamProcessor }
