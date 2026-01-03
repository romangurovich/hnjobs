client<llm> OpenRouter {
  provider openai
  options {
    base_url "https://openrouter.ai/api/v1"
    model "x-ai/grok-2-1212"
    api_key env.OPENROUTER_API_KEY
  }
}
