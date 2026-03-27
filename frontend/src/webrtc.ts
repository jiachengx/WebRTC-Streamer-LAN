/* Copyright (c) 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved. */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type SignalingMessage =
  | { type: 'offer'; sdp: string; senderId?: string }
  | { type: 'answer'; sdp: string; senderId?: string }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit; senderId?: string }
  | { type: 'assigned-id'; senderId: string; label: string }
  | { type: 'sender-joined'; senderId: string; label: string }
  | { type: 'sender-left'; senderId: string }
  | { type: 'sender-list'; senders: Array<{ senderId: string; label: string }> }
  | { type: 'sender-label-updated'; senderId: string; label: string }
  | { type: 'receiver-joined' }
  | { type: 'receivers-present'; count: number }
  | { type: 'reconnect-request'; senderId?: string; role: string }
  | { type: 'update-label'; label: string }
  | { type: 'ping' }
  | { type: 'pong' };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed' | 'reconnecting';
export type ICEState = 'new' | 'checking' | 'connected' | 'completed' | 'disconnected' | 'failed' | 'closed';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

const RECONNECT_DELAYS_MS   = [500, 1000, 2000, 4000, 8000, 15000];
const HEARTBEAT_INTERVAL_MS  = 5000;
const HEARTBEAT_TIMEOUT_MS   = 12000;
const ICE_RESTART_DELAY_MS   = 2000;
const MAX_ICE_RESTARTS       = 3;

// ---------------------------------------------------------------------------
// Signaling Client (shared by sender and receiver)
// ---------------------------------------------------------------------------
export class SignalingClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private wasConnectedBefore = false;

  public onMessage: ((msg: SignalingMessage) => void) | null = null;
  public onStateChange: ((state: ConnectionState) => void) | null = null;
  public onReconnected: (() => void) | null = null;

  constructor(private url: string) {}

  connect(): void {
    if (this.closed) return;
    this.clearTimers();
    this.setState(this.wasConnectedBefore ? 'reconnecting' : 'connecting');

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState('connected');
      this.startHeartbeat();
      if (this.wasConnectedBefore) this.onReconnected?.();
      this.wasConnectedBefore = true;
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as SignalingMessage;
        if (msg.type === 'pong') { this.clearPongTimeout(); return; }
        if (msg.type === 'ping') { this.send({ type: 'pong' }); return; }
        this.onMessage?.(msg);
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setState('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => { this.ws?.close(); };
  }

  send(msg: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  get isOpen(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.stopHeartbeat();
    this.ws?.close();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.send({ type: 'ping' });
      this.pongTimer = setTimeout(() => { this.ws?.close(); }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.clearPongTimeout();
  }

  private clearPongTimeout(): void {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  private setState(state: ConnectionState): void { this.onStateChange?.(state); }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const idx = Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[idx];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------
export function getSenderSignalingUrl(label?: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const q = label ? `?label=${encodeURIComponent(label)}` : '';
  return `${proto}://${window.location.host}/ws/sender${q}`;
}

export function getReceiverSignalingUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/receiver`;
}

// ---------------------------------------------------------------------------
// PeerConnection factory with ICE restart + renegotiation
// ---------------------------------------------------------------------------
export interface PeerConnectionOptions {
  signaling: SignalingClient;
  senderId?: string;                         // attached to outgoing messages
  onTrack?: (stream: MediaStream) => void;
  onICEStateChange?: (state: ICEState) => void;
  onNeedRenegotiation?: () => void;
}

export function createPeerConnection(opts: PeerConnectionOptions): RTCPeerConnection {
  const { signaling, senderId, onTrack, onICEStateChange, onNeedRenegotiation } = opts;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let iceRestartCount = 0;
  let iceRestartTimer: ReturnType<typeof setTimeout> | null = null;

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      signaling.send({ type: 'ice-candidate', candidate: ev.candidate.toJSON(), senderId });
    }
  };

  pc.ontrack = (ev) => { if (onTrack && ev.streams[0]) onTrack(ev.streams[0]); };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState as ICEState;
    onICEStateChange?.(state);

    if (state === 'connected' || state === 'completed') iceRestartCount = 0;

    if (state === 'disconnected') {
      iceRestartTimer = setTimeout(async () => {
        if (pc.iceConnectionState !== 'disconnected') return;
        if (iceRestartCount < MAX_ICE_RESTARTS) {
          iceRestartCount++;
          try {
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            signaling.send({ type: 'offer', sdp: offer.sdp!, senderId });
          } catch { onNeedRenegotiation?.(); }
        } else {
          onNeedRenegotiation?.();
        }
      }, ICE_RESTART_DELAY_MS);
    }

    if (state === 'failed') {
      if (iceRestartTimer) clearTimeout(iceRestartTimer);
      onNeedRenegotiation?.();
    }
  };

  return pc;
}

// ---------------------------------------------------------------------------
// SDP helpers
// ---------------------------------------------------------------------------
export async function createOffer(pc: RTCPeerConnection, signaling: SignalingClient, senderId?: string): Promise<void> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signaling.send({ type: 'offer', sdp: offer.sdp!, senderId });
}

export async function handleOffer(pc: RTCPeerConnection, sdp: string, signaling: SignalingClient, senderId?: string): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signaling.send({ type: 'answer', sdp: answer.sdp!, senderId });
}

export async function handleAnswer(pc: RTCPeerConnection, sdp: string): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
}

export async function handleIceCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
  try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ }
}
