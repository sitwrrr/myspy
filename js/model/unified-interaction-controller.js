// unified-interaction-controller.js - 统一交互控制器
// 根据模型类型委托到 Live2D 或 VRM 的交互控制器

const { ModelInteractionController } = require('./model-interaction.js');
const { VRMInteractionController } = require('./vrm-model-interaction.js');

class UnifiedInteractionController {
    constructor() {
        this._live2dCtrl = null;
        this._vrmCtrl = null;
        this._modelType = null;
    }

    /**
     * 初始化交互控制器
     * @param {UnifiedModelAdapter} modelAdapter - 统一模型适配器
     * @param {object} config - 配置
     */
    init(modelAdapter, config) {
        this._modelType = modelAdapter.modelType;
        const innerModel = modelAdapter.innerModel;
        const app = modelAdapter.app;

        if (this._modelType === 'vrm') {
            this._vrmCtrl = new VRMInteractionController();
            this._vrmCtrl.init(innerModel, app, config);
        } else {
            this._live2dCtrl = new ModelInteractionController();
            this._live2dCtrl.init(innerModel, app, config);
        }
    }

    /** 初始化模型位置 */
    setupInitialModelProperties() {
        if (this._live2dCtrl) {
            this._live2dCtrl.setupInitialModelProperties();
        } else if (this._vrmCtrl) {
            this._vrmCtrl.setupInitialModelProperties();
        }
    }

    /** 嘴型同步 */
    setMouthOpenY(v) {
        if (this._live2dCtrl) {
            this._live2dCtrl.setMouthOpenY(v);
        } else if (this._vrmCtrl) {
            this._vrmCtrl.setMouthOpenY(v);
        }
    }

    /** 保存模型位置 */
    saveModelPosition() {
        if (this._live2dCtrl) {
            this._live2dCtrl.saveModelPosition();
        } else if (this._vrmCtrl) {
            this._vrmCtrl.saveModelPosition();
        }
    }
}

module.exports = { UnifiedInteractionController };
