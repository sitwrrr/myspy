// model-scanner.js - 模型自动检测
// 扫描 2D/、3D/ 和 images/ 目录，自动发现可用模型

const fs = require('fs');
const path = require('path');

const IMAGE_EXTS = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];

class ModelScanner {
    /**
     * 扫描所有可用模型
     * @param {string} basePath - 项目根目录
     * @returns {{ live2d: Array, vrm: Array, images: Array }}
     */
    static scan(basePath) {
        const result = { live2d: [], vrm: [], images: [] };

        // 扫描 2D 目录（Live2D 模型）
        const dir2D = path.join(basePath, '2D');
        if (fs.existsSync(dir2D)) {
            result.live2d = ModelScanner._scanLive2D(dir2D);
        }

        // 扫描 3D 目录（VRM 模型）
        const dir3D = path.join(basePath, '3D');
        if (fs.existsSync(dir3D)) {
            result.vrm = ModelScanner._scanVRM(dir3D);
        }

        // 扫描 images 目录（图片/GIF 模型）
        const dirImages = path.join(basePath, 'images');
        if (fs.existsSync(dirImages)) {
            result.images = ModelScanner._scanImages(dirImages);
        }

        return result;
    }

    /**
     * 扫描 Live2D 模型（查找 .model3.json 文件）
     */
    static _scanLive2D(dir) {
        const models = [];
        try {
            const chars = fs.readdirSync(dir);
            for (const char of chars) {
                const charDir = path.join(dir, char);
                if (!fs.statSync(charDir).isDirectory()) continue;

                // 查找 .model3.json 文件
                const files = fs.readdirSync(charDir);
                for (const file of files) {
                    if (file.endsWith('.model3.json')) {
                        models.push({
                            name: char,
                            file: file,
                            path: `${char}/${file}`,
                            dir: charDir,
                            type: 'live2d'
                        });
                    }
                }
            }
        } catch (e) {
            console.error('扫描 Live2D 模型失败:', e.message);
        }
        return models;
    }

    /**
     * 扫描 VRM 模型（查找 .vrm 文件）
     */
    static _scanVRM(dir) {
        const models = [];
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (file.endsWith('.vrm')) {
                    models.push({
                        name: path.basename(file, '.vrm'),
                        file: file,
                        path: `${file}`,
                        dir: dir,
                        type: 'vrm'
                    });
                }
            }
        } catch (e) {
            console.error('扫描 VRM 模型失败:', e.message);
        }
        return models;
    }

    /**
     * 扫描图片模型（查找 .gif .png .jpg 等文件）
     */
    static _scanImages(dir) {
        const models = [];
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                const ext = path.extname(file).toLowerCase();

                if (stat.isDirectory()) {
                    // 子文件夹：扫描里面的 GIF
                    const gifs = ModelScanner._scanGifsInDir(fullPath);
                    if (gifs.length > 0) {
                        models.push({
                            name: file + ' (随机GIF)',
                            path: fullPath,
                            type: 'image',
                            isGifFolder: true,
                            gifCount: gifs.length
                        });
                    }
                } else if (IMAGE_EXTS.includes(ext)) {
                    models.push({
                        name: path.basename(file, ext),
                        file: file,
                        path: file,
                        dir: dir,
                        type: 'image'
                    });
                }
            }
        } catch (e) {
            console.error('扫描图片模型失败:', e.message);
        }
        return models;
    }

    static _scanGifsInDir(dir) {
        const gifs = [];
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (file.toLowerCase().endsWith('.gif')) {
                    gifs.push(path.join(dir, file));
                }
            }
        } catch (e) {}
        return gifs;
    }

    static getRandomGif(dirPath) {
        const gifs = ModelScanner._scanGifsInDir(dirPath);
        if (gifs.length === 0) return null;
        return gifs[Math.floor(Math.random() * gifs.length)];
    }

    /**
     * 自动检测模型类型（根据文件路径）
     * @param {string} modelPath - 模型路径
     * @returns {'live2d'|'vrm'|null}
     */
    static detectType(modelPath) {
        if (!modelPath) return null;
        const lower = modelPath.toLowerCase();
        if (lower.endsWith('.vrm')) return 'vrm';
        if (lower.endsWith('.model3.json') || lower.endsWith('.model.json')) return 'live2d';
        if (IMAGE_EXTS.some(ext => lower.endsWith(ext))) return 'image';
        // 目录：检查是否包含 GIF
        try {
            if (fs.statSync(modelPath).isDirectory()) {
                const gifs = ModelScanner._scanGifsInDir(modelPath);
                if (gifs.length > 0) return 'image';
            }
        } catch (e) {}
        return null;
    }

    /**
     * 获取默认模型（优先 VRM，然后 Live2D）
     * @param {string} basePath - 项目根目录
     * @returns {{ type, path, name }|null}
     */
    static getDefaultModel(basePath) {
        const all = ModelScanner.scan(basePath);

        // 优先使用配置的模型
        // 这里只返回扫描到的第一个可用模型
        if (all.vrm.length > 0) {
            return { type: 'vrm', path: `3D/${all.vrm[0].path}`, name: all.vrm[0].name };
        }
        if (all.live2d.length > 0) {
            return { type: 'live2d', path: `2D/${all.live2d[0].path}`, name: all.live2d[0].name };
        }
        return null;
    }

    /**
     * 获取所有可用模型列表（供 WebUI 使用）
     * @param {string} basePath - 项目根目录
     * @returns {Array<{type, path, name, label}>}
     */
    static getModelList(basePath) {
        const all = ModelScanner.scan(basePath);
        const list = [];

        for (const m of all.vrm) {
            list.push({
                type: 'vrm',
                path: `3D/${m.path}`,
                name: m.name,
                label: `[3D] ${m.name}`
            });
        }
        for (const m of all.live2d) {
            list.push({
                type: 'live2d',
                path: `2D/${m.path}`,
                name: m.name,
                label: `[2D] ${m.name}`
            });
        }
        for (const m of all.images) {
            list.push({
                type: 'image',
                path: `images/${m.path}`,
                name: m.name,
                label: `[图片] ${m.name}`
            });
        }
        return list;
    }
}

module.exports = { ModelScanner };
