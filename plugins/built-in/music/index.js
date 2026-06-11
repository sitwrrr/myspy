const { Plugin } = require('../../../js/core/plugin-base.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class MusicPlugin extends Plugin {

    async onInit() {
        this._isPlaying = false
        this._mouthInterval = null

        // 读取配置文件中的快捷键
        const cfg = this.context.getPluginFileConfig()
        this._playKey = cfg.play_key || 'Ctrl+Alt+P'
        this._nextKey = cfg.next_key || 'Ctrl+Alt+Right'
        this._prevKey = cfg.prev_key || 'Ctrl+Alt+Left'
    }

    getTools() {
        return [
            {
                type: 'function',
                function: {
                    name: 'play_music',
                    description: '播放/暂停音乐',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'next_track',
                    description: '切换下一首歌曲',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'prev_track',
                    description: '切换上一首歌曲',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            }
        ]
    }

    async executeTool(name, params) {
        switch (name) {
            case 'play_music': return await this._playPause()
            case 'next_track': return await this._nextTrack()
            case 'prev_track': return await this._prevTrack()
            default: throw new Error(`[music] 不支持的工具: ${name}`)
        }
    }

    async _pressKey(key) {
        return new Promise((resolve, reject) => {
            // 解析快捷键字符串
            const keyStr = key === 'playpause' ? this._playKey :
                          key === 'nexttrack' ? this._nextKey :
                          this._prevKey

            const parts = keyStr.split('+').map(s => s.trim().toLowerCase())
            const hasCtrl = parts.includes('ctrl')
            const hasAlt = parts.includes('alt')
            const hasShift = parts.includes('shift')

            // 获取按键虚拟码
            const keyName = parts.find(p => !['ctrl', 'alt', 'shift'].includes(p))
            const keyCodes = {
                'p': 0x50, 'left': 0x25, 'right': 0x27, 'up': 0x26, 'down': 0x28,
                'space': 0x20, 'enter': 0x0D, 'esc': 0x1B
            }
            const vk = keyCodes[keyName]
            if (!vk) return reject(new Error('未知按键: ' + keyName))

            const script = `
import ctypes
user32 = ctypes.windll.user32
VK_CONTROL = 0x11
VK_MENU = 0x12
VK_SHIFT = 0x10

${hasCtrl ? 'user32.keybd_event(VK_CONTROL, 0, 0, 0)' : ''}
${hasAlt ? 'user32.keybd_event(VK_MENU, 0, 0, 0)' : ''}
${hasShift ? 'user32.keybd_event(VK_SHIFT, 0, 0, 0)' : ''}
user32.keybd_event(${vk}, 0, 0, 0)
user32.keybd_event(${vk}, 0, 2, 0)
${hasShift ? 'user32.keybd_event(VK_SHIFT, 0, 2, 0)' : ''}
${hasAlt ? 'user32.keybd_event(VK_MENU, 0, 2, 0)' : ''}
${hasCtrl ? 'user32.keybd_event(VK_CONTROL, 0, 2, 0)' : ''}
print('OK')
`
            const tempPath = path.join(__dirname, 'temp_key.py')
            fs.writeFileSync(tempPath, script)

            const pythonPath = path.join(__dirname, '..', '..', '..', 'venv', 'Scripts', 'python.exe');
            exec(
                `"${pythonPath}" "${tempPath}"`,
                { shell: true, timeout: 5000 },
                (err, stdout) => {
                    try { fs.unlinkSync(tempPath) } catch (e) {}
                    if (err) reject(err)
                    else resolve(stdout.trim())
                }
            )
        })
    }

    async _playPause() {
        await this._pressKey('playpause')
        this._isPlaying = !this._isPlaying

        if (global.modelController) {
            if (this._isPlaying) {
                this._startMouthSync()
            } else {
                this._stopMouthSync()
            }
        }

        return this._isPlaying ? '开始播放音乐' : '已暂停音乐'
    }

    async _nextTrack() {
        await this._pressKey('nexttrack')
        this._isPlaying = true
        if (global.modelController) this._startMouthSync()
        return '切换到下一首'
    }

    async _prevTrack() {
        await this._pressKey('prevtrack')
        this._isPlaying = true
        if (global.modelController) this._startMouthSync()
        return '切换到上一首'
    }

    _startMouthSync() {
        if (this._mouthInterval) return
        let open = false
        this._mouthInterval = setInterval(() => {
            if (!this._isPlaying || !global.modelController) {
                this._stopMouthSync()
                return
            }
            open = !open
            global.modelController.setMouthOpenY(open ? 1.5 : 0)
        }, 300)
    }

    _stopMouthSync() {
        if (this._mouthInterval) {
            clearInterval(this._mouthInterval)
            this._mouthInterval = null
        }
        if (global.modelController) {
            global.modelController.setMouthOpenY(0)
        }
    }

    async onDestroy() {
        this._stopMouthSync()
    }
}

module.exports = MusicPlugin
