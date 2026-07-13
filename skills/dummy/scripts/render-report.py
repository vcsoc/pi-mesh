#!/usr/bin/env python3
import json
import html
import math
import sys
from pathlib import Path

CSS = r'''
:root {
  --bg: #1e1e1e;
  --bg-elev: #252526;
  --bg-elev-2: #2d2d30;
  --panel: rgba(255, 255, 255, 0.04);
  --panel-strong: rgba(255, 255, 255, 0.06);
  --surface: rgba(255, 255, 255, 0.03);
  --text: #d4d4d4;
  --muted: #9da1a6;
  --accent: #3794ff;
  --accent-soft: rgba(55, 148, 255, 0.18);
  --accent-glow: rgba(55, 148, 255, 0.22);
  --success: #4ec9b0;
  --warn: #d7ba7d;
  --danger: #f48771;
  --code: #ce9178;
}
body[data-theme="light"] {
  --bg: #ffffff;
  --bg-elev: #f5f7fb;
  --bg-elev-2: #edf2f8;
  --panel: rgba(0, 0, 0, 0.025);
  --panel-strong: rgba(0, 0, 0, 0.04);
  --surface: rgba(0, 0, 0, 0.02);
  --text: #1f1f1f;
  --muted: #5c6370;
  --accent: #005fb8;
  --accent-soft: rgba(0, 95, 184, 0.12);
  --accent-glow: rgba(0, 95, 184, 0.16);
  --success: #0b7a75;
  --warn: #9a6700;
  --danger: #b42318;
  --code: #a31515;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: radial-gradient(circle at top, var(--bg-elev-2), var(--bg) 42%); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color: var(--accent); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
body { min-height: 100vh; }
.container { max-width: 1320px; margin: 0 auto; padding: 28px; }
.header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.title-wrap h1 { margin: 0 0 8px; font-size: 2.2rem; letter-spacing: -0.03em; }
.subtitle { margin: 0; color: var(--muted); max-width: 850px; line-height: 1.55; }
.controls { display: flex; gap: 10px; align-items: center; }
button { background: var(--panel-strong); color: var(--text); border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer; transition: background 160ms ease, transform 160ms ease; }
button:hover { background: var(--accent-soft); transform: translateY(-1px); }
.card { background: var(--panel); border: 0; border-radius: 20px; box-shadow: none; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
.summary-card { padding: 18px; background: var(--panel-strong); }
.summary-card .label { color: var(--muted); font-size: 0.82rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.08em; }
.summary-card .value { font-size: 1.05rem; font-weight: 600; line-height: 1.4; }
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 18px; }
.tabs { padding: 12px; position: sticky; top: 16px; align-self: start; background: transparent; }
.tab-button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 13px 14px; border-radius: 14px; margin-bottom: 8px; transition: background 160ms ease, transform 160ms ease; }
.tab-button:hover { background: var(--surface); transform: translateX(2px); }
.tab-button.active { background: linear-gradient(135deg, var(--accent-soft), transparent 80%); box-shadow: inset 0 0 0 1px var(--accent-glow); }
.tab-button .tab-title { font-weight: 600; display: block; }
.tab-button .tab-desc { font-size: 0.86rem; color: var(--muted); display: block; margin-top: 4px; }
.content { min-width: 0; }
.panel { display: none; padding: 24px; }
.panel.active { display: block; }
.panel h2 { margin-top: 0; font-size: 1.4rem; letter-spacing: -0.02em; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.list { display: grid; gap: 12px; }
.item { border: 0; border-radius: 18px; padding: 16px; background: var(--surface); }
body[data-theme="light"] .item { background: rgba(0, 0, 0, 0.02); }
.item h3 { margin: 0 0 8px; }
.item p { margin: 0 0 8px; line-height: 1.6; }
.pill-row { display: flex; flex-wrap: wrap; gap: 8px; }
.pill { padding: 7px 11px; border-radius: 999px; background: var(--panel-strong); border: 0; font-size: 0.86rem; }
.kv { display: grid; gap: 8px; }
.kv div { padding: 12px 14px; border-radius: 14px; background: var(--surface); border: 0; }
.note { color: var(--muted); }
.severity-low { color: var(--success); }
.severity-medium { color: var(--warn); }
.severity-high, .severity-critical { color: var(--danger); }
.graph-wrap { display: grid; grid-template-columns: 1fr; gap: 16px; }
#graphCanvas { width: 100%; height: 920px; display: block; border-radius: 22px; background: radial-gradient(circle at top, var(--bg-elev-2), var(--bg)); border: 0; cursor: default; }
.graph-sidebars { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.legend, .mini-panel { padding: 14px; }
.legend h3, .mini-panel h3 { margin-top: 0; }
.legend ul { padding-left: 18px; margin: 0; }
.footer { margin-top: 20px; color: var(--muted); font-size: 0.9rem; }
.empty { color: var(--muted); font-style: italic; }
@media (max-width: 980px) {
  .summary-grid, .layout, .grid-2, .graph-wrap, .graph-sidebars { grid-template-columns: 1fr; }
  .tabs { position: static; }
  #graphCanvas { height: 560px; }
}
'''

