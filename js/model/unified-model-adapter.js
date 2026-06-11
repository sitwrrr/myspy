// unified-model-adapter.js - 统一模型适配器
// 封装 Live2D 和 VRM 模型，提供统一接口，让其他代码无需关心底层模型类型

const EventEmitter = require('events');

class UnifiedModelAdapter extends EventEmitter {
    /**
     * @param {object} innerModel - Live2D PIXI model 或 VRMModelAdapter
     * @param {object} app - PIXI Application 或 appProxy
     * @param {'live2d'|'vrm'} modelType
     * @param {object} config - 配置
     */
    constructor(innerModel, app, modelType, config) {
        super();
        this._inner = innerModel;
        this._app = app;
        this.modelType = modelType;
        this._config = config;

        // 为 Live2D 模型补充 triggerEmotion 方法
        if (modelType === 'live2d' && !innerModel.triggerEmotion) {
            this._setupLive2DCompatibility();
        }

        // 转发 EventEmitter 事件（VRM 用 Node EventEmitter，Live2D 用 PIXI EventEmitter）
        if (modelType === 'vrm') {
            this._forwardEvents();
        }
    }

    // === 统一属性 ===

    get visible() { return this._inner.visible; }
    set visible(val) { this._inner.visible = val; }

    get x() { return this._inner.x; }
    set x(val) { this._inner.x = val; }

    get y() { return this._inner.y; }
    set y(val) { this._inner.y = val; }

    get width() { return this._inner.width; }
    get height() { return this._inner.height; }

    get scale() { return this._inner.scale; }

    get interactive() { return this._inner.interactive; }
    set interactive(val) { this._inner.interactive = val; }

    get app() { return this._app; }
    get innerModel() { return this._inner; }

    // VRM 视口区域（Live2D 无此概念，返回 null）
    get viewRect() {
        return this._inner.viewRect || null;
    }
    set viewRect(rect) {
        if (this._inner.viewRect !== undefined) {
            this._inner.viewRect = rect;
        }
    }

    // === 统一方法 ===

    /** 触发动作（点击等） */
    motion(group, index) {
        this._inner.motion(group, index);
    }

    /** 触发表情 */
    expression(name) {
        this._inner.expression(name);
    }

    /** 按中文情绪名触发表情（统一入口） */
    playEmotionExpression(emotionName) {
        if (this._inner.playEmotionExpression) {
            this._inner.playEmotionExpression(emotionName);
        } else if (this._inner.expression) {
            this._inner.expression(emotionName);
        }
    }

    /** 插件触发情绪入口（统一接口） */
    triggerEmotion(emotion) {
        if (this._inner.triggerEmotion) {
            this._inner.triggerEmotion(emotion);
        } else {
            this.playEmotionExpression(emotion);
        }
    }

    /** 命中检测（PIXI 点格式 {x, y}） */
    containsPoint(point) {
        return this._inner.containsPoint(point);
    }

    /** 嘴型同步 */
    setMouthOpenY(v) {
        if (this._inner.setMouthOpenY) {
            this._inner.setMouthOpenY(v);
        } else if (this._inner.internalModel?.coreModel) {
            // Live2D 直接设置参数
            try {
                v = Math.max(0, Math.min(v, 3.0));
                const coreModel = this._inner.internalModel.coreModel;
                try { coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', v); } catch (e) {}
                try { coreModel.setParameterValueById('ParamMouthOpenY', v); } catch (e) {}
            } catch (e) {}
        }
    }

    /** 帧更新（VRM 需要，Live2D 由 PIXI ticker 处理） */
    update(deltaTime) {
        if (this._inner.update) {
            this._inner.update(deltaTime);
        }
    }

    /** 获取 internalModel（兼容旧代码） */
    get internalModel() {
        return this._inner.internalModel;
    }

    /** 获取可用表情列表 */
    getAvailableExpressions() {
        if (this._inner.getAvailableExpressions) {
            return this._inner.getAvailableExpressions();
        }
        return [];
    }

    // === Live2D 兼容层 ===

    _setupLive2DCompatibility() {
        // 为 Live2D 模型添加 triggerEmotion 方法
        // 通过 emotionMapper 触发（emotionMapper 在 app.js 中初始化后绑定）
        this._inner.triggerEmotion = (emotion) => {
            if (this._emotionMapper) {
                this._emotionMapper.triggerByEmotion(emotion);
            }
        };

        // 为 Live2D 模型添加 playEmotionExpression 方法
        this._inner.playEmotionExpression = (emotionName) => {
            if (this._emotionMapper) {
                this._emotionMapper.triggerByEmotion(emotionName);
            } else if (this._inner.expression) {
                this._inner.expression(emotionName);
            }
        };
    }

    /** 绑定情绪映射器（Live2D 模型需要） */
    setEmotionMapper(emotionMapper) {
        this._emotionMapper = emotionMapper;
    }

    // === VRM 事件转发 ===

    _forwardEvents() {
        // VRMModelAdapter 使用 Node EventEmitter，
        // 而 UnifiedModelAdapter 也继承 EventEmitter，
        // 需要将内部模型的事件转发到外部
        const events = ['mousedown', 'mousemove', 'mouseover', 'mouseout', 'click', 'rightdown'];
        for (const event of events) {
            this._inner.on(event, (...args) => this.emit(event, ...args));
        }
    }
}

module.exports = { UnifiedModelAdapter };
