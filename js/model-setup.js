// model-setup.js - Live2D模型加载
class ModelSetup {
    static async initialize(config) {
        const { ipcRenderer } = require('electron')

        // 获取窗口尺寸
        const windowBounds = await ipcRenderer.invoke('get-window-bounds')
        const actualWidth = windowBounds.width
        const actualHeight = windowBounds.height

        console.log(`窗口尺寸: ${actualWidth}x${actualHeight}`)

        // 检查PIXI是否加载
        if (typeof PIXI === 'undefined') {
            throw new Error('PIXI未加载')
        }
        console.log('PIXI已加载')

        // 检查Live2D插件
        if (!PIXI.live2d || !PIXI.live2d.Live2DModel) {
            throw new Error('Live2D插件未加载')
        }
        console.log('Live2D插件已加载')

        // 创建PIXI应用 - 1:1尺寸
        const app = new PIXI.Application({
            view: document.getElementById('canvas'),
            autoStart: true,
            transparent: true,
            width: actualWidth,
            height: actualHeight
        })

        app.view.style.width = `${actualWidth}px`
        app.view.style.height = `${actualHeight}px`

        window.actualWindowWidth = actualWidth
        window.actualWindowHeight = actualHeight
        window.canvasScaleFactor = 1

        console.log('正在加载Live2D模型...')

        // 加载Live2D模型
        const model = await PIXI.live2d.Live2DModel.from('2D/feiniu/hiyori_pro_t11.model3.json')
        app.stage.addChild(model)
        console.log('Live2D模型加载完成')

        // 设置缩放 - 直接指定一个较大的值
        const scale = 0.2
        model.scale.set(scale)

        // 模型放在窗口中间偏下
        model.x = actualWidth / 2
        model.y = actualHeight * 0.6

        console.log(`模型缩放: ${scale}, 位置: (${model.x}, ${model.y})`)

        return { app, model }
    }
}

module.exports = { ModelSetup }
