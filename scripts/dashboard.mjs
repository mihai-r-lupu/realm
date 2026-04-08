#!/usr/bin/env node
// scripts/dashboard.mjs — Realm project dashboard generator.
// Parses .private/realm-implementation-plan.md and opens a self-contained
// HTML dashboard in the default browser.
//
// Usage: npm run dashboard
// Convention: add ✅ SHIPPED to any ## Phase or ### Week heading when done.

import { readFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const planPath = join(ROOT, '.private', 'realm-implementation-plan.md');

// ─── Parse ────────────────────────────────────────────────────────────────────

const content = readFileSync(planPath, 'utf-8');
const lines = content.split('\n');

const phases = [];
const checkpoints = [];
const backlog = [];

let mode = 'pre'; // 'phases' | 'checkpoints' | 'backlog' | 'skip'
let currentPhase = null;
let currentWeek = null;
let currentBacklogItem = null;

for (const line of lines) {
  if (line.startsWith('## Phase ')) {
    mode = 'phases';
    currentPhase = {
      heading: line.slice(3).trim(),
      shipped: line.includes('✅'),
      weeks: [],
      milestone: '',
    };
    phases.push(currentPhase);
    currentWeek = null;
  } else if (line.startsWith('## Success Checkpoints')) {
    mode = 'checkpoints';
    currentPhase = null;
    currentWeek = null;
  } else if (line.startsWith('## Backlog')) {
    mode = 'backlog';
    currentPhase = null;
    currentWeek = null;
  } else if (
    line.startsWith('## Risk Register') ||
    line.startsWith('## Weekly Cadence')
  ) {
    mode = 'skip';
    currentPhase = null;
    currentWeek = null;
  } else if (mode === 'phases') {
    if (line.match(/^### Weeks?\b/)) {
      const hoursMatch = line.match(/\((\d+[-–]\d+\s*hrs?)\)/i);
      currentWeek = {
        heading: line.slice(4).trim(),
        hours: hoursMatch?.[1] ?? '',
        shipped: line.includes('✅'),
        dod: '',
        goal: '',
      };
      currentPhase?.weeks.push(currentWeek);
    } else if (line.match(/^\*\*Milestone:/)) {
      if (currentPhase) {
        currentPhase.milestone = line
          .replace(/\*\*/g, '')
          .replace('Milestone:', '')
          .trim();
      }
    } else if (line.startsWith('**Definition of done:')) {
      if (currentWeek) {
        currentWeek.dod = line
          .replace(/^\*\*Definition of done:\s*/, '')
          .replace(/\*\*$/, '')
          .trim();
      }
    } else if (line.startsWith('**Goal:')) {
      if (currentWeek) {
        currentWeek.goal = line
          .replace(/^\*\*Goal:\s*/, '')
          .replace(/\*\*$/, '')
          .trim();
      }
    }
  } else if (mode === 'checkpoints') {
    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length >= 3 && /^\d+$/.test(cells[0])) {
      checkpoints.push({ week: cells[0], checkpoint: cells[1], criteria: cells[2] });
    }
  } else if (mode === 'backlog') {
    const m = line.match(/^### (\d+)\.\s+(.+)$/);
    if (m) {
      const shipped = line.includes('✅');
      const commitMatch = line.match(/commit [`']([a-f0-9]+)[`']/);
      currentBacklogItem = {
        number: parseInt(m[1]),
        title: m[2].replace(/\s*✅.*$/, '').trim(),
        shipped,
        commit: commitMatch?.[1] ?? null,
      };
      backlog.push(currentBacklogItem);
    } else if (
      currentBacklogItem &&
      line.match(/^\*\*Placement:/)
    ) {
      currentBacklogItem.placement = line
        .replace(/^\*\*Placement:\s*/, '')
        .replace(/\*\*$/, '')
        .trim();
    }
  }
}

// ─── Derive state ─────────────────────────────────────────────────────────────

const shippedCount = phases.filter(p => p.shipped).length;
const currentIdx = phases.findIndex(p => !p.shipped);
const completePct =
  phases.length > 0 ? Math.round((shippedCount / phases.length) * 100) : 0;
const shippedBacklog = backlog.filter(b => b.shipped).length;
const generatedAt = new Date().toLocaleString();

// ─── HTML helpers ─────────────────────────────────────────────────────────────

const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function renderPhaseCard(phase, idx) {
  const isShipped = phase.shipped;
  const isCurrent = idx === currentIdx;
  const cardCls = isShipped
    ? 'card-shipped'
    : isCurrent
    ? 'card-current'
    : 'card-future';
  const badge = isShipped
    ? '<span class="badge b-shipped">✅ Shipped</span>'
    : isCurrent
    ? '<span class="badge b-current">⚡ Current</span>'
    : '<span class="badge b-future">○ Upcoming</span>';

  const weekItems = phase.weeks
    .map(w => {
      const wDone = isShipped || w.shipped;
      const wCls = wDone ? 'w-done' : isCurrent ? 'w-active' : 'w-future';
      const tip = esc(w.dod || w.goal || '');
      return `<li class="week-item ${wCls}"${
        tip ? ` title="${tip}"` : ''
      }>${esc(w.heading)}</li>`;
    })
    .join('');

  const mstone = phase.milestone
    ? `<div class="milestone">${esc(phase.milestone)}</div>`
    : '';

  return `<div class="card ${cardCls}">
  <div class="card-head">
    <span class="card-title">${esc(phase.heading)}</span>
    ${badge}
  </div>
  <ul class="week-list">${weekItems}</ul>
  ${mstone}
</div>`;
}

const phaseCards = phases.map(renderPhaseCard).join('\n');

const cpRows = checkpoints
  .map(
    c => `<tr>
      <td>${esc(c.week)}</td>
      <td>${esc(c.checkpoint)}</td>
      <td>${esc(c.criteria)}</td>
    </tr>`
  )
  .join('');

const backlogHtml = backlog
  .map(b => {
    const cls = b.shipped ? 'bl-shipped' : 'bl-pending';
    const badge = b.shipped
      ? `<span class="badge b-shipped">✅${
          b.commit ? ' ' + b.commit.slice(0, 7) : ''
        }</span>`
      : '<span class="badge b-future">○ pending</span>';
    return `<div class="bl-item ${cls}">
  <span class="bl-num">${b.number}.</span>
  <span class="bl-title">${esc(b.title)}</span>
  ${badge}
</div>`;
  })
  .join('\n');

// ─── HTML ─────────────────────────────────────────────────────────────────────

const currentPhaseName =
  currentIdx >= 0
    ? phases[currentIdx].heading.match(/Phase [^\s:]+/)?.[0] ?? '—'
    : '✅ All done';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Realm — Implementation Dashboard</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #0d1117;
  color: #e6edf3;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  padding: 28px 32px;
  max-width: 1400px;
}
h1 { font-size: 20px; font-weight: 700; color: #f0f6fc; margin-bottom: 4px; }
h2 { font-size: 12px; font-weight: 600; color: #8b949e; text-transform: uppercase;
     letter-spacing: 0.8px; margin: 28px 0 12px; }
.meta { color: #8b949e; font-size: 12px; margin-bottom: 24px; }

/* Stats row */
.stats { display: flex; gap: 16px; margin-bottom: 28px; align-items: stretch; flex-wrap: wrap; }
.stat {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 12px 18px; min-width: 140px;
}
.stat-val { font-size: 24px; font-weight: 700; color: #f0f6fc; line-height: 1; }
.stat-lbl { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
.progress-wrap {
  flex: 1; min-width: 220px;
  background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 18px;
}
.progress-lbl { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.progress-track { background: #21262d; border-radius: 4px; height: 10px; overflow: hidden; }
.progress-fill { background: linear-gradient(90deg, #238636, #3fb950); border-radius: 4px; height: 100%; }
.progress-pct { font-size: 13px; color: #3fb950; font-weight: 600; margin-top: 6px; }

/* Phase cards */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 14px;
}
.card {
  background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.card-shipped { border-color: #238636; background: #0d2818; }
.card-current { border-color: #d29922; background: #161205; }
.card-future { opacity: 0.65; }
.card-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
}
.card-title { font-size: 12px; font-weight: 600; color: #f0f6fc; line-height: 1.4; flex: 1; }
.badge {
  font-size: 11px; padding: 2px 8px; border-radius: 12px;
  white-space: nowrap; font-weight: 500; flex-shrink: 0;
}
.b-shipped { background: #033a16; color: #3fb950; border: 1px solid #238636; }
.b-current { background: #2d1e00; color: #d29922; border: 1px solid #9e6a03; }
.b-future  { background: #21262d; color: #8b949e; border: 1px solid #30363d; }
.b-pending { background: #21262d; color: #8b949e; border: 1px solid #30363d; }

/* Weeks */
.week-list { list-style: none; display: flex; flex-direction: column; gap: 3px; }
.week-item {
  font-size: 11px; padding: 4px 8px; border-radius: 4px; cursor: default;
}
.w-done   { background: #0d2818; color: #3fb950; }
.w-active { background: #2d1e00; color: #d29922; }
.w-future { background: #161b22; color: #8b949e; border: 1px solid #21262d; }
.milestone {
  font-size: 11px; color: #58a6ff; padding: 6px 10px;
  background: #0c1f2e; border-radius: 4px; border-left: 2px solid #1f6feb;
}

/* Checkpoints table */
.cp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cp-table th {
  text-align: left; padding: 8px 12px;
  background: #161b22; color: #8b949e;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  border-bottom: 1px solid #30363d;
}
.cp-table td { padding: 8px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
.cp-table td:first-child { width: 56px; color: #8b949e; text-align: center; font-variant-numeric: tabular-nums; }
.cp-table td:nth-child(2) { font-weight: 500; color: #f0f6fc; width: 220px; }
.cp-table td:nth-child(3) { color: #c9d1d9; }
.cp-table tr:hover td { background: #161b22; }

/* Backlog */
.bl-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-bottom: 1px solid #21262d; font-size: 12px;
}
.bl-num   { color: #8b949e; min-width: 18px; font-size: 11px; }
.bl-title { flex: 1; }
.bl-shipped .bl-title { color: #8b949e; text-decoration: line-through; }
.bl-pending .bl-title { color: #e6edf3; }

.footer { margin-top: 32px; color: #6e7681; font-size: 11px; }
</style>
</head>
<body>
<h1>Realm — Implementation Dashboard</h1>
<p class="meta">Generated ${esc(generatedAt)} · <code>.private/realm-implementation-plan.md</code></p>

<div class="stats">
  <div class="stat">
    <div class="stat-val">${shippedCount}/${phases.length}</div>
    <div class="stat-lbl">Phases Shipped</div>
  </div>
  <div class="stat">
    <div class="stat-val">${esc(currentPhaseName)}</div>
    <div class="stat-lbl">Current Phase</div>
  </div>
  <div class="stat">
    <div class="stat-val">${shippedBacklog}/${backlog.length}</div>
    <div class="stat-lbl">Backlog Items Shipped</div>
  </div>
  <div class="progress-wrap">
    <div class="progress-lbl">Phase progress</div>
    <div class="progress-track">
      <div class="progress-fill" style="width:${completePct}%"></div>
    </div>
    <div class="progress-pct">${completePct}% (${shippedCount} of ${phases.length} phases)</div>
  </div>
</div>

<h2>Phases</h2>
<div class="cards">
${phaseCards}
</div>

<h2 style="margin-top:36px">Success Checkpoints</h2>
<table class="cp-table">
  <thead><tr><th>Week</th><th>Checkpoint</th><th>Pass Criteria</th></tr></thead>
  <tbody>${cpRows}</tbody>
</table>

<h2 style="margin-top:36px">Backlog — Unscheduled Improvements</h2>
<div class="backlog">
${backlogHtml}
</div>

<p class="footer">
  Hover week items to see definition of done.
  Mark a <code>## Phase</code> or <code>### Week</code> heading with ✅ in the markdown to update its status here.
</p>
</body>
</html>`;

// ─── Write and open ───────────────────────────────────────────────────────────

const outPath = join(tmpdir(), 'realm-dashboard.html');
writeFileSync(outPath, html, 'utf-8');

import { existsSync, readFileSync as _rf } from 'fs';
import { execSync } from 'child_process';

function openFile(path) {
  if (process.platform === 'darwin') {
    exec(`open "${path}"`, handleErr);
    return;
  }
  if (process.platform === 'win32') {
    exec(`start "" "${path}"`, handleErr);
    return;
  }
  // Check for WSL
  try {
    const v = _rf('/proc/version', 'utf-8').toLowerCase();
    const ps = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
    if ((v.includes('microsoft') || v.includes('wsl')) && existsSync(ps)) {
      // Write to Windows TEMP (regular C:\ path, no UNC needed)
      const winTemp = execSync(`"${ps}" -NoProfile -Command "[System.IO.Path]::GetTempPath()"`)
        .toString().trim();
      const winOutPath = winTemp.replace(/\\$/, '') + '\\realm-dashboard.html';
      const wslOutPath = execSync(`wslpath '${winOutPath.replace(/'/g, "'\\''")}'`).toString().trim();
      writeFileSync(wslOutPath, readFileSync(path, 'utf-8'), 'utf-8');
      // Escape backslashes for sh → PowerShell string embedding
      const winPathEscaped = winOutPath.replace(/\\/g, '\\\\');
      exec(`"${ps}" -NoProfile -Command "Start-Process '${winPathEscaped}'"`, handleErr);
      return;
    }
  } catch { /* not WSL */ }
  exec(`xdg-open "${path}"`, handleErr);
}

function handleErr(err) {
  if (err) {
    console.error('Could not open browser automatically:', err.message);
    console.log('Open this file manually in your browser:', outPath);
  } else {
    console.log('Dashboard written to:', outPath);
  }
}

openFile(outPath);
