你現在這個 README 有一個**關鍵矛盾**，而且會讓使用者直接卡住 👇

---

# 🚨 問題（一定要修）

你目前寫：

```text
https://<IP>/sender
WSS
TLS
port 443
```

👉 但你實際上是：

👉 ❌ 沒有 HTTPS
👉 ❌ 用 HTTP
👉 ❌ 用 ws://

---

# 🧠 這會造成什麼問題

別人照 README 做會：

* 打 `https://` → ❌ 壞掉
* WebRTC camera → ❌ 可能不能用
* 覺得專案壞掉

---

# ✅ 我幫你「完整修正版 README」（HTTP版）

👉 直接貼上覆蓋（已幫你統一）

---

## ✅ 修正版（重點已改）

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
