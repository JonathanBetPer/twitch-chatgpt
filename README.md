# YouTube AI Chatbot API

AI-powered chatbot for YouTube live chat. Exposes a simple REST API so any external system (StreamElements, bots, scripts…) can request responses.

---

## Features

- **Contextual AI replies** via Ollama (llama3 by default) — 100% local, no API keys needed
- **Channel context** — teach the bot about your channel, topics and links
- **Per-user memory** — store notes and preferences for frequent viewers
- **FAQs** — predefined Q&A pairs injected into every prompt
- **Conversation history** — last N turns remembered per user
- **Dashboard UI** at `/`

---

## Setup

### 1. Clone & install

```bash
git clone <your-repo>
cd yt-chatbot
npm install
```

### 2. Instalar y arrancar Ollama

```bash
# Instalar Ollama (Linux/Mac)
curl -fsSL https://ollama.com/install.sh | sh

# Descargar el modelo
ollama pull llama3

# Arrancar el servidor (si no está ya corriendo)
ollama serve
```

### 3. Variables de entorno

| Variable         | Default                  | Description                       |
| ---------------- | ------------------------ | --------------------------------- |
| `OLLAMA_URL`     | `http://localhost:11434` | URL del servidor Ollama           |
| `MODEL_NAME`     | `llama3`                 | Modelo a usar                     |
| `HISTORY_LENGTH` | `10`                     | Turns de conversación por usuario |
| `PORT`           | `3000`                   | Puerto HTTP                       |

### 4. Arrancar el bot

```bash
npm start
# o para desarrollo (auto-restart):
npm run dev
```

Al arrancar, el bot verifica automáticamente que Ollama esté disponible y que el modelo esté descargado, mostrando warnings claros si algo falla.

### 5. Configurar el contexto del canal

```bash
curl -X PUT http://localhost:3000/context/channel \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi Canal",
    "description": "Contenido semanal de tech y gaming",
    "topics": ["tech", "gaming", "tutoriales"],
    "language": "es",
    "links": {
      "youtube": "https://youtube.com/@micanal",
      "discord": "https://discord.gg/xxxxx"
    },
    "personality": "Eres un chatbot amigable y gracioso para Mi Canal. Responde siempre en español, de forma breve y entretenida."
  }'
```

---

## API Reference

### Chat

#### `POST /chat`

Envía un mensaje de un viewer y recibe la respuesta de la IA.

**Body**

```json
{ "username": "viewer123", "message": "¿de qué va este juego?" }
```

**Response**

```json
{ "response": "¡Es Elden Ring! Un souls-like brutal pero muy adictivo 🎮" }
```

---

#### `GET /chat/history/:username`

Historial de conversación de un usuario.

#### `DELETE /chat/history/:username`

Borra el historial de un usuario.

---

### Channel Context

#### `GET /context/channel`

Devuelve el contexto actual del canal.

#### `PUT /context/channel`

Actualiza el contexto del canal. Todos los campos son opcionales.

```json
{
  "name": "string",
  "description": "string",
  "topics": ["string"],
  "language": "string",
  "links": { "key": "url" },
  "personality": "string (prompt base del sistema)"
}
```

---

### Users

#### `GET /context/users`

Todos los usuarios guardados.

#### `GET /context/users/:username`

Datos de un usuario concreto.

#### `PUT /context/users/:username`

Crea o actualiza un usuario.

```json
{
  "notes": "Viewer habitual, le encanta el speedrunning",
  "preferences": { "language": "es", "humor": "alto" },
  "tags": ["mod", "frecuente"]
}
```

#### `DELETE /context/users/:username`

Elimina los datos de un usuario.

---

### FAQs

#### `GET /context/faqs`

Lista todas las FAQs.

#### `POST /context/faqs`

Añade una FAQ.

```json
{
  "question": "¿Cuándo streameas?",
  "answer": "Todos los sábados a las 20:00 CET"
}
```

#### `PUT /context/faqs/:id`

Actualiza una FAQ por su ID.

#### `DELETE /context/faqs/:id`

Elimina una FAQ.

---

### Health

#### `GET /health`

Estado del servidor, modelo activo, uptime y modelos disponibles en Ollama.

---

## Almacenamiento de datos

Todo el contexto se guarda como JSON en el directorio `data/` (creado automáticamente):

| Archivo             | Contenido                             |
| ------------------- | ------------------------------------- |
| `data/channel.json` | Info del canal y personalidad         |
| `data/users.json`   | Perfiles de viewers frecuentes        |
| `data/faqs.json`    | Entradas FAQ                          |
| `data/history.json` | Historial de conversación por usuario |

---

## Cambiar de modelo

Para usar otro modelo de Ollama basta con cambiarlo en la variable de entorno:

```bash
# Descargar el nuevo modelo
ollama pull mistral

# Cambiar la variable y reiniciar
MODEL_NAME=mistral npm start
```

Modelos recomendados para live chat (respuestas rápidas): `llama3`, `mistral`, `gemma2`.
