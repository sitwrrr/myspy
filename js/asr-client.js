// ASR 客户端 - 基于原项目逻辑
const { ipcRenderer } = require('electron')

class ASRProcessor {
    constructor(config) {
        this.config = config || {}

        // ASR 服务器地址
        const asrConfig = this.config.asr || {}
        this.vadUrl = asrConfig.vad_url || 'ws://127.0.0.1:1000/v1/ws/vad'
        this.asrUrl = asrConfig.asr_url || 'http://127.0.0.1:1000/v1/upload_audio'

        // 功能开关
        this.enabled = asrConfig.enabled !== false

        // 语音打断
        this.voiceBargeInEnabled = asrConfig.voice_barge_in || false

        // 状态
        this.isProcessingAudio = false
        this.asrLocked = false
        this.pttModeEnabled = asrConfig.ptt_enabled || false

        // 音频参数
        this.audioContext = null
        this.mediaStream = null
        this.ws = null
        this.SAMPLE_RATE = 16000
        this.WINDOW_SIZE = 512
        this.retryCount = 0
        this.MAX_RETRIES = 5

        // 录音
        this.isRecording = false
        this.continuousBuffer = []
        this.recordingStartIndex = 0
        this.PRE_RECORD_TIME = 1
        this.PRE_RECORD_SAMPLES = this.SAMPLE_RATE * this.PRE_RECORD_TIME

        // 静音检测
        this.SILENCE_THRESHOLD = 500
        this.silenceTimeout = null

        // PTT 最大录音时长（毫秒）
        this.pttMaxTimeout = (asrConfig.ptt_max_timeout || 10) * 1000

        // TTS 处理器引用（用于语音打断）
        this.ttsProcessor = null
        this.hasInterruptedThisSession = false

        // 回调
        this.onResult = null

        // 初始化
        if (this.enabled) {
            this.setupAudioSystem()
        }
    }

    // 设置 TTS 处理器引用
    setTTSProcessor(ttsProcessor) {
        this.ttsProcessor = ttsProcessor
    }

    // 日志
    log(msg) {
        console.log('[ASR] ' + msg)
        ipcRenderer.send('log-message', { level: 'info', message: msg, timestamp: Date.now() })
    }

    // 初始化音频系统
    async setupAudioSystem() {
        try {
            await this.setupWebSocket()
        } catch (error) {
            this.log('音频系统设置错误: ' + error.message)
        }
    }