JS = r'''
const REPORT_DATA = __REPORT_DATA__;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function el(id) { return document.getElementById(id); }

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('dummy-report-theme', theme);
  const btn = el('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? 'Switch to light' : 'Switch to dark';
}

function initTheme() {
  const saved = localStorage.getItem('dummy-report-theme');
  setTheme(saved || 'dark');
}

function renderTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab-button'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  function activate(id) {
    tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === id));
    panels.forEach(panel => panel.classList.toggle('active', panel.id === id));
    window.location.hash = id;
    window.dispatchEvent(new CustomEvent('dummy-report-tab-change', { detail: { id } }));
  }
  tabs.forEach(btn => btn.addEventListener('click', () => activate(btn.dataset.tab)));
  const wanted = window.location.hash.replace('#', '');
  activate(document.getElementById(wanted) ? wanted : 'overview');
}

function list(items, render) {
  if (!items || !items.length) return '<p class="empty">No data available.</p>';
  return `<div class="list">${items.map(render).join('')}</div>`;
}

function bullets(items) {
  if (!items || !items.length) return '<p class="empty">None listed.</p>';
  return `<ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function renderOverview() {
  const s = REPORT_DATA.summary || {};
  el('overviewSimple').innerHTML = `
    <div class="grid-2">
      <div class="item">
        <h3>What this project is</h3>
        <p>${escapeHtml(s.whatItDoes || REPORT_DATA.summary?.oneLiner || 'No overview provided.')}</p>
      </div>
      <div class="item">
        <h3>How it works</h3>
        <p>${escapeHtml(s.howItWorks || 'No high-level explanation provided.')}</p>
      </div>
    </div>
    <div class="item" style="margin-top:16px;">
      <h3>Where a new developer should start</h3>
      ${bullets(s.whereToStart || [])}
    </div>`;
}

function renderArchitecture() {
  el('architectureContent').innerHTML = list(REPORT_DATA.architecture, (section) => `
    <div class="item">
      <h3>${escapeHtml(section.title)}</h3>
      <p>${escapeHtml(section.summary || '')}</p>
      ${bullets(section.items || [])}
    </div>`);
}

function renderStructure() {
  el('structureContent').innerHTML = list(REPORT_DATA.structure, (section) => `
    <div class="item">
      <h3><code>${escapeHtml(section.path)}</code></h3>
      <p>${escapeHtml(section.purpose || '')}</p>
      ${bullets(section.highlights || [])}
    </div>`);
}

function renderModules() {
  el('modulesContent').innerHTML = list(REPORT_DATA.modules, (module) => `
    <div class="item">
      <h3>${escapeHtml(module.name)}</h3>
      <p>${escapeHtml(module.summary || '')}</p>
      <div class="pill-row" style="margin-bottom:10px;">
        ${module.type ? `<span class="pill">${escapeHtml(module.type)}</span>` : ''}
        ${module.path ? `<span class="pill"><code>${escapeHtml(module.path)}</code></span>` : ''}
      </div>
      ${bullets(module.details || [])}
      ${module.dependsOn?.length ? `<p class="note"><strong>Depends on:</strong> ${module.dependsOn.map(escapeHtml).join(', ')}</p>` : ''}
    </div>`);
}

function renderDependencies() {
  const deps = REPORT_DATA.dependencies || {};
  const runtime = deps.runtime || [];
  const development = deps.development || [];
  el('dependenciesContent').innerHTML = `
    <div class="grid-2">
      <div class="item">
        <h3>Runtime dependencies</h3>
        ${list(runtime, (dep) => `<div class="kv"><div><strong>${escapeHtml(dep.name)}</strong><br>${escapeHtml(dep.why || '')}</div></div>`)}
      </div>
      <div class="item">
        <h3>Development dependencies</h3>
        ${list(development, (dep) => `<div class="kv"><div><strong>${escapeHtml(dep.name)}</strong><br>${escapeHtml(dep.why || '')}</div></div>`)}
      </div>
    </div>`;
}

function renderFlows() {
  el('flowsContent').innerHTML = list(REPORT_DATA.flows, (flow) => `
    <div class="item">
      <h3>${escapeHtml(flow.name)}</h3>
      <p>${escapeHtml(flow.summary || '')}</p>
      ${bullets(flow.steps || [])}
    </div>`);
}

function renderConcepts() {
  el('conceptsContent').innerHTML = list(REPORT_DATA.concepts, (concept) => `
    <div class="item">
      <h3>${escapeHtml(concept.name)}</h3>
      ${concept.summary ? `<p>${escapeHtml(concept.summary)}</p>` : ''}
      ${concept.whatItIs ? `<div class="kv" style="margin-top:10px;"><div><strong>What it is</strong><br>${escapeHtml(concept.whatItIs)}</div></div>` : ''}
      ${concept.whyItIsUsed ? `<div class="kv" style="margin-top:10px;"><div><strong>Why teams use it</strong><br>${escapeHtml(concept.whyItIsUsed)}</div></div>` : ''}
      ${concept.howItWorks?.length ? `<div style="margin-top:12px;"><strong>How it works</strong>${bullets(concept.howItWorks)}</div>` : ''}
      ${concept.projectUsage ? `<div class="kv" style="margin-top:10px;"><div><strong>How this project uses it</strong><br>${escapeHtml(concept.projectUsage)}</div></div>` : ''}
      ${concept.projectExamples?.length ? `<div style="margin-top:12px;"><strong>Project examples</strong>${bullets(concept.projectExamples)}</div>` : ''}
      ${concept.whereToLook?.length ? `<div style="margin-top:12px;"><strong>Where to look in the code</strong>${bullets(concept.whereToLook)}</div>` : ''}
    </div>`);
}

function renderRisks() {
  el('risksContent').innerHTML = list(REPORT_DATA.risks, (risk) => `
    <div class="item">
      <h3>${escapeHtml(risk.title)} ${risk.severity ? `<span class="severity-${escapeHtml(String(risk.severity).toLowerCase())}">(${escapeHtml(risk.severity)})</span>` : ''}</h3>
      <p>${escapeHtml(risk.details || '')}</p>
    </div>`);
}

function renderGlossary() {
  el('glossaryContent').innerHTML = list(REPORT_DATA.glossary, (entry) => `
    <div class="item">
      <h3>${escapeHtml(entry.term)}</h3>
      <p>${escapeHtml(entry.meaning || '')}</p>
    </div>`);
}

function renderDetails() {
  el('detailsContent').innerHTML = list(REPORT_DATA.details, (section) => `
    <div class="item">
      <h3>${escapeHtml(section.title)}</h3>
      ${bullets(section.content || [])}
    </div>`);
}

function renderTopSummary() {
  const stack = (REPORT_DATA.stack || []).map(x => x.name).slice(0, 5).join(', ') || 'Unknown';
  const start = REPORT_DATA.summary?.whereToStart?.[0] || REPORT_DATA.entryPoints?.[0]?.path || 'Not specified';
  el('topSummary').innerHTML = `
    <div class="summary-card card"><div class="label">Project</div><div class="value">${escapeHtml(REPORT_DATA.projectName || 'Unknown project')}</div></div>
    <div class="summary-card card"><div class="label">Primary stack</div><div class="value">${escapeHtml(stack)}</div></div>
    <div class="summary-card card"><div class="label">Best place to start</div><div class="value"><code>${escapeHtml(start)}</code></div></div>
    <div class="summary-card card"><div class="label">Main idea</div><div class="value">${escapeHtml(REPORT_DATA.summary?.oneLiner || 'No summary provided')}</div></div>`;

  const stackHtml = (REPORT_DATA.stack || []).map(item => `<span class="pill">${escapeHtml(item.name)}${item.role ? ` — ${escapeHtml(item.role)}` : ''}</span>`).join('');
  const entryHtml = (REPORT_DATA.entryPoints || []).map(item => `<div><strong>${escapeHtml(item.name || item.path)}</strong><br><code>${escapeHtml(item.path || '')}</code>${item.reason ? `<br>${escapeHtml(item.reason)}` : ''}</div>`).join('');
  el('stackPills').innerHTML = stackHtml || '<span class="empty">No stack data.</span>';
  el('entryPoints').innerHTML = entryHtml || '<span class="empty">No entry points listed.</span>';
}

function buildGraphData() {
  const graph = REPORT_DATA.graph || {};
  const nodes = (graph.nodes || []).map((node, index) => ({
    ...node,
    x: 150 + (index % 5) * 160,
    y: 120 + Math.floor(index / 5) * 120,
    vx: 0,
    vy: 0,
  }));
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  let edges = (graph.edges || []).filter(edge => nodeMap.has(edge.source) && nodeMap.has(edge.target));

  if (!nodes.length && Array.isArray(REPORT_DATA.modules)) {
    REPORT_DATA.modules.forEach((m, index) => {
      nodes.push({
        id: m.id || `module-${index}`,
        label: m.name || m.id || `Module ${index + 1}`,
        group: m.type || 'module',
        description: m.summary || '',
        path: m.path || '',
        x: 150 + (index % 5) * 160,
        y: 120 + Math.floor(index / 5) * 120,
        vx: 0,
        vy: 0,
      });
    });
    const derivedMap = new Map(nodes.map(node => [node.id, node]));
    edges = [];
    (REPORT_DATA.modules || []).forEach((m, index) => {
      (m.dependsOn || []).forEach(dep => {
        const source = m.id || `module-${index}`;
        if (derivedMap.has(source) && derivedMap.has(dep)) {
          edges.push({ source, target: dep, label: 'depends on' });
        }
      });
    });
  }

  return { nodes, edges };
}

function renderGraph() {
  const canvas = el('graphCanvas');
  const info = el('graphInfo');
  const legend = el('graphLegend');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let width = 0, height = 0;
  let scale = 1;
  let offsetX = 0, offsetY = 0;
  let activeNode = null;
  let selectedNode = null;
  let isPanning = false;
  let didMove = false;
  let lastX = 0, lastY = 0;
  const nodeRadius = 38;
  const { nodes, edges } = buildGraphData();
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const palette = ['#3794ff', '#4ec9b0', '#d7ba7d', '#c586c0', '#f48771', '#9cdcfe', '#b5cea8'];
  const groupColors = {};
  [...new Set(nodes.map(n => n.group || 'module'))].forEach((group, i) => { groupColors[group] = palette[i % palette.length]; });

  legend.innerHTML = Object.keys(groupColors).length
    ? `<ul>${Object.entries(groupColors).map(([group, color]) => `<li><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};margin-right:8px;"></span>${escapeHtml(group)}</li>`).join('')}</ul>`
    : '<p class="empty">No graph groups.</p>';

  if (!nodes.length) {
    info.innerHTML = '<p class="empty">No graph data available.</p>';
    return;
  }

  function updateInfo(node) {
    if (!node) {
      info.innerHTML = '<span class="note">Click a node to inspect it.</span>';
      return;
    }
    info.innerHTML = `<strong>${escapeHtml(node.label || node.id)}</strong><br>${escapeHtml(node.description || '')}${node.path ? `<br><code>${escapeHtml(node.path)}</code>` : ''}`;
  }

  function layoutNodes() {
    const cols = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
    const spacingX = 260;
    const spacingY = 210;
    const baseX = 180;
    const baseY = 160;
    nodes.forEach((node, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      node.x = baseX + col * spacingX;
      node.y = baseY + row * spacingY + (col % 2 ? 28 : 0);
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return false;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function getBounds() {
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    return {
      minX: Math.min(...xs) - 120,
      maxX: Math.max(...xs) + 120,
      minY: Math.min(...ys) - 120,
      maxY: Math.max(...ys) + 170,
    };
  }

  function fitToView() {
    if (!width || !height) return;
    const bounds = getBounds();
    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scaleX = (width - 80) / graphWidth;
    const scaleY = (height - 80) / graphHeight;
    scale = Math.min(1, Math.min(scaleX, scaleY));
    scale = Math.max(0.35, scale);
    offsetX = (width - graphWidth * scale) / 2 - bounds.minX * scale;
    offsetY = (height - graphHeight * scale) / 2 - bounds.minY * scale;
  }

  function toWorld(x, y) {
    return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
  }

  function getNodeAt(x, y) {
    const p = toWorld(x, y);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = p.x - n.x;
      const dy = p.y - n.y;
      if (Math.sqrt(dx * dx + dy * dy) <= nodeRadius) return n;
    }
    return null;
  }

  function getLocalPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function drawArrow(x1, y1, x2, y2, color) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const endX = x2 - Math.cos(angle) * nodeRadius;
    const endY = y2 - Math.sin(angle) * nodeRadius;
    const startX = x1 + Math.cos(angle) * nodeRadius;
    const startY = y1 + Math.sin(angle) * nodeRadius;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(angle - Math.PI / 6) * 10, endY - Math.sin(angle - Math.PI / 6) * 10);
    ctx.lineTo(endX - Math.cos(angle + Math.PI / 6) * 10, endY - Math.sin(angle + Math.PI / 6) * 10);
    ctx.closePath();
    ctx.fill();
  }

  function drawLabel(text, x, y, styles) {
    const safe = String(text || '').slice(0, 26);
    ctx.font = '600 12px sans-serif';
    const labelWidth = ctx.measureText(safe).width + 16;
    const labelX = x - labelWidth / 2;
    const labelY = y + nodeRadius + 10;
    ctx.fillStyle = styles.getPropertyValue('--bg').trim();
    ctx.fillRect(labelX, labelY, labelWidth, 24);
    ctx.strokeStyle = styles.getPropertyValue('--border').trim();
    ctx.strokeRect(labelX, labelY, labelWidth, 24);
    ctx.fillStyle = styles.getPropertyValue('--text').trim();
    ctx.fillText(safe, labelX + 8, labelY + 16);
  }

  function draw() {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const styles = getComputedStyle(document.body);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.lineWidth = 1.5;
    ctx.font = '12px sans-serif';
    edges.forEach((edge) => {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) return;
      const edgeColor = styles.getPropertyValue('--border').trim();
      drawArrow(a.x, a.y, b.x, b.y, edgeColor);
      if (edge.label) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.fillStyle = styles.getPropertyValue('--muted').trim();
        ctx.fillText(String(edge.label).slice(0, 20), mx + 8, my - 8);
      }
    });

    nodes.forEach((node) => {
      const isSelected = selectedNode && selectedNode.id === node.id;
      ctx.beginPath();
      ctx.fillStyle = groupColors[node.group || 'module'] || styles.getPropertyValue('--accent').trim();
      ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = isSelected ? 4 : 2;
      ctx.strokeStyle = isSelected ? styles.getPropertyValue('--text').trim() : styles.getPropertyValue('--bg').trim();
      ctx.stroke();
      const initials = String(node.label || node.id || '?').trim().slice(0, 2).toUpperCase();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 15px sans-serif';
      const tw = ctx.measureText(initials).width;
      ctx.fillText(initials, node.x - tw / 2, node.y + 5);
      drawLabel(node.label || node.id, node.x, node.y, styles);
    });

    ctx.restore();
  }

  function refreshGraph(fit = false) {
    if (!resize()) return;
    if (fit) fitToView();
    draw();
  }

  function onMouseDown(e) {
    const point = getLocalPoint(e);
    lastX = point.x;
    lastY = point.y;
    didMove = false;
    activeNode = getNodeAt(point.x, point.y);
    isPanning = !activeNode;
    if (activeNode) {
      selectedNode = activeNode;
      updateInfo(activeNode);
      canvas.style.cursor = 'grabbing';
    } else {
      canvas.style.cursor = 'move';
    }
    draw();
  }

  function onMouseMove(e) {
    const point = getLocalPoint(e);
    const hover = getNodeAt(point.x, point.y);

    if (!activeNode && !isPanning) {
      canvas.style.cursor = hover ? 'grab' : 'default';
      return;
    }

    const dx = point.x - lastX;
    const dy = point.y - lastY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) didMove = true;

    if (activeNode) {
      const p = toWorld(point.x, point.y);
      activeNode.x = p.x;
      activeNode.y = p.y;
      canvas.style.cursor = 'grabbing';
    } else if (isPanning) {
      offsetX += dx;
      offsetY += dy;
      canvas.style.cursor = 'move';
    }

    lastX = point.x;
    lastY = point.y;
    draw();
  }

  function onMouseUp() {
    activeNode = null;
    isPanning = false;
    canvas.style.cursor = 'default';
  }

  function onClick(e) {
    if (didMove) return;
    const point = getLocalPoint(e);
    const node = getNodeAt(point.x, point.y);
    selectedNode = node;
    updateInfo(node);
    draw();
  }

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mouseleave', () => {
    if (!activeNode && !isPanning) canvas.style.cursor = 'default';
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!width || !height) return;
    const point = getLocalPoint(e);
    const before = toWorld(point.x, point.y);
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    scale = Math.max(0.25, Math.min(1.8, scale * delta));
    offsetX = point.x - before.x * scale;
    offsetY = point.y - before.y * scale;
    draw();
  }, { passive: false });

  window.addEventListener('resize', () => refreshGraph(true));
  window.addEventListener('dummy-report-tab-change', (event) => {
    if (event.detail?.id === 'graph') {
      setTimeout(() => refreshGraph(true), 0);
      setTimeout(() => refreshGraph(true), 50);
    }
  });

  layoutNodes();
  updateInfo(null);
  refreshGraph(true);
}

function init() {
  initTheme();
  renderTopSummary();
  renderOverview();
  renderArchitecture();
  renderStructure();
  renderModules();
  renderDependencies();
  renderFlows();
  renderConcepts();
  renderRisks();
  renderGlossary();
  renderDetails();
  renderTabs();
  renderGraph();
  el('themeToggle').addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
}

document.addEventListener('DOMContentLoaded', init);
'''

