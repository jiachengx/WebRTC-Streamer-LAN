# WebRTC Streamer for OBS — Multi-Camera Edition

**Copyright © 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved.**

Multi-camera low-latency WebRTC streaming from mobile devices to OBS Studio over LAN.

## Architecture

```
┌─────────────┐
│  Phone A    │──WSS──┐
│  /sender    │       │
└─────────────┘       │    ┌──────────────────────────────────┐
┌─────────────┐       │    │  Docker Host                     │
│  Phone B    │──WSS──┼───▸│  ┌────────┐   ┌──────────────┐  │
│  /sender    │       │    │  │ Caddy  │───│ FastAPI Hub   │  │
└─────────────┘       │    │  │ :443   │   │ (Multi-Sender │  │
┌─────────────┐       │    │  │ (TLS)  │   │  Signaling)   │  │
│  Phone C    │──WSS──┘    │  │        │   └──────────────┘  │
│  /sender    │            │  │        │                      │
└─────────────┘            │  │        │   ┌──────────────┐  │
                           │  │        │───│ React SPA    │  │
┌─────────────┐   HTTPS    │  │        │   └──────────────┘  │
│  OBS Studio │───────────▸│  └────────┘                      │
│  /receiver  │            │      internal network             │
└─────────────┘            └──────────────────────────────────┘
```

## Quick Start (Windows)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; ./setup.ps1
```

## Usage

| URL | Purpose |
|-----|---------|
| `https://<IP>/sender` | Open on each phone |
| `https://<IP>/sender?label=CamA` | Open with custom label |
| `https://<IP>/receiver` | Grid view (all cameras) |
| `https://<IP>/receiver?solo=<ID>` | Solo view (one camera, for OBS scene) |
| `https://<IP>/api/senders` | List connected senders (JSON) |

### OBS Workflow

**Option A: Grid view** — one Browser Source showing all cameras in an auto-adapting grid. Double-click any cell to solo it.

**Option B: Per-camera sources** — add multiple Browser Sources, each with `/receiver?solo=<SENDER_ID>`. Get the sender ID from the sender's status bar or the `/api/senders` endpoint. Assign each to different OBS Scenes for switching.

**Option C: Hybrid** — use the grid for monitoring and solo sources for your live scenes.

### Sender Labels

Each phone gets an auto-generated label like `Cam-a1b2`. To set a custom label, open the sender URL with a query parameter: `/sender?label=FrontCam`. Labels appear in the receiver grid.

## Auto-Reconnect

Three-layer reconnect system:

1. **WebSocket heartbeat** — ping every 5s, reconnect if no pong within 12s
2. **Exponential backoff** — 0.5s → 1s → 2s → 4s → 15s retry intervals
3. **ICE recovery** — automatic ICE restart (×3), then full renegotiation

## Security

- Backend isolated on internal Docker network
- Only Caddy port 443 exposed to host
- HSTS, CSP, X-Content-Type-Options headers
- No hardcoded secrets (all via `.env`)

## File Structure

```
webrtc-streamer/
├── backend/
│   ├── Dockerfile
│   ├── main.py              # FastAPI Hub (multi-sender signaling)
│   └── requirements.txt
├── frontend/src/
│   ├── main.tsx
│   ├── App.tsx               # Router + home page
│   ├── SenderPage.tsx        # Mobile camera (with label + ID)
│   ├── ReceiverPage.tsx      # Multi-stream grid + solo mode
│   └── webrtc.ts             # Signaling + PeerConnection factory
├── Caddyfile
├── Dockerfile.caddy
├── docker-compose.yml
├── setup.ps1
└── README.md
```

## License

This software is 100% owned and licensed by Stephen Hsu.
Unauthorized copying or distribution is strictly prohibited.

--

# WebRTC Streamer (LAN Deployment)

A lightweight WebRTC streaming solution with FastAPI backend and Caddy reverse proxy, designed for local network (LAN) usage.

## Features

- WebRTC real-time streaming
- FastAPI signaling server
- Caddy reverse proxy
- Docker-based deployment
- Simple HTTP mode (no TLS issues)
- WebSocket support

## Architecture

- **Frontend**: Static files served by Caddy
- **Backend**: FastAPI (Uvicorn)
- **Proxy**: Caddy
- **Containerization**: Docker Compose

## Getting Started

### Prerequisites

- Docker
- Docker Compose

### Run

```bash
docker compose up -d --build
