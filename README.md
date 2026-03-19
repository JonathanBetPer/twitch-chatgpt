# YouTube + NightBot + Ollama API

API sencilla para conectar NightBot de YouTube con una IA local en Ollama.
Pensada para servidores Linux (incluido ARM sin GPU), con enfoque de seguridad y aprendizaje semi-automatico por cola de aprobacion.

Estado actual: este proyecto es **API-only**. No incluye dashboard web, vistas EJS ni assets `public/`.

## Que hace este proyecto

- Responde mensajes de chat con IA local (`/gpt`) compatible con `$(urlfetch ...)` de NightBot.
- Usa contexto del canal para mejorar respuestas (descripcion, temas, links, personalidad).
- Guarda memoria por usuario y FAQs.
- Registra historial por viewer.
- Crea una cola de aprendizaje (`pending`) para aprobar/rechazar informacion antes de usarla.
- Expone endpoints REST para administrar todo.

## Requisitos

- Docker + Docker Compose (recomendado)
- o Node.js 20+ y Ollama instalado en host
- 24 GB RAM (tu caso) recomendado para modelos pequenos/medianos

## Quick Start (Docker)

```bash
cp .env.example .env
# Edita tokens y modelo

docker compose build
docker compose up -d ollama
docker compose run --rm ollama-pull
docker compose up -d yt-chatbot
```

