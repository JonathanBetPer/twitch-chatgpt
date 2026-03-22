import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  channel: path.join(DATA_DIR, "channel.json"),
  users: path.join(DATA_DIR, "users.json"),
  faqs: path.join(DATA_DIR, "faqs.json"),
  history: path.join(DATA_DIR, "history.json"),
  learningQueue: path.join(DATA_DIR, "learning_queue.json"),
};

function readJSON(file, defaultValue) {
  try {
    if (!fs.existsSync(file)) return defaultValue;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return defaultValue;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export class ContextManager {
  constructor() {
    // Initialise files with defaults if they don't exist
    if (!fs.existsSync(FILES.channel)) {
      writeJSON(FILES.channel, {
        name: "",
        description: "",
        topics: [],
        language: "es",
        links: {},
        personality:
          "You are a friendly and helpful YouTube chatbot. Be concise, engaging and fun.",
      });
    }
    if (!fs.existsSync(FILES.users)) writeJSON(FILES.users, {});
    if (!fs.existsSync(FILES.faqs)) writeJSON(FILES.faqs, []);
    if (!fs.existsSync(FILES.history)) writeJSON(FILES.history, {});
    if (!fs.existsSync(FILES.learningQueue)) writeJSON(FILES.learningQueue, []);
  }

  // ── Channel ──────────────────────────────────────────────────────────────

  getChannelContext() {
    return readJSON(FILES.channel, {});
  }

  updateChannelContext(partial) {
    const current = this.getChannelContext();
    const updated = { ...current, ...partial };
    writeJSON(FILES.channel, updated);
    return updated;
  }

  /**
   * Builds the system prompt string by combining channel context + FAQs.
   */
  buildSystemPrompt() {
    const ch = this.getChannelContext();
    
    // Carga desde archivo si existe
    const promptFile = path.join(__dirname, 'data', 'personality.txt');
    if (fs.existsSync(promptFile)) {
      return fs.readFileSync(promptFile, 'utf8').trim();
    }
    
    return ch.personality || "You are a helpful YouTube chatbot.";
  }

  // ── Users ────────────────────────────────────────────────────────────────

  getAllUsers() {
    return readJSON(FILES.users, {});
  }

  getUser(username) {
    const users = this.getAllUsers();
    return users[username] || null;
  }

  upsertUser(username, data) {
    const users = this.getAllUsers();
    users[username] = {
      ...(users[username] || { createdAt: new Date().toISOString() }),
      ...data,
      updatedAt: new Date().toISOString(),
    };
    writeJSON(FILES.users, users);
    return users[username];
  }

  deleteUser(username) {
    const users = this.getAllUsers();
    delete users[username];
    writeJSON(FILES.users, users);
  }

  /**
   * Returns a short text snippet about a user to inject into the prompt.
   */
  buildUserContext(username) {
    const user = this.getUser(username);
    if (!user) return "";

    let ctx = `\nContext about this viewer (${username}):`;
    if (user.notes) ctx += ` ${user.notes}.`;
    if (user.preferences)
      ctx += ` Preferences: ${JSON.stringify(user.preferences)}.`;
    if (user.tags?.length) ctx += ` Tags: ${user.tags.join(", ")}.`;
    return ctx;
  }

  // ── FAQs ─────────────────────────────────────────────────────────────────

  getAllFAQs() {
    return readJSON(FILES.faqs, []);
  }

  addFAQ(question, answer) {
    const faqs = this.getAllFAQs();
    const faq = {
      id: randomUUID(),
      question,
      answer,
      createdAt: new Date().toISOString(),
    };
    faqs.push(faq);
    writeJSON(FILES.faqs, faqs);
    return faq;
  }

  updateFAQ(id, data) {
    const faqs = this.getAllFAQs();
    const idx = faqs.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    faqs[idx] = { ...faqs[idx], ...data, updatedAt: new Date().toISOString() };
    writeJSON(FILES.faqs, faqs);
    return faqs[idx];
  }

  deleteFAQ(id) {
    const faqs = this.getAllFAQs();
    const idx = faqs.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    faqs.splice(idx, 1);
    writeJSON(FILES.faqs, faqs);
    return true;
  }

  // ── Conversation History ─────────────────────────────────────────────────

  getUserHistory(username) {
    const history = readJSON(FILES.history, {});
    return history[username] || [];
  }

  addToHistory(username, userMessage, botResponse) {
    const history = readJSON(FILES.history, {});
    if (!history[username]) history[username] = [];

    history[username].push({
      timestamp: new Date().toISOString(),
      user: userMessage,
      bot: botResponse,
    });

    // Keep only the last 50 exchanges per user to avoid unbounded growth
    if (history[username].length > 50) {
      history[username] = history[username].slice(-50);
    }

    writeJSON(FILES.history, history);
  }

  clearUserHistory(username) {
    const history = readJSON(FILES.history, {});
    delete history[username];
    writeJSON(FILES.history, history);
  }

  /**
   * Returns the last N messages for a user as an OpenAI messages array.
   */
  getHistoryAsMessages(username, maxTurns = 5) {
    const turns = this.getUserHistory(username).slice(-maxTurns);
    const messages = [];
    for (const turn of turns) {
      messages.push({ role: "user", content: turn.user });
      messages.push({ role: "assistant", content: turn.bot });
    }
    return messages;
  }

  // ── Learning Queue ────────────────────────────────────────────────────────

  getLearningQueue(status) {
    const queue = readJSON(FILES.learningQueue, []);
    if (!status) return queue;
    return queue.filter((item) => item.status === status);
  }

  addLearningCandidate(candidate) {
    const queue = this.getLearningQueue();
    const item = {
      id: randomUUID(),
      type: candidate.type || "faq",
      source: candidate.source || "chat",
      username: candidate.username || "",
      prompt: candidate.prompt || "",
      proposed: candidate.proposed || {},
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    queue.push(item);
    writeJSON(FILES.learningQueue, queue);
    return item;
  }

  approveLearningItem(id) {
    const queue = this.getLearningQueue();
    const idx = queue.findIndex((item) => item.id === id);
    if (idx === -1) return null;

    const item = queue[idx];
    if (item.status !== "pending") return item;

    if (item.type === "faq") {
      const question = item.proposed?.question?.trim();
      const answer = item.proposed?.answer?.trim();
      if (!question || !answer) {
        throw new Error("Invalid FAQ candidate.");
      }
      this.addFAQ(question, answer);
    } else if (item.type === "user_note") {
      const username = item.username?.trim();
      const notes = item.proposed?.notes?.trim();
      if (!username || !notes) {
        throw new Error("Invalid user note candidate.");
      }
      this.upsertUser(username, { notes });
    }

    queue[idx] = {
      ...item,
      status: "approved",
      approvedAt: new Date().toISOString(),
    };
    writeJSON(FILES.learningQueue, queue);
    return queue[idx];
  }

  rejectLearningItem(id, reason = "") {
    const queue = this.getLearningQueue();
    const idx = queue.findIndex((item) => item.id === id);
    if (idx === -1) return null;

    const item = queue[idx];
    if (item.status !== "pending") return item;

    queue[idx] = {
      ...item,
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      ...(reason ? { reason } : {}),
    };
    writeJSON(FILES.learningQueue, queue);
    return queue[idx];
  }
}