    // 设置 WebSocket 连接
    async setupWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close()
        }

        this.ws = new WebSocket(this.vadUrl)

        this.ws.onopen = () => {
            this.log('VAD 已连接')
            this.retryCount = 0
        }

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data)
            const isSpeaking = data.is_speech

            if (!this.voiceBargeInEnabled) {
                if (this.isProcessingAudio || this.asrLocked) return
            }

            if (isSpeaking) {
                this.handleSpeech()
            } else {
                this.handleSilence()
            }
        }

        this.ws.onclose = () => {
            if (this.retryCount < this.MAX_RETRIES) {
                this.retryCount++
                setTimeout(() => this.setupWebSocket(), 1000)
            }
        }

        this.ws.onerror = (error) => {
            // 错误时不打印，等 onclose 重试
        }
    }

    // 处理语音
    handleSpeech() {
        if (this.pttModeEnabled) return

        if (!this.voiceBargeInEnabled) {
            if (this.isProcessingAudio || this.asrLocked) return
        } else {
            if (this.ttsProcessor && !this.hasInterruptedThisSession) {
                this.ttsProcessor.interrupt()
                this.hasInterruptedThisSession = true
                if (this.asrLocked) {
                    this.asrLocked = false
                }
            }
            if (this.asrLocked) return
        }

        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout)
            this.silenceTimeout = null
        }

        if (!this.isRecording) {
            this.isRecording = true
            this.recordingStartIndex = this.continuousBuffer.length
        }
    }

    // 处理静音
    handleSilence() {
        if (this.pttModeEnabled) return

        if (!this.voiceBargeInEnabled) {
            if (this.isProcessingAudio || this.asrLocked) return
        } else {
            if (this.asrLocked) return
        }

        if (this.isRecording) {
            if (!this.silenceTimeout) {
                this.silenceTimeout = setTimeout(() => {
                    this.finishRecording()
                    this.silenceTimeout = null
                }, this.SILENCE_THRESHOLD)
            }
        }
    }

    // 开始录音
    async startRecording() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: this.SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            })

            this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE })
            const microphone = this.audioContext.createMediaStreamSource(this.mediaStream)
            const scriptNode = this.audioContext.createScriptProcessor(this.WINDOW_SIZE, 1, 1)

            microphone.connect(scriptNode)
            scriptNode.connect(this.audioContext.destination)

            let lastSendTime = 0
            const MIN_SEND_INTERVAL = 1

            scriptNode.onaudioprocess = (e) => {
                if (!this.voiceBargeInEnabled) {
                    if (this.isProcessingAudio || this.asrLocked) return
                }

                const currentTime = Date.now()
                const audioData = e.inputBuffer.getChannelData(0)

                this.continuousBuffer.push(...Array.from(audioData))

                if (this.continuousBuffer.length > this.SAMPLE_RATE * 30) {
                    const excessSamples = this.continuousBuffer.length - this.SAMPLE_RATE * 30
                    this.continuousBuffer = this.continuousBuffer.slice(excessSamples)
                    if (this.isRecording) {
                        this.recordingStartIndex = Math.max(0, this.recordingStartIndex - excessSamples)
                    }
                }

                if (this.ws && this.ws.readyState === WebSocket.OPEN &&
                    currentTime - lastSendTime >= MIN_SEND_INTERVAL) {
                    this.ws.send(audioData)
                    lastSendTime = currentTime
                }
            }

            this.log('音频处理已启动')
        } catch (err) {
            this.log('启动音频错误: ' + err.message)
        }
    }

    // 停止录音
    stopRecording() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop())
        }
        if (this.ws) {
            this.ws.close()
        }
        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout)
        }
    }

    // 完成录音
    async finishRecording() {
        if (!this.isRecording || this.asrLocked) return
        this.isRecording = false

        this.asrLocked = true
        this.hasInterruptedThisSession = false

        const recordingEndIndex = this.continuousBuffer.length
        const actualStartIndex = Math.max(0, this.recordingStartIndex - this.PRE_RECORD_SAMPLES)
        const recordedSamples = this.continuousBuffer.slice(actualStartIndex, recordingEndIndex)

        if (recordedSamples.length > this.SAMPLE_RATE * 0.5) {
            const wavBlob = this.float32ToWav(new Float32Array(recordedSamples))
            await this.processRecording(wavBlob)
        } else {
            this.asrLocked = false
        }

        this.continuousBuffer = this.continuousBuffer.slice(-this.PRE_RECORD_SAMPLES)
    }

    // Float32 转 WAV
    float32ToWav(samples) {
        const buffer = new ArrayBuffer(44 + samples.length * 2)
        const view = new DataView(buffer)

        this.writeString(view, 0, 'RIFF')
        view.setUint32(4, 36 + samples.length * 2, true)
        this.writeString(view, 8, 'WAVE')
        this.writeString(view, 12, 'fmt ')
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, 1, true)
        view.setUint32(24, this.SAMPLE_RATE, true)
        view.setUint32(28, this.SAMPLE_RATE * 2, true)
        view.setUint16(32, 2, true)
        view.setUint16(34, 16, true)
        this.writeString(view, 36, 'data')
        view.setUint32(40, samples.length * 2, true)

        this.floatTo16BitPCM(view, 44, samples)

        return new Blob([buffer], { type: 'audio/wav' })
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i))
        }
    }

    floatTo16BitPCM(view, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]))
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
        }
    }

    // 发送到 ASR
    async processRecording(audioBlob) {
        const formData = new FormData()
        formData.append('file', audioBlob, 'recording.wav')

        try {
            const response = await fetch(this.asrUrl, {
                method: 'POST',
                body: formData
            })

            if (!response.ok) {
                this.log('ASR 请求失败: ' + response.status)
                this.asrLocked = false
                return null
            }

            const result = await response.json()
            const recognizedText = result.text

            if (recognizedText) {
                this.log('识别结果: ' + recognizedText)

                if (this.onResult) {
                    this.onResult(recognizedText)
                }

                this.asrLocked = false
                return recognizedText
            } else {
                this.log('ASR 识别失败: ' + (result.message || '未知错误'))
                this.asrLocked = false
                return null
            }
        } catch (error) {
            this.log('处理录音失败: ' + error.message)
            this.asrLocked = false
            return null
        }
    }

    // 暂停录音
    pauseRecording() {
        if (!this.voiceBargeInEnabled) {
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.enabled = false)
            }
            this.isProcessingAudio = true
        }
    }

    // 恢复录音
    resumeRecording() {
        if (!this.voiceBargeInEnabled) {
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.enabled = true)
            }
            this.isProcessingAudio = false
        }
        this.asrLocked = false
    }

    // 设置识别回调
    setOnSpeechRecognized(callback) {
        this.onResult = callback
    }

    // PTT：按下触发
    pttStartRecording() {
        if (this.isRecording) return
        if (this.ttsProcessor) {
            this.ttsProcessor.interrupt()
        }
        this.asrLocked = false
        this.hasInterruptedThisSession = false
        this.isRecording = true
        this.recordingStartIndex = this.continuousBuffer.length
        this.log('PTT: 开始录音')

        // 最大录音时长（窗口失焦时松V的兜底）
        if (this.pttMaxTimer) clearTimeout(this.pttMaxTimer)
        this.pttMaxTimer = setTimeout(() => {
            if (this.isRecording) {
                this.log('PTT: 录音超时，自动停止')
                this.pttStopRecording()
            }
        }, this.pttMaxTimeout)
    }

    // PTT：松开触发
    pttStopRecording() {
        if (!this.isRecording) return
        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout)
            this.silenceTimeout = null
        }
        this.log('PTT: 停止录音，开始识别')
        this.finishRecording()
    }

    // 动态切换语音打断
    setVoiceBargeIn(enabled) {
        this.voiceBargeInEnabled = enabled
    }

    // 获取语音打断状态
    getVoiceBargeInStatus() {
        return {
            enabled: this.voiceBargeInEnabled,
            isRecording: this.isRecording,
            asrLocked: this.asrLocked,
            isProcessingAudio: this.isProcessingAudio
        }
    }
}

module.exports = { ASRProcessor }
