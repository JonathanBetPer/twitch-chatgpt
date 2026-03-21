import fetch from "node-fetch";

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_TEMPERATURE = parseFloat(process.env.OLLAMA_TEMPERATURE || "0.6");
const OLLAMA_NUM_PREDICT = parseInt(process.env.OLLAMA_NUM_PREDICT, 10) || 96;
const OLLAMA_REPEAT_PENALTY = parseFloat(
  process.env.OLLAMA_REPEAT_PENALTY || "1.1"
);

export class OllamaOperations {
  constructor(modelName, historyLength, contextManager) {
    this.modelName = modelName;
    this.historyLength = historyLength;
    this.contextManager = contextManager;
  }

  /**
   * Main chat method.
   * Calls the Ollama /api/chat endpoint with full context.
   *
   * @param {string} username
   * @param {string} message
   * @returns {Promise<string>}
   */
  async chat(username, message) {
    const systemPrompt = this.contextManager.buildSystemPrompt();

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${username}: ${message}` },
    ];

    const body = {
      model: this.modelName,
      messages,
      stream: false,
      options: {
        temperature: OLLAMA_TEMPERATURE,
        num_predict: OLLAMA_NUM_PREDICT, // Keep replies short for live chat
        repeat_penalty: OLLAMA_REPEAT_PENALTY,
      },
    };

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const reply = data?.message?.content?.trim();

    if (!reply) throw new Error("Empty response from Ollama");
    return reply;
  }

  /**
   * Checks that Ollama is reachable and the model is available.
   * Returns { ok: boolean, models: string[] }
   */
  static async healthCheck() {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err.message, models: [] };
    }
  }
}
