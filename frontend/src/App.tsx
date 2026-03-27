/* Copyright (c) 2026 Stephen Hsu (chiacheng.hsu@owasp.org). All rights reserved. */
import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import SenderPage from './SenderPage';
import ReceiverPage from './ReceiverPage';

function HomePage() {
  return (
    <div style={styles.container}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        a:hover .card { border-color:#7b68ee !important; transform:translateY(-2px); }
      `}</style>

      <div style={styles.content}>
        <div style={styles.header}>
          <div style={styles.logoMark}>◈</div>
          <h1 style={styles.title}>WebRTC Streamer</h1>
          <p style={styles.subtitle}>Multi-camera low-latency streaming for OBS</p>
        </div>

        <div style={styles.cards}>
          <Link to="/sender" style={styles.link}>
            <div className="card" style={styles.card}>
              <div style={styles.cardIcon}>📱</div>
              <div>
                <div style={styles.cardTitle}>Sender</div>
                <div style={styles.cardDesc}>Open on each mobile device</div>
              </div>
              <div style={styles.arrow}>→</div>
            </div>
          </Link>

          <Link to="/receiver" style={styles.link}>
            <div className="card" style={styles.card}>
              <div style={styles.cardIcon}>🖥️</div>
              <div>
                <div style={styles.cardTitle}>Receiver (Grid)</div>
                <div style={styles.cardDesc}>All cameras in adaptive grid</div>
              </div>
              <div style={styles.arrow}>→</div>
            </div>
          </Link>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>OBS setup</div>
          <div style={styles.tip}>
            <strong>Grid view</strong> — add <code style={styles.code}>/receiver</code> as one Browser Source to see all cameras.
          </div>
          <div style={styles.tip}>
            <strong>Solo view</strong> — add <code style={styles.code}>/receiver?solo=SENDER_ID</code> per camera for independent scene control.
          </div>
          <div style={styles.tip}>
            <strong>Custom label</strong> — open sender as <code style={styles.code}>/sender?label=CamA</code> to name each camera.
          </div>
        </div>

        <div style={styles.footer}>
          <code style={styles.footerCode}>v2.0.0</code>
          <span style={styles.footerText}>© 2026 Stephen Hsu</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <style>{`
        *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
        body{background:#0a0a0f}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sender" element={<SenderPage />} />
          <Route path="/receiver" element={<ReceiverPage />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container:{ minHeight:'100dvh', backgroundColor:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Outfit',sans-serif", color:'#e0e0e0', padding:'24px' },
  content:{ maxWidth:'460px', width:'100%', display:'flex', flexDirection:'column', gap:'32px', animation:'fadeUp 0.6s ease-out' },
  header:{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' },
  logoMark:{ fontSize:'36px', color:'#7b68ee', marginBottom:'8px' },
  title:{ fontSize:'28px', fontWeight:700, letterSpacing:'-0.5px' },
  subtitle:{ fontSize:'14px', color:'#666', fontWeight:300 },
  cards:{ display:'flex', flexDirection:'column', gap:'12px' },
  link:{ textDecoration:'none', color:'inherit' },
  card:{ display:'flex', alignItems:'center', gap:'16px', padding:'16px 20px', backgroundColor:'#111118', border:'1px solid #1e1e2e', borderRadius:'12px', cursor:'pointer', transition:'all 0.2s' },
  cardIcon:{ fontSize:'28px' },
  cardTitle:{ fontSize:'16px', fontWeight:600 },
  cardDesc:{ fontSize:'12px', color:'#666', marginTop:'2px' },
  arrow:{ marginLeft:'auto', fontSize:'18px', color:'#444' },
  section:{ display:'flex', flexDirection:'column', gap:'8px' },
  sectionTitle:{ fontSize:'12px', fontFamily:"'JetBrains Mono',monospace", letterSpacing:'2px', color:'#555', textTransform:'uppercase' as const },
  tip:{ fontSize:'13px', color:'#888', lineHeight:'1.5' },
  code:{ fontFamily:"'JetBrains Mono',monospace", fontSize:'11px', backgroundColor:'#1a1a2e', padding:'2px 6px', borderRadius:'3px', color:'#7b68ee' },
  footer:{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:'16px', borderTop:'1px solid #1a1a2e' },
  footerCode:{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', color:'#444', backgroundColor:'#111', padding:'2px 6px', borderRadius:'3px' },
  footerText:{ fontSize:'11px', color:'#444' },
};
