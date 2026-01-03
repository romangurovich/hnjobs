client<llm> OpenRouter {
  provider openai
  options {
    base_url "https://openrouter.ai/api/v1"
    model "xiaomi/mimo-v2-flash:free"
    api_key env.OPENROUTER_API_KEY
  }
}