Verificacion:

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/gpt/testUser:Hola?token=TU_TOKEN"
```

## HTTPS con Caddy (recomendado para produccion)

1) En `.env` define:

```env
DOMAIN=tu-dominio.com
ACME_EMAIL=tu-email@dominio.com
```

2) Asegura DNS del dominio apuntando al servidor y puertos `80/443` abiertos.

3) Levanta proxy TLS:

```bash
docker compose up -d caddy
```

4) Prueba endpoint publico:

```bash
curl "https://tu-dominio.com/health?token=TU_TOKEN"
```

NightBot:

```text
$(urlfetch https://tu-dominio.com/gpt/"$(user):$(query)"?token=TU_TOKEN)
```

## Variables de entorno

Ejemplo completo en `.env.example`.

| Variable | Default | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto de la API |
| `OLLAMA_URL` | `http://ollama:11434` | URL de Ollama |
| `MODEL_NAME` | `llama3.2:3b` | Modelo |
| `HISTORY_LENGTH` | `8` | Turns historicos por usuario |
| `DOMAIN` | `example.com` | Dominio para HTTPS con Caddy |
| `ACME_EMAIL` | `you@example.com` | Email para certificados TLS |
| `PUID` | `1000` | UID del usuario host para escribir `./data` |
| `PGID` | `1000` | GID del usuario host para escribir `./data` |
| `NIGHTBOT_TOKEN` | `change_me_long_secret` | Token obligatorio para `/gpt` |
| `TRUST_PROXY` | `false` | Si hay reverse proxy |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Ventana rate-limit |
| `RATE_LIMIT_MAX` | `20` | Max requests por IP y ventana |
| `OLLAMA_TIMEOUT_MS` | `12000` | Timeout hacia Ollama |
| `OLLAMA_TEMPERATURE` | `0.6` | Creatividad |
| `OLLAMA_NUM_PREDICT` | `96` | Longitud de respuesta |
| `OLLAMA_REPEAT_PENALTY` | `1.1` | Penalizacion de repeticion |

## Integracion NightBot

Comando recomendado:

```text
$(urlfetch https://TU_DOMINIO/gpt/"$(user):$(query)"?token=TU_TOKEN)
```

Comportamiento:

- Token invalido -> `401 Unauthorized`
- Token valido pero modelo no listo -> `502 AI unavailable`
- Todo OK -> respuesta en texto plano (sin JSON)

## Flujo de aprendizaje (sin fine-tuning)

Este proyecto no reentrena pesos del modelo. Aprende por contexto persistente:

1. Guardas contexto del canal.
2. Guardas FAQs y notas de usuarios.
3. El sistema propone candidatos en `learning_queue`.
4. Tu apruebas/rechazas manualmente.
5. Solo lo aprobado entra al contexto real.

Esto es mas seguro y controlable para chat en directo.

## Endpoints principales

### Chat NightBot

- `GET /gpt/:input?token=...`
- `GET /gpt?input=user:mensaje&token=...`

Respuesta: `text/plain`.

### Chat REST

- `POST /chat`
  - Body:
    ```json
    { "username": "viewer123", "message": "que juego es?" }
    ```
  - Response:
    ```json
    { "response": "Respuesta corta..." }
    ```

### Historial

- `GET /chat/history/:username`
- `DELETE /chat/history/:username`

### Contexto del canal

- `GET /context/channel`
- `PUT /context/channel`

Ejemplo:

```bash
curl -X PUT http://localhost:3000/context/channel \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi Canal",
    "description": "Streams de tech y gaming",
    "topics": ["tech", "gaming", "tutoriales"],
    "language": "es",
    "links": {
      "youtube": "https://youtube.com/@micanal",
      "discord": "https://discord.gg/xxxxx"
    },
    "personality": "Responde breve, en espanol, con tono amigable."
  }'
```

### Usuarios

- `GET /context/users`
- `GET /context/users/:username`
- `PUT /context/users/:username`
- `DELETE /context/users/:username`

Ejemplo:

```bash
curl -X PUT http://localhost:3000/context/users/viewer123 \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Le gusta speedrun y soulslikes",
    "preferences": { "language": "es", "humor": "alto" },
    "tags": ["frecuente"]
  }'
```

### FAQs

- `GET /context/faqs`
- `POST /context/faqs`
- `PUT /context/faqs/:id`
- `DELETE /context/faqs/:id`

Ejemplo:

```bash
curl -X POST http://localhost:3000/context/faqs \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Cuando hay directo?",
    "answer": "Sabados 20:00 CET"
  }'
```

### Learning Queue

Requiere `NIGHTBOT_TOKEN` (query `?token=` o header `x-nightbot-token`).

- `GET /learning/queue?status=pending`
- `POST /learning/queue/:id/approve`
- `POST /learning/queue/:id/reject`

Ejemplos:

```bash
curl -H "x-nightbot-token: TU_TOKEN" \
  "http://localhost:3000/learning/queue?status=pending"
```

```bash
curl -X POST -H "x-nightbot-token: TU_TOKEN" \
  "http://localhost:3000/learning/queue/ID_ITEM/approve"
```

```bash
curl -X POST -H "x-nightbot-token: TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"ruido o spam"}' \
  "http://localhost:3000/learning/queue/ID_ITEM/reject"
```

### Health

- `GET /health`

Ejemplo:

```bash
curl "http://localhost:3000/health?token=TU_TOKEN"
```

## Estructura de datos persistente

Se guarda en `data/`:

- `data/channel.json`
- `data/users.json`
- `data/faqs.json`
- `data/history.json`
- `data/learning_queue.json`

## Modelos recomendados (ARM sin GPU)

- `llama3.2:3b` (equilibrado)
- `gemma2:2b` (mas ligero)
- `mistral:7b` (mas calidad, mas latencia)

Cambio rapido de modelo:

```bash
# en .env
MODEL_NAME=gemma2:2b

docker exec -it ollama ollama pull gemma2:2b
docker compose restart yt-chatbot
```

## Troubleshooting

### `Unauthorized` en `/gpt`

- Token no coincide con `NIGHTBOT_TOKEN` cargado en contenedor.
- Revisa `.env` y reinicia:
  ```bash
  docker compose up -d --force-recreate yt-chatbot
  ```

### `AI unavailable`

- Ollama reachable pero modelo no descargado.
- Pull manual:
  ```bash
  docker exec -it ollama ollama pull llama3.2:3b
  ```

### `EACCES: permission denied, open '/app/data/channel.json'`

- El bind mount `./data:/app/data` no tiene permisos para el usuario del contenedor.
- Alinea UID/GID en `.env` y corrige permisos:
  ```bash
  mkdir -p data
  sudo chown -R 1000:1000 data
  sudo chmod -R u+rwX data
  docker compose up -d --force-recreate yt-chatbot
  ```

### `lookup registry.ollama.ai ... server misbehaving`

- Problema DNS del contenedor Ollama.
- Ya hay `dns` publico en `docker-compose.yml`.
- Reinicia stack:
  ```bash
  docker compose down
  docker compose up -d ollama
  ```

### Docker permission denied (`/var/run/docker.sock`)

```bash
sudo usermod -aG docker $USER
newgrp docker
docker version
```

## Seguridad recomendada

- Usa HTTPS (Nginx/Caddy/Traefik) delante de la API.
- Manten `NIGHTBOT_TOKEN` largo y privado.
- Rota el token periodicamente.
- No expongas la API publicamente sin control adicional (IP allowlist/reverse proxy).

## Licencia

ISC