HTML_TEMPLATE = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>{css}</style>
</head>
<body data-theme="dark">
  <div class="container">
    <div class="header">
      <div class="title-wrap">
        <h1>{project_name}</h1>
        <p class="subtitle">{one_liner}</p>
      </div>
      <div class="controls">
        <button id="themeToggle" type="button">Switch to light</button>
      </div>
    </div>

    <div id="topSummary" class="summary-grid"></div>

    <div class="layout">
      <div class="tabs card">
        <button class="tab-button active" data-tab="overview"><span class="tab-title">Overview</span><span class="tab-desc">Simple explanation first</span></button>
        <button class="tab-button" data-tab="architecture"><span class="tab-title">Architecture</span><span class="tab-desc">Main parts and responsibilities</span></button>
        <button class="tab-button" data-tab="structure"><span class="tab-title">Structure</span><span class="tab-desc">Important folders and files</span></button>
        <button class="tab-button" data-tab="modules"><span class="tab-title">Modules</span><span class="tab-desc">Subsystem-by-subsystem view</span></button>
        <button class="tab-button" data-tab="dependencies"><span class="tab-title">Dependencies</span><span class="tab-desc">Key libraries and tools</span></button>
        <button class="tab-button" data-tab="flows"><span class="tab-title">Flows</span><span class="tab-desc">Important runtime flows</span></button>
        <button class="tab-button" data-tab="concepts"><span class="tab-title">Concepts</span><span class="tab-desc">Patterns explained simply</span></button>
        <button class="tab-button" data-tab="graph"><span class="tab-title">Graph</span><span class="tab-desc">Interactive relationship map</span></button>
        <button class="tab-button" data-tab="risks"><span class="tab-title">Risks</span><span class="tab-desc">Things to watch out for</span></button>
        <button class="tab-button" data-tab="glossary"><span class="tab-title">Glossary</span><span class="tab-desc">Simple definitions</span></button>
        <button class="tab-button" data-tab="details"><span class="tab-title">Details</span><span class="tab-desc">Extra notes</span></button>
      </div>

      <div class="content">
        <section id="overview" class="panel card active">
          <h2>Overview</h2>
          <div id="overviewSimple"></div>
          <div class="grid-2" style="margin-top:16px;">
            <div class="item">
              <h3>Technology stack</h3>
              <div id="stackPills" class="pill-row"></div>
            </div>
            <div class="item">
              <h3>Entry points</h3>
              <div id="entryPoints" class="kv"></div>
            </div>
          </div>
        </section>

        <section id="architecture" class="panel card"><h2>Architecture</h2><div id="architectureContent"></div></section>
        <section id="structure" class="panel card"><h2>Structure</h2><div id="structureContent"></div></section>
        <section id="modules" class="panel card"><h2>Modules</h2><div id="modulesContent"></div></section>
        <section id="dependencies" class="panel card"><h2>Dependencies</h2><div id="dependenciesContent"></div></section>
        <section id="flows" class="panel card"><h2>Flows</h2><div id="flowsContent"></div></section>
        <section id="concepts" class="panel card"><h2>Concepts</h2><div id="conceptsContent"></div></section>
        <section id="graph" class="panel card">
          <h2>Project graph</h2>
          <div class="graph-wrap">
            <canvas id="graphCanvas"></canvas>
            <div class="graph-sidebars">
              <div class="mini-panel card">
                <h3>How to use</h3>
                <p class="note">Click a node to inspect it. Drag a node to move it. Drag empty space to pan. Use the mouse wheel to zoom.</p>
              </div>
              <div class="mini-panel card">
                <h3>Selected node</h3>
                <div id="graphInfo" class="note">Click a node to inspect it.</div>
              </div>
              <div class="legend card">
                <h3>Legend</h3>
                <div id="graphLegend"></div>
              </div>
            </div>
          </div>
        </section>
        <section id="risks" class="panel card"><h2>Risks</h2><div id="risksContent"></div></section>
        <section id="glossary" class="panel card"><h2>Glossary</h2><div id="glossaryContent"></div></section>
        <section id="details" class="panel card"><h2>Details</h2><div id="detailsContent"></div></section>
      </div>
    </div>

    <div class="footer">Generated from structured project analysis. Standalone HTML with inline CSS and JavaScript only.</div>
  </div>
  <script>{js}</script>
</body>
</html>
'''


def load_data(path: Path):
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('Top-level JSON must be an object')
    if not data.get('projectName'):
        raise ValueError('projectName is required')
    summary = data.get('summary') or {}
    if not summary.get('oneLiner'):
        raise ValueError('summary.oneLiner is required')


def render_html(data):
    js = JS.replace('__REPORT_DATA__', json.dumps(data, ensure_ascii=False))
    return HTML_TEMPLATE.format(
        title=html.escape(f"{data.get('projectName', 'Project')} — Project Report"),
        project_name=html.escape(data.get('projectName', 'Project')),
        one_liner=html.escape((data.get('summary') or {}).get('oneLiner', '')),
        css=CSS,
        js=js,
    )


def main(argv):
    if len(argv) != 3:
        print('Usage: render-report.py <input.json> <output.html>', file=sys.stderr)
        return 1
    input_path = Path(argv[1])
    output_path = Path(argv[2])
    data = load_data(input_path)
    validate(data)
    output_path.write_text(render_html(data), encoding='utf-8')
    print(f'Wrote {output_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
