import express from "express";
import { OllamaOperations } from "./ollama_operations.js";
import { ContextManager } from "./context_manager.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── Environment variables ────────────────────────────────────────────────────
const MODEL_NAME = process.env.MODEL_NAME || "llama3";
const HISTORY_LENGTH = parseInt(process.env.HISTORY_LENGTH, 10) || 10;
const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const NIGHTBOT_TOKEN = process.env.NIGHTBOT_TOKEN || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const RATE_LIMIT_WINDOW_MS =
  parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 20;
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 12000;

// ── Initialise managers ──────────────────────────────────────────────────────
const contextManager = new ContextManager();
const ollamaOps = new OllamaOperations(
  MODEL_NAME,
  HISTORY_LENGTH,
  contextManager
);
app.set("trust proxy", TRUST_PROXY);

const requestBuckets = new Map();

function nowMs() {
  return Date.now();
}

function cleanInput(text) {
  return String(text || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNightbotInput(raw) {
  const input = cleanInput(raw);
  if (!input) return { username: "viewer", message: "" };

  const sep = input.indexOf(":");
  if (sep === -1) return { username: "viewer", message: input };

  const username = cleanInput(input.slice(0, sep)).slice(0, 64) || "viewer";
  const message = cleanInput(input.slice(sep + 1)).slice(0, 350);
  return { username, message };
}

function verifyNightbotToken(req, res, next) {
  if (!NIGHTBOT_TOKEN) {
    return res.status(503).json({ error: "Bot not configured." });
  }

  const token = String(
    req.query.token ||
      req.headers["x-nightbot-token"] ||
      req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
      ""
  );
  if (!token || token !== NIGHTBOT_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function rateLimitByIp(req, res, next) {
  const key = cleanInput(req.ip) || "unknown-ip";
  const ts = nowMs();
  const bucket = requestBuckets.get(key) || { start: ts, count: 0 };

  if (ts - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket.start = ts;
    bucket.count = 0;
  }

  bucket.count += 1;
  requestBuckets.set(key, bucket);
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).type("text/plain").send("Too many requests");
  }
  next();
}

async function chatWithTimeout(username, message) {
  return Promise.race([
    ollamaOps.chat(username, message),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Upstream timeout")), OLLAMA_TIMEOUT_MS)
    ),
  ]);
}

function maybeQueueLearningCandidate(username, message, response) {
  // Heuristic: only short explicit questions are proposed as FAQ candidates.
  if (!message.endsWith("?")) return;
  if (message.length < 8 || message.length > 220) return;

  contextManager.addLearningCandidate({
    type: "faq",
    source: "nightbot_chat",
    username,
    prompt: message,
    proposed: {
      question: message,
      answer: response,
    },
  });
}

// Protect all API endpoints with NIGHTBOT_TOKEN.
app.use(verifyNightbotToken);

app.get("/", (_req, res) => {
  res.json({
    name: "YouTube + NightBot + Ollama API",
    status: "ok",
    model: MODEL_NAME,
    docs: "See README.md for endpoints and examples.",
  });
});

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
 * GET /gpt/:input
 * GET /gpt?input=<input>
 * input format expected: "username:message"
 * Returns plain text for NightBot urlfetch compatibility.
 */
app.get("/gpt/:input?", rateLimitByIp, async (req, res) => {
  const rawInput = req.params.input || req.query.input || req.query.q || "";
  const { username, message } = parseNightbotInput(rawInput);

  if (!message) {
    return res.status(400).type("text/plain").send("Missing message");
  }

  try {
    const response = await chatWithTimeout(username, message);
    const safeResponse = cleanInput(response).slice(0, 420);
    contextManager.addToHistory(username, message, safeResponse);
    maybeQueueLearningCandidate(username, message, safeResponse);
    return res.type("text/plain").send(safeResponse);
  } catch (err) {
    console.error("[/gpt]", err.message);
    return res.status(502).type("text/plain").send("AI unavailable");
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

// ── Learning Queue (admin only) ──────────────────────────────────────────────

app.get("/learning/queue", (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const queue = contextManager.getLearningQueue(status);
  res.json({ total: queue.length, queue });
});

app.post("/learning/queue/:id/approve", (req, res) => {
  try {
    const approved = contextManager.approveLearningItem(req.params.id);
    if (!approved) return res.status(404).json({ error: "Item not found." });
    res.json({ message: "Learning item approved.", item: approved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/learning/queue/:id/reject", (req, res) => {
  const reason = cleanInput(req.body?.reason || "");
  const rejected = contextManager.rejectLearningItem(req.params.id, reason);
  if (!rejected) return res.status(404).json({ error: "Item not found." });
  res.json({ message: "Learning item rejected.", item: rejected });
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

// ── ADMIN UI ─────────────────────────────────────────────────────────────────
app.get("/admin", (req, res) => {
  const token = req.query.token || "";
  if (!NIGHTBOT_TOKEN || token !== NIGHTBOT_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Manolo Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 16px; }
    h1 { font-size: 1.2rem; margin-bottom: 12px; color: #a78bfa; }
    textarea { width: 100%; height: 60vh; background: #1e1e1e; color: #eee; border: 1px solid #444; border-radius: 8px; padding: 12px; font-size: 0.9rem; line-height: 1.5; resize: vertical; }
    button { margin-top: 12px; width: 100%; padding: 14px; background: #7c3aed; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
    button:active { background: #6d28d9; }
    #status { margin-top: 10px; text-align: center; font-size: 0.9rem; min-height: 20px; }
    .ok { color: #4ade80; }
    .err { color: #f87171; }
  </style>
</head>
<body>
  <h1>🤖 Manolo — Editar personality</h1>
  <textarea id="personality" placeholder="Escribe el personality de Manolo..."></textarea>
  <button onclick="save()">💾 Guardar</button>
  <div id="status"></div>
  <script>
    const TOKEN = new URLSearchParams(location.search).get('token');
    const status = document.getElementById('status');

    async function load() {
      const res = await fetch('/context/channel?token=' + TOKEN);
      const data = await res.json();
      document.getElementById('personality').value = data.personality || '';
    }

    async function save() {
      status.textContent = 'Guardando...';
      status.className = '';
      try {
        const res = await fetch('/context/channel?token=' + TOKEN, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personality: document.getElementById('personality').value })
        });
        if (res.ok) {
          status.textContent = '✅ Guardado correctamente';
          status.className = 'ok';
        } else {
          throw new Error(res.status);
        }
      } catch (e) {
        status.textContent = '❌ Error al guardar: ' + e.message;
        status.className = 'err';
      }
    }

    load();
  </script>
</body>
</html>`);
});

// ── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅  YouTube Chatbot API → http://localhost:${PORT}`);
  console.log(`🤖  Ollama: ${OLLAMA_URL}  |  Model: ${MODEL_NAME}`);

  const check = await OllamaOperations.healthCheck();
  if (!check.ok) {
    console.warn(`⚠️  Ollama not reachable at ${OLLAMA_URL}: ${check.error}`);
  } else {
    const hasModel = check.models.some((m) => m.startsWith(MODEL_NAME));
    if (!hasModel) {
      console.warn(`⚠️  Model "${MODEL_NAME}" not found.`);
    } else {
      console.log(`✅  Ollama OK — warming up model "${MODEL_NAME}"...`);
      // Warmup: precarga el modelo en RAM para que la primera llamada real sea rápida
      try {
        await fetch(`${OLLAMA_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL_NAME,
            messages: [{ role: "user", content: "hi" }],
            stream: false,
            options: { num_predict: 1 },
          }),
          signal: AbortSignal.timeout(90_000),
        });
        console.log(`🔥  Model warmed up and ready`);
      } catch (err) {
        console.warn(`⚠️  Warmup failed: ${err.message}`);
      }
    }
  }
});
