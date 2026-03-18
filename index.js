import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { OllamaOperations } from "./ollama_operations.js";
import { ContextManager } from "./context_manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Environment variables ────────────────────────────────────────────────────
const MODEL_NAME = process.env.MODEL_NAME || "llama3";
const HISTORY_LENGTH = parseInt(process.env.HISTORY_LENGTH, 10) || 10;
const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// ── Initialise managers ──────────────────────────────────────────────────────
const contextManager = new ContextManager();
const ollamaOps = new OllamaOperations(
  MODEL_NAME,
  HISTORY_LENGTH,
  contextManager
);

// ── Dashboard UI ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) =>
  res.render("dashboard", { model: MODEL_NAME, ollamaUrl: OLLAMA_URL })
);

// ── CHAT ─────────────────────────────────────────────────────────────────────

/**
 * POST /chat
 * Body: { username: string, message: string }
 * Returns: { response: string }
 */
app.post("/chat", async (req, res) => {
  const { username, message } = req.body;
  if (!username || !message) {
    return res
      .status(400)
      .json({ error: "username and message are required." });
  }
  try {
    const response = await ollamaOps.chat(username, message);
    contextManager.addToHistory(username, message, response);
    res.json({ response });
  } catch (err) {
    console.error("[/chat]", err.message);
    res
      .status(500)
      .json({ error: "Failed to generate response.", detail: err.message });
  }
});

/**
 * GET /chat/history/:username
 */
app.get("/chat/history/:username", (req, res) => {
  const history = contextManager.getUserHistory(req.params.username);
  res.json({ username: req.params.username, history });
});

/**
 * DELETE /chat/history/:username
 */
app.delete("/chat/history/:username", (req, res) => {
  contextManager.clearUserHistory(req.params.username);
  res.json({ message: `History cleared for ${req.params.username}.` });
});

// ── CHANNEL CONTEXT ──────────────────────────────────────────────────────────

app.get("/context/channel", (_req, res) =>
  res.json(contextManager.getChannelContext())
);

app.put("/context/channel", (req, res) => {
  contextManager.updateChannelContext(req.body);
  res.json({
    message: "Channel context updated.",
    context: contextManager.getChannelContext(),
  });
});

// ── USERS ────────────────────────────────────────────────────────────────────

app.get("/context/users", (_req, res) =>
  res.json(contextManager.getAllUsers())
);

app.get("/context/users/:username", (req, res) => {
  const user = contextManager.getUser(req.params.username);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json(user);
});

app.put("/context/users/:username", (req, res) => {
  const updated = contextManager.upsertUser(req.params.username, req.body);
  res.json({ message: "User updated.", user: updated });
});

app.delete("/context/users/:username", (req, res) => {
  contextManager.deleteUser(req.params.username);
  res.json({ message: `User ${req.params.username} deleted.` });
});

// ── FAQs ─────────────────────────────────────────────────────────────────────

app.get("/context/faqs", (_req, res) => res.json(contextManager.getAllFAQs()));

app.post("/context/faqs", (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer)
    return res.status(400).json({ error: "question and answer are required." });
  const faq = contextManager.addFAQ(question, answer);
  res.status(201).json({ message: "FAQ added.", faq });
});

app.put("/context/faqs/:id", (req, res) => {
  const updated = contextManager.updateFAQ(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "FAQ not found." });
  res.json({ message: "FAQ updated.", faq: updated });
});

app.delete("/context/faqs/:id", (req, res) => {
  const deleted = contextManager.deleteFAQ(req.params.id);
  if (!deleted) return res.status(404).json({ error: "FAQ not found." });
  res.json({ message: "FAQ deleted." });
});

// ── HEALTH ───────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  const ollama = await OllamaOperations.healthCheck();
  res.json({
    status: ollama.ok ? "ok" : "ollama_unreachable",
    model: MODEL_NAME,
    ollama_url: OLLAMA_URL,
    ollama_models: ollama.models,
    uptime: process.uptime(),
    ...(ollama.error ? { ollama_error: ollama.error } : {}),
  });
});

// ── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅  YouTube Chatbot API → http://localhost:${PORT}`);
  console.log(`🤖  Ollama: ${OLLAMA_URL}  |  Model: ${MODEL_NAME}`);

  const check = await OllamaOperations.healthCheck();
  if (!check.ok) {
    console.warn(`⚠️  Ollama not reachable at ${OLLAMA_URL}: ${check.error}`);
    console.warn("    Make sure Ollama is running:  ollama serve");
  } else {
    const hasModel = check.models.some((m) => m.startsWith(MODEL_NAME));
    if (!hasModel) {
      console.warn(
        `⚠️  Model "${MODEL_NAME}" not found. Available: ${
          check.models.join(", ") || "none"
        }`
      );
      console.warn(`    Run: ollama pull ${MODEL_NAME}`);
    } else {
      console.log(`✅  Ollama OK — model "${MODEL_NAME}" ready`);
    }
  }
});
