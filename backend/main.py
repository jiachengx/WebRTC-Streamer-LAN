"""
Copyright (c) 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved.
This software is 100% owned and licensed by Stephen Hsu.
Unauthorized copying or distribution is strictly prohibited.

WebRTC Signaling Server - FastAPI + WebSocket
Multi-Sender / Multi-Receiver architecture with per-sender channels.
"""

import os
import json
import asyncio
import logging
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("signaling")

ALLOWED_ORIGINS: list[str] = os.getenv("ALLOWED_ORIGINS", "*").split(",")
LAN_IP: str = os.getenv("LAN_IP", "0.0.0.0")


# ---------------------------------------------------------------------------
# Security Middleware
# ---------------------------------------------------------------------------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "ALLOWALL"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=*, microphone=*"
        return response


app = FastAPI(title="WebRTC Signaling Server", version="2.0.0")
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Hub: manages multiple senders and receivers
# ---------------------------------------------------------------------------
class SignalingHub:
    def __init__(self):
        self.lock = asyncio.Lock()
        # sender_id -> { "ws": WebSocket, "label": str }
        self.senders: dict[str, dict] = {}
        # receiver set
        self.receivers: set[WebSocket] = set()

    # ── Sender management ─────────────────────────────
    async def add_sender(self, sender_id: str, ws: WebSocket, label: str = ""):
        async with self.lock:
            self.senders[sender_id] = {"ws": ws, "label": label}
        # Notify all receivers
        await self._broadcast_to_receivers(json.dumps({
            "type": "sender-joined",
            "senderId": sender_id,
            "label": label,
        }))
        # Also tell the new sender about all current receivers
        # (so sender can start offering)
        async with self.lock:
            has_receivers = len(self.receivers) > 0
        if has_receivers:
            try:
                await ws.send_text(json.dumps({
                    "type": "receivers-present",
                    "count": len(self.receivers),
                }))
            except Exception:
                pass

    async def remove_sender(self, sender_id: str):
        async with self.lock:
            self.senders.pop(sender_id, None)
        await self._broadcast_to_receivers(json.dumps({
            "type": "sender-left",
            "senderId": sender_id,
        }))

    # ── Receiver management ───────────────────────────
    async def add_receiver(self, ws: WebSocket):
        async with self.lock:
            self.receivers.add(ws)
            # Send current sender list to new receiver
            sender_list = [
                {"senderId": sid, "label": info["label"]}
                for sid, info in self.senders.items()
            ]
        await ws.send_text(json.dumps({
            "type": "sender-list",
            "senders": sender_list,
        }))
        # Notify all senders that a new receiver joined
        await self._broadcast_to_senders(json.dumps({
            "type": "receiver-joined",
        }))

    async def remove_receiver(self, ws: WebSocket):
        async with self.lock:
            self.receivers.discard(ws)

    # ── Message routing ───────────────────────────────
    async def relay_sender_to_receivers(self, sender_id: str, message: str):
        """Forward a sender's signaling message to ALL receivers,
        injecting senderId so receivers know which peer it's from."""
        try:
            parsed = json.loads(message)
            parsed["senderId"] = sender_id
            enriched = json.dumps(parsed)
        except (json.JSONDecodeError, TypeError):
            return

        async with self.lock:
            targets = list(self.receivers)
        for ws in targets:
            try:
                await ws.send_text(enriched)
            except Exception:
                pass

    async def relay_receiver_to_sender(self, sender_id: str, message: str):
        """Forward a receiver's signaling message to a specific sender."""
        async with self.lock:
            sender_info = self.senders.get(sender_id)
        if sender_info:
            try:
                await sender_info["ws"].send_text(message)
            except Exception:
                pass

    # ── Broadcast helpers ─────────────────────────────
    async def _broadcast_to_receivers(self, message: str):
        async with self.lock:
            targets = list(self.receivers)
        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                pass

    async def _broadcast_to_senders(self, message: str):
        async with self.lock:
            targets = [info["ws"] for info in self.senders.values()]
        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                pass

    async def get_sender_list(self) -> list[dict]:
        async with self.lock:
            return [
                {"senderId": sid, "label": info["label"]}
                for sid, info in self.senders.items()
            ]


hub = SignalingHub()


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "version": "2.0.0"})


@app.get("/api/senders")
async def list_senders():
    """List currently connected senders (for admin/debug)."""
    senders = await hub.get_sender_list()
    return JSONResponse({"senders": senders, "count": len(senders)})


# ---------------------------------------------------------------------------
# WebSocket: Sender endpoint
# /ws/sender?label=CamA  (optional label)
# ---------------------------------------------------------------------------
@app.websocket("/ws/sender")
async def ws_sender(websocket: WebSocket, label: str = ""):
    await websocket.accept()
    sender_id = str(uuid.uuid4())[:8]
    if not label:
        label = f"Cam-{sender_id[:4]}"

    logger.info(f"[sender:{sender_id}] connected as '{label}' from {websocket.client.host}")
    await hub.add_sender(sender_id, websocket, label)

    # Tell the sender its own ID
    await websocket.send_text(json.dumps({
        "type": "assigned-id",
        "senderId": sender_id,
        "label": label,
    }))

    try:
        while True:
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = parsed.get("type", "unknown")

            # Heartbeat
            if msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                continue
            if msg_type == "pong":
                continue

            # Label update
            if msg_type == "update-label":
                new_label = parsed.get("label", label)
                label = new_label
                async with hub.lock:
                    if sender_id in hub.senders:
                        hub.senders[sender_id]["label"] = new_label
                await hub._broadcast_to_receivers(json.dumps({
                    "type": "sender-label-updated",
                    "senderId": sender_id,
                    "label": new_label,
                }))
                continue

            logger.info(f"[sender:{sender_id}] -> {msg_type}")
            await hub.relay_sender_to_receivers(sender_id, data)

    except WebSocketDisconnect:
        logger.info(f"[sender:{sender_id}] disconnected")
    except Exception as e:
        logger.error(f"[sender:{sender_id}] error: {e}")
    finally:
        await hub.remove_sender(sender_id)


# ---------------------------------------------------------------------------
# WebSocket: Receiver endpoint
# /ws/receiver
# ---------------------------------------------------------------------------
@app.websocket("/ws/receiver")
async def ws_receiver(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"[receiver] connected from {websocket.client.host}")
    await hub.add_receiver(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = parsed.get("type", "unknown")

            if msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                continue
            if msg_type == "pong":
                continue

            # Receiver messages target a specific sender
            target_sender = parsed.get("senderId")
            if target_sender:
                logger.info(f"[receiver] -> {msg_type} -> sender:{target_sender}")
                await hub.relay_receiver_to_sender(target_sender, data)
            else:
                logger.warning(f"[receiver] message without senderId: {msg_type}")

    except WebSocketDisconnect:
        logger.info("[receiver] disconnected")
    except Exception as e:
        logger.error(f"[receiver] error: {e}")
    finally:
        await hub.remove_receiver(websocket)
