/* Copyright (c) 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved. */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  SignalingClient,
  ConnectionState,
  getReceiverSignalingUrl,
  createPeerConnection,
  handleOffer,
  handleIceCandidate,
} from './webrtc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SenderSlot {
  senderId: string;
  label: string;
  stream: MediaStream | null;
  pc: RTCPeerConnection | null;
  iceState: string;
}

// ---------------------------------------------------------------------------
// URL params:  /receiver?solo=<senderId>  → show only one sender (for OBS)
//              /receiver                  → grid mode with switcher
// ---------------------------------------------------------------------------
function getSoloParam(): string | null {
  return new URLSearchParams(window.location.search).get('solo');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ReceiverPage() {
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [senders, setSenders] = useState<Map<string, SenderSlot>>(new Map());
  const [soloId, setSoloId] = useState<string | null>(getSoloParam());
  const [reconnectCount, setReconnectCount] = useState(0);

  const signalingRef = useRef<SignalingClient | null>(null);
  const sendersRef = useRef<Map<string, SenderSlot>>(new Map());

  // Keep ref in sync with state
  const updateSenders = useCallback((fn: (map: Map<string, SenderSlot>) => Map<string, SenderSlot>) => {
    sendersRef.current = fn(new Map(sendersRef.current));
    setSenders(new Map(sendersRef.current));
  }, []);

  // ── Build a PeerConnection for a specific sender ──
  const buildPCForSender = useCallback((senderId: string, signaling: SignalingClient) => {
    // Close existing PC for this sender
    const existing = sendersRef.current.get(senderId);
    if (existing?.pc) { existing.pc.close(); }

    const pc = createPeerConnection({
      signaling,
      senderId,
      onTrack: (stream) => {
        updateSenders((m) => {
          const slot = m.get(senderId);
          if (slot) slot.stream = stream;
          return m;
        });
      },
      onICEStateChange: (state) => {
        updateSenders((m) => {
          const slot = m.get(senderId);
          if (slot) slot.iceState = state;
          return m;
        });
      },
      onNeedRenegotiation: () => {
        setReconnectCount((c) => c + 1);
        signaling.send({ type: 'reconnect-request', senderId, role: 'receiver' });
      },
    });

    updateSenders((m) => {
      const slot = m.get(senderId);
      if (slot) slot.pc = pc;
      return m;
    });

    return pc;
  }, [updateSenders]);

  // ── Handle incoming offer from a sender ────────────
  const handleIncomingOffer = useCallback(async (
    senderId: string, sdp: string, signaling: SignalingClient
  ) => {
    // Ensure sender slot exists
    if (!sendersRef.current.has(senderId)) {
      updateSenders((m) => {
        m.set(senderId, { senderId, label: senderId, stream: null, pc: null, iceState: 'new' });
        return m;
      });
    }

    // Check if existing PC can handle ICE restart
    const slot = sendersRef.current.get(senderId);
    if (slot?.pc && slot.pc.remoteDescription) {
      try {
        await slot.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        const answer = await slot.pc.createAnswer();
        await slot.pc.setLocalDescription(answer);
        signaling.send({ type: 'answer', sdp: answer.sdp!, senderId });
        return;
      } catch { /* fall through to new PC */ }
    }

    const pc = buildPCForSender(senderId, signaling);
    await handleOffer(pc, sdp, signaling, senderId);
  }, [buildPCForSender, updateSenders]);

  // ── Connect ────────────────────────────────────────
  const connect = useCallback(() => {
    signalingRef.current?.close();
    // Clean up all existing PCs
    sendersRef.current.forEach((slot) => slot.pc?.close());
    sendersRef.current = new Map();
    setSenders(new Map());

    const signaling = new SignalingClient(getReceiverSignalingUrl());
    signalingRef.current = signaling;
    signaling.onStateChange = (state) => setConnState(state);

    signaling.onReconnected = () => {
      setReconnectCount((c) => c + 1);
      // PCs are stale — clear streams, wait for new sender-list + offers
      updateSenders((m) => {
        m.forEach((slot) => {
          slot.pc?.close();
          slot.pc = null;
          slot.stream = null;
          slot.iceState = 'new';
        });
        return m;
      });
    };

    signaling.onMessage = async (msg) => {
      switch (msg.type) {
        case 'sender-list': {
          // Initial list of connected senders
          updateSenders((m) => {
            const newMap = new Map<string, SenderSlot>();
            for (const s of (msg as any).senders) {
              const existing = m.get(s.senderId);
              newMap.set(s.senderId, existing || {
                senderId: s.senderId, label: s.label,
                stream: null, pc: null, iceState: 'new',
              });
            }
            return newMap;
          });
          break;
        }
        case 'sender-joined': {
          const { senderId, label } = msg as any;
          updateSenders((m) => {
            if (!m.has(senderId)) {
              m.set(senderId, { senderId, label, stream: null, pc: null, iceState: 'new' });
            }
            return m;
          });
          break;
        }
        case 'sender-left': {
          const { senderId } = msg as any;
          const slot = sendersRef.current.get(senderId);
          if (slot?.pc) slot.pc.close();
          updateSenders((m) => { m.delete(senderId); return m; });
          break;
        }
        case 'sender-label-updated': {
          const { senderId, label } = msg as any;
          updateSenders((m) => {
            const slot = m.get(senderId);
            if (slot) slot.label = label;
            return m;
          });
          break;
        }
        case 'offer': {
          const { senderId, sdp } = msg as any;
          if (senderId && sdp) {
            await handleIncomingOffer(senderId, sdp, signaling);
          }
          break;
        }
        case 'ice-candidate': {
          const { senderId, candidate } = msg as any;
          const slot = sendersRef.current.get(senderId);
          if (slot?.pc) await handleIceCandidate(slot.pc, candidate);
          break;
        }
      }
    };

    signaling.connect();
  }, [handleIncomingOffer, updateSenders]);

  useEffect(() => {
    connect();
    return () => {
      sendersRef.current.forEach((slot) => slot.pc?.close());
      signalingRef.current?.close();
    };
  }, [connect]);

  // ── Layout helpers ─────────────────────────────────
  const senderArray = Array.from(senders.values());
  const visibleSenders = soloId
    ? senderArray.filter((s) => s.senderId === soloId)
    : senderArray;

  const gridCols = visibleSenders.length <= 1 ? 1
    : visibleSenders.length <= 4 ? 2
    : visibleSenders.length <= 9 ? 3
    : 4;

  const stateColor: Record<ConnectionState, string> = {
    disconnected:'#ff4444', connecting:'#ffaa00', connected:'#00cc66',
    failed:'#ff4444', reconnecting:'#ff8800',
  };

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        video::-webkit-media-controls { display:none !important; }
      `}</style>

      {/* Grid / Solo view */}
      {visibleSenders.length === 0 ? (
        <div style={styles.emptyOverlay}>
          <div style={styles.spinner} />
          <span style={styles.emptyTitle}>Waiting for senders…</span>
          <span style={styles.emptyHint}>
            Open <code style={styles.code}>/sender</code> on mobile devices
          </span>
          {senderArray.length > 0 && soloId && (
            <button onClick={() => setSoloId(null)} style={styles.backBtn}>
              ← Back to grid
            </button>
          )}
        </div>
      ) : (
        <div style={{
          ...styles.grid,
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        }}>
          {visibleSenders.map((slot) => (
            <VideoCell
              key={slot.senderId}
              slot={slot}
              isSolo={soloId !== null}
              onClickSolo={() => setSoloId(soloId ? null : slot.senderId)}
            />
          ))}
        </div>
      )}

      {/* Bottom bar: status + sender switcher */}
      <div style={styles.bottomBar}>
        <div style={styles.statusRow}>
          <div style={{ ...styles.dot, backgroundColor: stateColor[connState] }} />
          <span style={styles.mono}>{connState.toUpperCase()}</span>
          <span style={styles.mono}>{senderArray.length} sender{senderArray.length !== 1 ? 's' : ''}</span>
          {reconnectCount > 0 && <span style={{ ...styles.mono, color:'#ff8800' }}>↻{reconnectCount}</span>}
        </div>
        {senderArray.length > 1 && (
          <div style={styles.switcherRow}>
            <button
              onClick={() => setSoloId(null)}
              style={{ ...styles.switchBtn, ...(soloId === null ? styles.switchBtnActive : {}) }}
            >
              Grid
            </button>
            {senderArray.map((s) => (
              <button
                key={s.senderId}
                onClick={() => setSoloId(s.senderId)}
                style={{
                  ...styles.switchBtn,
                  ...(soloId === s.senderId ? styles.switchBtnActive : {}),
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video Cell sub-component
// ---------------------------------------------------------------------------
function VideoCell({ slot, isSolo, onClickSolo }: {
  slot: SenderSlot; isSolo: boolean;
  onClickSolo: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && slot.stream) {
      videoRef.current.srcObject = slot.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [slot.stream]);

  const iceColor: Record<string, string> = {
    new:'#666', checking:'#ffaa00', connected:'#00cc66', completed:'#00cc66',
    disconnected:'#ff8800', failed:'#ff4444', closed:'#666',
  };

  return (
    <div style={styles.cell} onDoubleClick={onClickSolo}>
      <video
        ref={videoRef}
        autoPlay playsInline muted
        style={styles.cellVideo}
      />
      {!slot.stream && (
        <div style={styles.cellWaiting}>
          <div style={{ ...styles.spinner, width:'20px', height:'20px', borderWidth:'2px' }} />
          <span style={{ ...styles.mono, fontSize:'10px' }}>Negotiating…</span>
        </div>
      )}
      {/* Label badge */}
      <div style={styles.cellBadge}>
        <div style={{ ...styles.dot, backgroundColor: iceColor[slot.iceState] || '#666' }} />
        <span style={{ ...styles.mono, fontSize:'10px' }}>{slot.label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  container: {
    width:'100vw', height:'100vh', backgroundColor:'#000',
    display:'flex', flexDirection:'column', overflow:'hidden',
  },
  grid: {
    flex:1, display:'grid', gap:'2px', backgroundColor:'#111',
  },
  cell: {
    position:'relative', backgroundColor:'#000', overflow:'hidden', cursor:'pointer',
  },
  cellVideo: {
    width:'100%', height:'100%', objectFit:'contain', backgroundColor:'#000',
  },
  cellWaiting: {
    position:'absolute', inset:0, display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center', gap:'8px',
    backgroundColor:'rgba(0,0,0,0.7)',
  },
  cellBadge: {
    position:'absolute', top:'4px', left:'4px', display:'flex', alignItems:'center',
    gap:'4px', backgroundColor:'rgba(0,0,0,0.6)', padding:'3px 8px', borderRadius:'4px',
    zIndex:5,
  },
  emptyOverlay: {
    flex:1, display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'center', gap:'16px',
  },
  spinner: {
    width:'32px', height:'32px', border:'3px solid #222', borderTopColor:'#7b68ee',
    borderRadius:'50%', animation:'spin 1s linear infinite',
  },
  emptyTitle: {
    fontFamily:"'Outfit',sans-serif", fontSize:'18px', color:'#ccc', fontWeight:300,
  },
  emptyHint: {
    fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', color:'#666',
  },
  code: {
    backgroundColor:'#1a1a2e', padding:'2px 6px', borderRadius:'3px', color:'#7b68ee',
  },
  backBtn: {
    marginTop:'8px', padding:'6px 16px', border:'1px solid #333', borderRadius:'6px',
    backgroundColor:'transparent', color:'#888', cursor:'pointer',
    fontFamily:"'JetBrains Mono',monospace", fontSize:'11px',
  },
  bottomBar: {
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'6px 12px', backgroundColor:'rgba(0,0,0,0.8)', borderTop:'1px solid #1a1a2e',
    flexWrap:'wrap', gap:'6px',
  },
  statusRow: {
    display:'flex', alignItems:'center', gap:'8px',
  },
  switcherRow: {
    display:'flex', gap:'4px', flexWrap:'wrap',
  },
  switchBtn: {
    padding:'3px 10px', border:'1px solid #2a2a3e', borderRadius:'4px',
    backgroundColor:'transparent', color:'#888', cursor:'pointer',
    fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', transition:'all 0.15s',
  },
  switchBtnActive: {
    backgroundColor:'#1a1a3e', color:'#7b68ee', borderColor:'#7b68ee',
  },
  dot: { width:'6px', height:'6px', borderRadius:'50%', flexShrink:0 },
  mono: { fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#888', letterSpacing:'1px' },
};
