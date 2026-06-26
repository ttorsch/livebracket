'use client';

import React from 'react';

export default function DesignSystemPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Inter:wght@100..900&family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet" />
      
      <style dangerouslySetInnerHTML={{ __html: `
        /* Visual Foundations: Design Tokens */
        :root {
          /* Colors */
          --coral-500: #EB6F43;
          --coral-600: #E44F1C;
          --ink-900: #14181E;
          --ink-600: #3A414D;
          --ink-500: #7A8294;
          --sand-100: #F5F1EA;
          --sand-300: #E7E2D9;
          --white: #FFFFFF;
          --live: #F16767;
          --highlight: #F7C175;
          --link-blue: #1E6EF4;

          /* Corner Radii */
          --radius-md: 12px;
          --radius-xl: 24px;
          --radius-2xl: 34px;
          --radius-3xl: 39px;
          --radius-pill: 999px;

          /* Shadows */
          --shadow-card: 0 8px 40px rgba(0, 0, 0, 0.12);
          --shadow-primary: 0 4px 12px rgba(242, 103, 73, 0.40);

          /* Spacing Scale */
          --space-1: 4px;
          --space-2: 8px;
          --space-3: 12px;
          --space-4: 16px;
          --space-5: 20px;
          --space-6: 24px;
          --space-8: 32px;
          --space-10: 40px;
          --space-12: 48px;
          --space-16: 64px;

          /* Motion */
          --duration-base: 200ms;
          --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Reset & Base Styles */
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .ds-body {
          font-family: "DM Sans", system-ui, -apple-system, sans-serif;
          background-color: var(--white);
          color: var(--ink-900);
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }

        /* Top Navigation Bar */
        .ds-header {
          height: 48px;
          border-bottom: 1px solid var(--sand-300);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 var(--space-4);
          background: var(--white);
          z-index: 10;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .btn-ds {
          background: var(--sand-100);
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 13px;
          cursor: pointer;
        }

        .dropdown-trigger {
          font-size: 13px;
          color: var(--ink-600);
          cursor: pointer;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .btn-share {
          background: var(--ink-900);
          color: var(--white);
          border: none;
          padding: 6px 16px;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
        }

        .avatar-circle {
          width: 28px;
          height: 28px;
          background: var(--sand-300);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
        }

        /* Main Workspace Layout */
        .workspace {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        /* Sidebar Navigation */
        .ds-aside {
          width: 260px;
          border-right: 1px solid var(--sand-300);
          background: var(--white);
          overflow-y: auto;
          padding: var(--space-4);
        }

        .nav-group {
          margin-bottom: var(--space-4);
        }

        .nav-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--ink-500);
          margin-bottom: var(--space-2);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .nav-item {
          font-size: 13px;
          padding: 6px var(--space-2);
          color: var(--ink-600);
          cursor: pointer;
          border-radius: 4px;
          display: block;
          text-decoration: none;
        }

        .nav-item:hover {
          background: var(--sand-100);
          color: var(--ink-900);
        }

        .nav-item.active {
          font-weight: 500;
          color: var(--ink-900);
        }

        /* Main Content Container */
        .ds-main {
          flex: 1;
          overflow-y: auto;
          background: var(--white);
          padding: var(--space-10) var(--space-16);
        }

        .content-wrapper {
          max-width: 960px;
          margin: 0 auto;
        }

        /* Typography Specifications */
        .ds-main h1 {
          font-family: "Space Grotesk", sans-serif;
          font-size: 48px;
          line-height: 58px;
          font-weight: 700;
          margin-bottom: var(--space-6);
        }

        .ds-main h2 {
          font-family: "Space Grotesk", sans-serif;
          font-size: 28px;
          line-height: 36px;
          font-weight: 700;
          margin-top: var(--space-8);
          margin-bottom: var(--space-4);
        }

        .ds-main h3 {
          font-family: "Space Grotesk", sans-serif;
          font-size: 20px;
          line-height: 26px;
          font-weight: 700;
          margin-top: var(--space-6);
          margin-bottom: var(--space-3);
        }

        .ds-main p {
          font-size: 16px;
          line-height: 24px;
          color: var(--ink-600);
          margin-bottom: var(--space-4);
        }

        .ds-main p strong {
          color: var(--ink-900);
        }

        .ds-main ul {
          margin-left: var(--space-5);
          margin-bottom: var(--space-4);
          color: var(--ink-600);
        }

        .ds-main li {
          margin-bottom: var(--space-2);
          line-height: 24px;
        }

        /* Default Notice Banner */
        .system-notice {
          background: var(--white);
          border: 1px solid var(--sand-300);
          border-radius: var(--radius-md);
          padding: var(--space-4) var(--space-6);
          margin-bottom: var(--space-8);
        }

        .notice-text {
          font-size: 14px;
          color: var(--ink-600);
          margin-bottom: var(--space-4);
        }

        .notice-actions {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          border-top: 1px solid var(--sand-300);
          padding-top: var(--space-3);
        }

        .checkbox-container {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 500;
        }

        /* Component Specimen Previews (Iframes / Panels) */
        .specimen-panel {
          border: 1px solid var(--sand-300);
          border-radius: var(--radius-md);
          padding: var(--space-6);
          margin-top: var(--space-3);
          margin-bottom: var(--space-2);
          background: var(--sand-100);
        }

        /* Liquid Glass Implementation Specifics */
        .glass-showcase {
          background: linear-gradient(135deg, #f7c175 0%, #eb6f43 100%);
          padding: var(--space-10);
          border-radius: var(--radius-xl);
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .liquid-glass-card {
          background: rgba(255, 255, 255, 0.18);
          backdrop-filter: blur(18px) saturate(150%);
          -webkit-backdrop-filter: blur(18px) saturate(150%);
          border-radius: var(--radius-2xl);
          padding: var(--space-6);
          box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.35), 0 30px 60px -30px rgba(20, 31, 46, 0.35);
          color: var(--ink-900);
        }

        .liquid-glass-card.dark {
          background: rgba(20, 24, 30, 0.40);
          color: var(--white);
        }

        /* Buttons Spec Matrix */
        .btn-matrix {
          display: flex;
          gap: var(--space-3);
          align-items: center;
          flex-wrap: wrap;
        }

        .btn-primary {
          background-color: var(--coral-500);
          color: var(--white);
          border: none;
          padding: 12px 24px;
          border-radius: var(--radius-pill);
          font-family: "DM Sans", sans-serif;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
          box-shadow: var(--shadow-primary);
          transition: background var(--duration-base) var(--ease-default), transform var(--duration-base) var(--ease-default);
        }

        .btn-primary:hover {
          background-color: var(--coral-600);
        }

        .btn-primary:active {
          transform: scale(0.96);
        }

        /* Micro-labels styling */
        .micro-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--live);
          display: inline-block;
          margin-bottom: var(--space-1);
        }

        .usage-notes-btn {
          font-size: 13px;
          color: var(--ink-500);
          background: none;
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .usage-notes-btn:hover {
          color: var(--ink-900);
        }
      ` }} />

      <div className="ds-body">
        <header className="ds-header">
          <div className="header-left">
            <button className="btn-ds">Design System</button>
            <span className="dropdown-trigger">No file open ▾</span>
          </div>
          <div className="header-right">
            <button className="btn-share">Share</button>
            <div className="avatar-circle">T</div>
          </div>
        </header>

        <div className="workspace">
          <aside className="ds-aside">
            <div className="nav-group">
              <div className="nav-item active">📄 Readme</div>
            </div>
            
            <div className="nav-group">
              <div className="nav-title">⊙ Brand</div>
              <a href="#identity" className="nav-item">Identity & Voice</a>
              <a href="#imagery" className="nav-item">Imagery</a>
            </div>

            <div className="nav-group">
              <div className="nav-title">⊙ Colors</div>
              <a href="#coral" className="nav-item">Coral / Sunset Orange</a>
              <a href="#glass" className="nav-item">Liquid Glass</a>
              <a href="#ink" className="nav-item">Ink & Neutrals</a>
            </div>

            <div className="nav-group">
              <div className="nav-title">⊙ Components</div>
              <a href="#bracket" className="nav-item">Bracket Match</a>
              <a href="#logo" className="nav-item">Logo</a>
              <a href="#buttons" className="nav-item">Buttons</a>
              <a href="#data" className="nav-item">Data Display</a>
              <a href="#forms" className="nav-item">Forms</a>
              <a href="#icons" className="nav-item">Icons</a>
              <a href="#surfaces" className="nav-item">Glass & Card Surfaces</a>
            </div>

            <div className="nav-group">
              <div className="nav-title">⊙ Spacing</div>
              <a href="#radius" className="nav-item">Radius & Shadow</a>
              <a href="#scale" className="nav-item">Spacing Scale</a>
            </div>

            <div className="nav-group">
              <div className="nav-title">⊙ Type</div>
              <a href="#display" className="nav-item">Display — Space Grotesk</a>
              <a href="#scores" className="nav-item">Scores & Numerals</a>
              <a href="#text" className="nav-item">Text — DM Sans</a>
            </div>

            <div className="nav-group">
              <div className="nav-title">⊙ Live Bracket Web</div>
              <a href="#web" className="nav-item">live-bracket-web</a>
            </div>
          </aside>

          <main className="ds-main">
            <div className="content-wrapper">
              <h1>Design system</h1>

              <div className="system-notice">
                <p className="notice-text">Your team's new projects will use this design system by default. You can always update this design system using the chat.</p>
                <div className="notice-actions">
                  <label className="checkbox-container">
                    <input type="checkbox" checked disabled /> Published
                  </label>
                  <label className="checkbox-container">
                    <input type="checkbox" disabled /> Default <em>Use this system</em>
                  </label>
                </div>
              </div>

              <h3>Live Bracket — Design System</h3>
              <p>
                <strong>Live Bracket</strong> is the live tournament platform for <strong>Khao Lak Volley (KLV)</strong> — beach-volleyball events on the beaches of Thailand. Players and fans browse tournaments, register teams, follow divisions, and watch brackets update set-by-set in real time. The brand is <strong>warm, sunlit, and energetic</strong>: Sunset-orange coral over warm sand cream, cool-navy ink for text, and a signature <strong>liquid-glass</strong> surface that floats translucent panels over golden-hour beach photography.
              </p>
              <p>This project is the design system that powers Live Bracket interfaces — tokens, components, foundation specimens, and a working web-app UI kit.</p>

              <h3>Sources</h3>
              <ul>
                <li><strong>Figma:</strong> <em>Live Bracket (1).fig</em> — pages: design-system (Live Bracket Web Design System + KLV Buttons Matrix), logo, Page-2 (tournament detail), Page-3 (tournament listing). Token values, the buttons matrix, the logo geometry, and both product screens were extracted from this file.</li>
                <li>No codebase was provided; components are faithful, mainly-cosmetic recreations built from the Figma source.</li>
              </ul>

              <h3>Content fundamentals</h3>
              <p>How Live Bracket writes:</p>
              <ul>
                <li><strong>Voice — direct & warm.</strong> Short, active, second-person. Real product copy: "Register Team", "See all division", "Divisions", "Sign In", "Live Now", "Add Favorite". Speaks to the player.</li>
                <li><strong>Energetic, never hype.</strong> The sport supplies the adrenaline; copy stays plain and confident. No exclamation spam, no marketing fluff.</li>
                <li><strong>Casing.</strong> Title Case for buttons, tabs, and tournament names (<em>Khao Lak Open 2027</em>). UPPERCASE is reserved for the wordmark (LIVE BRACKET) and micro/overline labels (LIVE). Sentence case for body text.</li>
                <li><strong>Numbers carry meaning.</strong> Scores, set tallies, and slot counts (<em>19/24</em>) are first-class — shown in tabular Space Grotesk numerals.</li>
                <li><strong>No emoji.</strong> Iconography is line icons, not emoji.</li>
              </ul>

              <h2 id="identity">Brand Foundations</h2>
              <h3>Identity & Voice</h3>
              <div className="specimen-panel" style={{ background: '#FFF', borderLeft: '4px solid var(--coral-500)' }}>
                <p style={{ fontFamily: "'Inter', sans-serif", fontWeight: 900, letterSpacing: '1px', marginBottom: '4px' }}>LIVE BRACKET</p>
                <p style={{ fontSize: '14px', fontStyle: 'italic', color: 'var(--ink-600)' }}>Every set. Live.</p>
              </div>

              <h2 id="glass">Liquid Glass Surface</h2>
              <p>The system's signature motif uses frosted glass treatments overlaying warm layout tones.</p>
              <div className="glass-showcase">
                <div className="liquid-glass-card">
                  <span className="micro-label">Live Now</span>
                  <h3 style={{ marginTop: 0 }}>Khao Lak Classic</h3>
                  <p style={{ fontSize: '14px', marginBottom: 0 }}>Open division · frosted light glass panels handling real-time matches.</p>
                </div>
                <div className="liquid-glass-card dark">
                  <span className="micro-label" style={{ color: 'var(--highlight)' }}>Featured</span>
                  <h3 style={{ marginTop: 0, color: 'var(--white)' }}>Night Finals</h3>
                  <p style={{ fontSize: '14px', marginBottom: 0, color: 'rgba(255,255,255,0.8)' }}>Dark glass structures engineered for modern photography pairings.</p>
                </div>
              </div>

              <h2 id="buttons">Buttons Matrix</h2>
              <div className="specimen-panel">
                <div className="btn-matrix">
                  <button className="btn-primary">Register Team</button>
                  <button className="btn-primary" style={{ background: 'transparent', color: 'var(--ink-900)', border: '1px solid var(--sand-300)', boxShadow: 'none' }}>Divisions</button>
                  <button className="btn-primary" style={{ background: 'none', color: 'var(--ink-600)', boxShadow: 'none' }}>Sign In</button>
                </div>
              </div>
              <button className="usage-notes-btn">📑 Usage notes for Claude</button>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
