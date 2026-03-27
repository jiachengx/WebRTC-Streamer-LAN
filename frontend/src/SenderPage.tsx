/* Copyright (c) 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved. */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  SignalingClient,
  ConnectionState,
  ICEState,
  getSenderSignalingUrl,
  createPeerConnection,
  createOffer,
  handleAnswer,
  handleIceCandidate,
} from './webrtc';

const VIDEO_CONSTRAINTS: Record<string, MediaTrackConstraints> = {
  high:   { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  medium: { width: { ideal: 1280 }, height: { ideal: 720  }, frameRate: { ideal: 30 } },
  low:    { width: { ideal: 640  }, height: { ideal: 480  }, frameRate: { ideal: 24 } },
};

export default function SenderPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [iceState, setIceState] = useState<ICEState>('new');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [myId, setMyId] = useState<string>('');
  const [myLabel, setMyLabel] = useState<string>('');

  // Read label from URL: /sender?label=CamA
  const urlLabel = new URLSearchParams(window.location.search).get('label') || '';

  const signalingRef = useRef<SignalingClient | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const senderIdRef = useRef<string>('');

  const getMediaStream = useCallback(async (facing: 'user' | 'environment', q: string) => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...VIDEO_CONSTRAINTS[q], facingMode: facing },
        audio: false,
      });
    } catch (e: any) {
      setError(`Camera access failed: ${e.message}`);
      return null;
    }
  }, []);

  const buildPeerAndOffer = useCallback((signaling: SignalingClient, stream: MediaStream) => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }

    const pc = createPeerConnection({
      signaling,
      senderId: senderIdRef.current,
      onICEStateChange: (state) => setIceState(state),
      onNeedRenegotiation: () => {
        setReconnectCount((c) => c + 1);
        buildPeerAndOffer(signaling, stream);
      },
    });
    pcRef.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    createOffer(pc, signaling, senderIdRef.current).catch(console.error);
  }, []);

  const startStreaming = useCallback(async () => {
    setError(null);
    const stream = await getMediaStream(facingMode, quality);
    if (!stream) return;
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;

    const signaling = new SignalingClient(getSenderSignalingUrl(urlLabel));
    signalingRef.current = signaling;
    signaling.onStateChange = (state) => setConnState(state);

    signaling.onReconnected = () => {
      setReconnectCount((c) => c + 1);
      if (streamRef.current) buildPeerAndOffer(signaling, streamRef.current);
    };

    signaling.onMessage = async (msg) => {
      switch (msg.type) {
        case 'assigned-id':
          senderIdRef.current = msg.senderId;
          setMyId(msg.senderId);
          setMyLabel(msg.label);
          break;
        case 'answer':
          if (pcRef.current) await handleAnswer(pcRef.current, msg.sdp);
          break;
        case 'ice-candidate':
          if (pcRef.current) await handleIceCandidate(pcRef.current, msg.candidate);
          break;
        case 'receiver-joined':
        case 'receivers-present':
          if (streamRef.current) buildPeerAndOffer(signaling, streamRef.current);
          break;
        case 'reconnect-request':
          if (streamRef.current) {
            setReconnectCount((c) => c + 1);
            buildPeerAndOffer(signaling, streamRef.current);
          }
          break;
      }
    };

    signaling.connect();
    setStreaming(true);
  }, [facingMode, quality, getMediaStream, buildPeerAndOffer, urlLabel]);

  const stopStreaming = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    signalingRef.current?.close();
    pcRef.current = null; signalingRef.current = null; streamRef.current = null;
    setStreaming(false); setConnState('disconnected'); setIceState('new');
    setReconnectCount(0); setMyId(''); setMyLabel('');
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const toggleCamera = useCallback(async () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacing);
    if (streaming && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      const newStream = await getMediaStream(newFacing, quality);
      if (!newStream) return;
      streamRef.current = newStream;
      if (videoRef.current) videoRef.current.srcObject = newStream;
      if (pcRef.current) {
        const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
        const track = newStream.getVideoTracks()[0];
        if (sender && track) await sender.replaceTrack(track);
      }
    }
  }, [facingMode, quality, streaming, getMediaStream]);

  useEffect(() => () => { stopStreaming(); }, [stopStreaming]);

  const stateColor: Record<ConnectionState, string> = {
    disconnected:'#ff4444', connecting:'#ffaa00', connected:'#00cc66',
    failed:'#ff4444', reconnecting:'#ff8800',
  };
  const iceColor: Record<string, string> = {
    new:'#666', checking:'#ffaa00', connected:'#00cc66', completed:'#00cc66',
    disconnected:'#ff8800', failed:'#ff4444', closed:'#666',
  };

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      {/* Status */}
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          <div style={{ ...styles.statusDot, backgroundColor: stateColor[connState] }} />
          <span style={styles.statusText}>{connState.toUpperCase()}</span>
          <span style={{ ...styles.statusText, color: iceColor[iceState] || '#666' }}>ICE:{iceState}</span>
        </div>
        <div style={styles.statusRight}>
          {myId && <span style={styles.idBadge}>{myLabel || myId}</span>}
          {reconnectCount > 0 && <span style={styles.reconnectBadge}>↻{reconnectCount}</span>}
          <span style={styles.roleTag}>SENDER</span>
        </div>
      </div>

      {/* Video */}
      <div style={styles.videoContainer}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ ...styles.video, transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
        {!streaming && (
          <div style={styles.placeholder}>
            <span style={{ fontSize:'48px' }}>📷</span>
            <span style={styles.monoSmall}>Camera Preview</span>
          </div>
        )}
        {streaming && connState === 'reconnecting' && (
          <div style={styles.reconnectOverlay}><span style={styles.monoSmall}>RECONNECTING…</span></div>
        )}
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.qualityRow}>
          {(['low','medium','high'] as const).map((q) => (
            <button key={q} onClick={() => setQuality(q)}
              style={{ ...styles.qualityBtn, ...(quality === q ? styles.qualityBtnActive : {}) }}>
              {q === 'low' ? '480p' : q === 'medium' ? '720p' : '1080p'}
            </button>
          ))}
        </div>
        <div style={styles.actionRow}>
          <button onClick={toggleCamera} style={styles.iconBtn} disabled={!streaming}>🔄</button>
          <button onClick={streaming ? stopStreaming : startStreaming}
            style={{ ...styles.mainBtn, backgroundColor: streaming ? '#ff4444' : '#00cc66' }}>
            {streaming ? 'STOP' : 'START'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:{ minHeight:'100dvh', backgroundColor:'#0a0a0f', display:'flex', flexDirection:'column', fontFamily:"'Outfit',sans-serif", color:'#e0e0e0' },
  statusBar:{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px', borderBottom:'1px solid #1a1a2e', flexWrap:'wrap', gap:'4px' },
  statusLeft:{ display:'flex', alignItems:'center', gap:'8px' },
  statusRight:{ display:'flex', alignItems:'center', gap:'8px' },
  statusDot:{ width:'8px', height:'8px', borderRadius:'50%', animation:'pulse 2s infinite' },
  statusText:{ fontSize:'10px', fontFamily:"'JetBrains Mono',monospace", letterSpacing:'1px' },
  roleTag:{ fontSize:'10px', fontFamily:"'JetBrains Mono',monospace", letterSpacing:'2px', backgroundColor:'#1a1a2e', padding:'4px 10px', borderRadius:'4px', color:'#7b68ee' },
  idBadge:{ fontSize:'10px', fontFamily:"'JetBrains Mono',monospace", color:'#00cc66', backgroundColor:'#0a1a0f', padding:'3px 8px', borderRadius:'4px', border:'1px solid #003300' },
  reconnectBadge:{ fontSize:'10px', fontFamily:"'JetBrains Mono',monospace", color:'#ff8800', backgroundColor:'#1a1a0a', padding:'3px 8px', borderRadius:'4px', border:'1px solid #332200' },
  videoContainer:{ flex:1, position:'relative', backgroundColor:'#000', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' },
  video:{ width:'100%', height:'100%', objectFit:'cover' },
  placeholder:{ position:'absolute', display:'flex', flexDirection:'column', alignItems:'center', gap:'12px', opacity:0.4 },
  monoSmall:{ fontSize:'12px', fontFamily:"'JetBrains Mono',monospace", letterSpacing:'2px', color:'#ff8800' },
  reconnectOverlay:{ position:'absolute', bottom:'16px', left:'50%', transform:'translateX(-50%)', backgroundColor:'rgba(255,136,0,0.15)', border:'1px solid #ff8800', borderRadius:'8px', padding:'8px 20px' },
  errorBanner:{ backgroundColor:'#331111', color:'#ff6666', padding:'8px 16px', fontSize:'12px', textAlign:'center', fontFamily:"'JetBrains Mono',monospace" },
  controls:{ padding:'16px', display:'flex', flexDirection:'column', gap:'12px', borderTop:'1px solid #1a1a2e' },
  qualityRow:{ display:'flex', gap:'8px', justifyContent:'center' },
  qualityBtn:{ flex:1, padding:'8px', border:'1px solid #2a2a3e', borderRadius:'6px', backgroundColor:'transparent', color:'#888', fontSize:'12px', fontFamily:"'JetBrains Mono',monospace", cursor:'pointer', transition:'all 0.2s' },
  qualityBtnActive:{ backgroundColor:'#1a1a3e', color:'#7b68ee', borderColor:'#7b68ee' },
  actionRow:{ display:'flex', gap:'12px', alignItems:'center' },
  iconBtn:{ width:'48px', height:'48px', borderRadius:'50%', border:'1px solid #2a2a3e', backgroundColor:'#111', fontSize:'20px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  mainBtn:{ flex:1, height:'48px', borderRadius:'24px', border:'none', fontSize:'14px', fontFamily:"'Outfit',sans-serif", fontWeight:700, letterSpacing:'3px', color:'#fff', cursor:'pointer', transition:'all 0.2s' },
};
