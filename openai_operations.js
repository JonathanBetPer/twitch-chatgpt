import OpenAI from "openai";

export class OpenAIOperations {
  constructor(apiKey, modelName, historyLength, contextManager) {
    this.openai = new OpenAI({ apiKey });
    this.modelName = modelName;
    this.historyLength = historyLength;
    this.contextManager = contextManager;
  }

  /**
   * Main chat method.
   * Builds a full context-aware message array and calls the OpenAI API.
   *
   * @param {string} username   - YouTube viewer username
   * @param {string} message    - The viewer's message
   * @returns {Promise<string>} - The bot's response
   */
  async chat(username, message) {
    // 1. System prompt = channel context + FAQs + personality
    const systemPrompt = this.contextManager.buildSystemPrompt();

    // 2. Inject per-user context into the system prompt
    const userCtx = this.contextManager.buildUserContext(username);
    const fullSystem = userCtx ? `${systemPrompt}\n${userCtx}` : systemPrompt;

    // 3. Previous conversation turns for this user
    const historyMessages = this.contextManager.getHistoryAsMessages(
      username,
      this.historyLength
    );

    // 4. Current user message
    const userMessage = { role: "user", content: `${username}: ${message}` };

    const messages = [
      { role: "system", content: fullSystem },
      ...historyMessages,
      userMessage,
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelName,
        messages,
        temperature: 0.8,
        max_tokens: 150, // Keep replies short for live chat
        top_p: 1,
        frequency_penalty: 0.3,
        presence_penalty: 0.2,
      });

      const reply = response.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error("Empty response from OpenAI");

      return reply;
    } catch (error) {
      console.error("[OpenAIOperations.chat]", error);
      throw error;
    }
  }
}
