const { Plugin } = require('../../../js/core/plugin-base.js');

class TranslationPlugin extends Plugin {

    async onTTSText(text) {
        const cfg = this.context.getPluginFileConfig();
        const globalConfig = this.context.getConfig();
        const api_key = cfg.api_key || globalConfig.llm?.api_key || '';
        const api_url = cfg.api_url || globalConfig.llm?.api_url || '';
        const model = cfg.model || globalConfig.llm?.model || '';
        const system_prompt = cfg.system_prompt || '你是一个专业翻译助手，请将以下中文准确翻译成英语，保持原意和语调，只返回翻译结果，不要添加任何解释：';
        if (!api_key || !api_url || !model) return text;

        try {
            const res = await fetch(`${api_url}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${api_key}`
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: system_prompt },
                        { role: 'user', content: text }
                    ],
                    stream: false
                })
            });

            if (!res.ok) return text;
            const data = await res.json();
            return data.choices[0].message.content || text;
        } catch (e) {
            this.context.log('warn', `翻译失败: ${e.message}`);
            return text;
        }
    }
}

module.exports = TranslationPlugin;
