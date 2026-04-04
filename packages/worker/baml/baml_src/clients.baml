client<llm> OpenRouter {
  provider openai
  options {
    base_url "https://openrouter.ai/api/v1"
    model "qwen/qwen3.6-plus:free"
    api_key env.OPENROUTER_API_KEY
  }
}
