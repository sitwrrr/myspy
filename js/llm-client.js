// llm-client.js - LLM API 客户端（支持工具调用 + 流式输出）
class LLMClient {
    constructor(config) {
        this.apiKey = config.llm.api_key
        this.apiUrl = config.llm.api_url
        this.model = config.llm.model
        this.systemPrompt = config.llm.system_prompt
    }

    // 发送聊天请求（非流式）
    async chatCompletion(messages, tools = null) {
        const requestBody = {
            model: this.model,
            messages: messages
        }

        if (tools && tools.length > 0) {
            requestBody.tools = tools
        }

        try {
            const response = await fetch(`${this.apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API错误 ${response.status}: ${errorText}`)
            }

            const data = await response.json()

            if (data.error) {
                throw new Error(`API错误: ${data.error.message || data.error}`)
            }

            if (!data.choices || data.choices.length === 0) {
                throw new Error('API返回空响应')
            }

            return data.choices[0].message

        } catch (error) {
            console.error('LLM调用失败:', error.message)
            throw error
        }
    }

    // 流式聊天请求 - 逐块返回文本
    async streamChatCompletion(messages, tools = null, onChunk = null) {
        const requestBody = {
            model: this.model,
            messages: messages,
            stream: true
        }

        if (tools && tools.length > 0) {
            requestBody.tools = tools
        }

        try {
            const response = await fetch(`${this.apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API错误 ${response.status}: ${errorText}`)
            }

            // 读取 SSE 流
            const reader = response.body.getReader()
            const decoder = new TextDecoder('utf-8')
            let buffer = ''
            let fullContent = ''
            let hasToolCalls = false
            let toolCallsData = []

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })

                const lines = buffer.split('\n')
                buffer = lines.pop() || ''  // 保留未完成的行

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed || trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') continue

                    if (trimmed.startsWith('data:')) {
                        const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5)
                        try {
                            const chunk = JSON.parse(jsonStr)
                            const choice = chunk.choices?.[0]

                            if (!choice) continue

                            // 检查是否有工具调用
                            if (choice.delta?.tool_calls) {
                                hasToolCalls = true
                                // 累积工具调用数据
                                for (const tc of choice.delta.tool_calls) {
                                    if (tc.index !== undefined) {
                                        if (!toolCallsData[tc.index]) {
                                            toolCallsData[tc.index] = {
                                                id: tc.id || '',
                                                type: tc.type || 'function',
                                                function: { name: '', arguments: '' }
                                            }
                                        }
                                        if (tc.id) toolCallsData[tc.index].id = tc.id
                                        if (tc.function?.name) toolCallsData[tc.index].function.name += tc.function.name
                                        if (tc.function?.arguments) toolCallsData[tc.index].function.arguments += tc.function.arguments
                                    }
                                }
                            }

                            // 检查文本内容
                            const delta = choice.delta
                            if (delta?.content) {
                                fullContent += delta.content
                                if (onChunk) onChunk(delta.content)
                            }
                        } catch (e) {
                            // 解析失败跳过
                        }
                    }
                }
            }

            // 如果有工具调用，返回特殊格式
            if (hasToolCalls && toolCallsData.length > 0) {
                return {
                    content: fullContent || null,
                    tool_calls: toolCallsData.filter(Boolean)
                }
            }

            return { content: this._filterThinkingContent(fullContent) }

        } catch (error) {
            console.error('LLM流式调用失败:', error.message)
            throw error
        }
    }

    /**
     * 过滤 LLM 输出中的思考内容块
     * 支持 <think>...</think>（DeepSeek/Gemini）和 </think>...</think>（部分模型）
     */
    _filterThinkingContent(text) {
        if (!text) return text;
        let filtered = text;
        filtered = filtered.replace(new RegExp('<think>[\\s\\S]*?<\\/think>', 'gi'), '');
        filtered = filtered.replace(new RegExp('<reasoning>[\\s\\S]*?<\\/reasoning>', 'gi'), '');
        return filtered.trim();
    }
}

module.exports = { LLMClient }
