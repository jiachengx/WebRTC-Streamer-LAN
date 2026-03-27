```markdown
# WebRTC Streamer for OBS — Multi-Camera Edition

**Copyright © 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved.**

Multi-camera low-latency WebRTC streaming from mobile devices to OBS Studio over LAN.

> ⚠️ This project currently runs in **HTTP mode (no TLS)** for simplicity in LAN environments.

---

## Architecture

```

Phones (/sender) ──WS──┐
│
▼
┌──────────────────────┐
│   Docker Host        │
│                      │
│   Caddy (:80 HTTP)   │
│        │             │
│        ▼             │
│   FastAPI (8000)     │
│                      │
│   React Frontend     │
└──────────────────────┘
▲
│
HTTP (OBS /receiver)

````

---

## Quick Start (Windows)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; ./setup.ps1
docker compose up -d --build
````

---

## Usage

| URL                              | Purpose            |
| -------------------------------- | ------------------ |
| `http://<IP>/sender`             | Open on each phone |
| `http://<IP>/sender?label=CamA`  | Custom label       |
| `http://<IP>/receiver`           | Grid view          |
| `http://<IP>/receiver?solo=<ID>` | Solo camera        |
| `http://<IP>/api/senders`        | JSON list          |

---

## ⚠️ Important Notes (HTTP Mode)

* Browsers may restrict **camera/microphone access over HTTP**
* Recommended:

  * Use **Chrome / Edge**
  * Access via `http://<LAN-IP>` (not localhost for phones)
* HTTPS is required for production or internet deployment

---

## OBS Workflow

**Option A: Grid view**

* One Browser Source
* Auto layout for all cameras
* Double-click to solo

**Option B: Per-camera**

* Multiple Browser Sources
* `/receiver?solo=<ID>`

**Option C: Hybrid**

* Grid for monitoring
* Solo for live scenes

---

## Auto-Reconnect

* WebSocket heartbeat (5s)
* Exponential retry (0.5s → 15s)
* ICE restart + renegotiation

---

## Security

* Backend isolated in Docker network
* Only HTTP port 80 exposed
* No secrets in code

---

## File Structure

```
webrtc-streamer/
├── backend/
├── frontend/
├── Caddyfile
├── docker-compose.yml
├── setup.ps1
└── README.md
```

---

## License

MIT License

---

## Author

Stephen Hsu
[chiacheng.hsu@owasp.org](mailto:chiacheng.hsu@owasp.org)

👉 ⭐「GitHub 封面等級 README（含圖片 + demo）」
```
