// tts-client.js - GPT-SoVITS 本地语音合成客户端
class TTSClient {
    constructor(config) {
        this.enabled = config.tts?.enabled || false
        this.url = config.tts?.url || 'http://127.0.0.1:5000'
        this.language = config.tts?.language || 'zh'

        // 音频相关
        this.audioContext = null
        this.analyser = null
        this.dataArray = null
        this.isPlaying = false
        this.currentAudio = null
    }

    // 初始化音频上下文
    initAudio() {
        if (this.audioContext) return
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
        this.analyser = this.audioContext.createAnalyser()
        this.analyser.fftSize = 256
        this.analyser.connect(this.audioContext.destination)
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)
    }

    // 调用 GPT-SoVITS 服务器
    async synthesize(text) {
        const response = await fetch(this.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                text_language: this.language
            })
        })

        if (!response.ok) {
            throw new Error(`TTS 服务器错误: ${response.status}`)
        }

        return await response.blob()
    }

    // 文字转语音并播放（带口型同步），返回 Promise 在播放结束后 resolve
    speak(text, modelController) {
        if (!this.enabled) return Promise.resolve()

        // 清理文本
        let cleanText = text
            .replace(/\[.*?\]/g, '')
            .replace(/<.*?>/g, '')
            .replace(/[（(].*?[）)]/g, '')
            .replace(/\*.*?\*/g, '')
            .trim()

        if (!cleanText || cleanText.length < 2) return Promise.resolve()

        console.log('TTS:', cleanText.substring(0, 30) + '...')
        this.stop()

        return this.synthesize(cleanText)
            .then(audioBlob => {
                const audioUrl = URL.createObjectURL(audioBlob)
                return this.playAudio(audioUrl, modelController).finally(() => {
                    URL.revokeObjectURL(audioUrl)
                })
            })
            .catch(error => {
                console.error('TTS 失败:', error.message)
            })
    }

    // 播放音频 + 口型同步 + 字幕逐字显示
    async playAudio(audioUrl, modelController, text = '') {
        return new Promise((resolve) => {
            this.initAudio()

            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume()
            }

            const audio = new Audio(audioUrl)
            this.currentAudio = audio

            let source
            let gainNode
            try {
                source = this.audioContext.createMediaElementSource(audio)
                gainNode = this.audioContext.createGain()
                source.connect(gainNode)
                gainNode.connect(this.analyser)
            } catch (e) {}

            this.isPlaying = true

            // 字幕逐字显示相关
            let charDisplayIndex = 0
            const segmentLength = text.length

            const updateMouth = () => {
                if (!this.isPlaying) {
                    if (modelController) modelController.setMouthOpenY(0)
                    return
                }

                this.analyser.getByteFrequencyData(this.dataArray)
                const sampleCount = this.dataArray.length / 2
                let sum = 0
                for (let i = 0; i < sampleCount; i++) {
                    sum += this.dataArray[i]
                }
                const average = sum / sampleCount
                const mouthValue = Math.pow(average / 256, 0.8) * 2.5

                if (modelController) modelController.setMouthOpenY(mouthValue)
                requestAnimationFrame(updateMouth)
            }

            audio.addEventListener('play', () => {
                updateMouth()

                // 淡入效果（30ms，更平滑）
                if (gainNode) {
                    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime)
                    gainNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.03)
                }

                // 淡出效果（结束前80ms）
                audio.addEventListener('timeupdate', function onTimeUpdate() {
                    if (!audio.duration) return
                    const remaining = audio.duration - audio.currentTime
                    if (remaining < 0.08 && gainNode) {
                        gainNode.gain.linearRampToValueAtTime(0, audio.currentTime + remaining)
                        audio.removeEventListener('timeupdate', onTimeUpdate)
                    }
                })

                // 启动字幕动画
                if (segmentLength > 0) {
                    const audioDuration = audio.duration * 1000
                    const charInterval = Math.max(30, Math.min(200, audioDuration / segmentLength))
                    this._textAnimInterval = setInterval(() => {
                        if (!this.isPlaying || charDisplayIndex >= segmentLength) {
                            clearInterval(this._textAnimInterval)
                            return
                        }
                        charDisplayIndex++
                        const displayText = text.substring(0, charDisplayIndex)
                        if (typeof showSubtitle === 'function') {
                            showSubtitle(displayText)
                        }
                    }, charInterval)
                }
            })

            audio.addEventListener('ended', () => {
                this.isPlaying = false
                this.currentAudio = null
                if (modelController) modelController.setMouthOpenY(0)
                if (this._textAnimInterval) {
                    clearInterval(this._textAnimInterval)
                    this._textAnimInterval = null
                }
                resolve()
            })

            audio.addEventListener('error', () => {
                this.isPlaying = false
                this.currentAudio = null
                if (modelController) modelController.setMouthOpenY(0)
                if (this._textAnimInterval) {
                    clearInterval(this._textAnimInterval)
                    this._textAnimInterval = null
                }
                resolve()
            })

            audio.play().catch(() => {
                this.isPlaying = false
                this.currentAudio = null
                resolve()
            })
        })
    }

    // 停止当前播放
    stop() {
        this.isPlaying = false
        if (this.currentAudio) {
            this.currentAudio.pause()
            this.currentAudio = null
        }
    }

    // 语音打断（供 ASR 调用）
    interrupt() {
        this.stop()
    }
}

module.exports = { TTSClient }
