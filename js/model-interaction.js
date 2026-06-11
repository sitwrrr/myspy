// model-interaction.js - 模型交互控制
const { ipcRenderer } = require('electron')

class ModelInteractionController {
    constructor() {
        this.model = null
        this.app = null
        this.isDragging = false
        this.dragOffset = { x: 0, y: 0 }
    }

    init(model, app) {
        this.model = model
        this.app = app
        this.setupDrag()
        this.setupClick()
        this.setupZoom()
    }

    // 拖动模型
    setupDrag() {
        const canvas = document.getElementById('canvas')
        let startX, startY, startModelX, startModelY

        canvas.addEventListener('mousedown', (e) => {
            // 检查点击位置是否在模型附近
            const modelCenterX = this.model.x
            const modelCenterY = this.model.y
            const modelW = this.model.width / 2
            const modelH = this.model.height / 2

            if (Math.abs(e.clientX - modelCenterX) < modelW &&
                Math.abs(e.clientY - modelCenterY) < modelH) {
                this.isDragging = true
                startX = e.clientX
                startY = e.clientY
                startModelX = this.model.x
                startModelY = this.model.y
                e.preventDefault()
            }
        })

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - startX
                const dy = e.clientY - startY
                this.model.x = startModelX + dx
                this.model.y = startModelY + dy
            }
        })

        window.addEventListener('mouseup', () => {
            this.isDragging = false
        })
    }

    // 点击模型触发动作
    setupClick() {
        const canvas = document.getElementById('canvas')
        canvas.addEventListener('click', (e) => {
            const modelCenterX = this.model.x
            const modelCenterY = this.model.y
            const modelW = this.model.width / 2
            const modelH = this.model.height / 2

            if (Math.abs(e.clientX - modelCenterX) < modelW &&
                Math.abs(e.clientY - modelCenterY) < modelH) {
                try {
                    this.model.motion('Tap')
                    this.model.expression()
                } catch (err) {
                    console.log('动作触发失败:', err)
                }
            }
        })
    }

    // 滚轮缩放
    setupZoom() {
        const canvas = document.getElementById('canvas')
        canvas.addEventListener('wheel', (e) => {
            const modelCenterX = this.model.x
            const modelCenterY = this.model.y
            const modelW = this.model.width / 2
            const modelH = this.model.height / 2

            if (Math.abs(e.clientX - modelCenterX) < modelW &&
                Math.abs(e.clientY - modelCenterY) < modelH) {
                e.preventDefault()
                const factor = e.deltaY > 0 ? 0.9 : 1.1
                const newScale = this.model.scale.x * factor
                if (newScale > 0.05 && newScale < 5) {
                    this.model.scale.set(newScale)
                }
            }
        }, { passive: false })
    }

    // 嘴型动画（TTS用）
    setMouthOpenY(v) {
        if (!this.model) return
        try {
            v = Math.max(0, Math.min(v, 3.0))
            const coreModel = this.model.internalModel.coreModel
            try { coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', v) } catch (e) {}
            try { coreModel.setParameterValueById('ParamMouthOpenY', v) } catch (e) {}
        } catch (error) {}
    }
}

module.exports = { ModelInteractionController }
