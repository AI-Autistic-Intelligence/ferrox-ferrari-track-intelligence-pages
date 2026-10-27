/**
 * Vector SVG Charting Engine for Ferrox Track Intelligence.
 * Zero external libraries (no D3, no Chart.js), sub-millisecond DOM render.
 */

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function lineChart(container, opts) {
  if (!container) return;
  const series = opts.series || [];
  const valid = series.filter((s) => s.points && s.points.length > 0);

  if (valid.length === 0) {
    container.innerHTML = `<div class="chart-empty">${esc(opts.empty || 'No telemetry data')}</div>`;
    return;
  }

  const allPts = valid.flatMap((s) => s.points);
  const xMin = opts.xMin ?? Math.min(...allPts.map((p) => p.x));
  const xMax = opts.xMax ?? Math.max(...allPts.map((p) => p.x));
  const yMin = opts.yMin ?? Math.min(...allPts.map((p) => p.y));
  const yMax = opts.yMax ?? Math.max(...allPts.map((p) => p.y));

  const padX = 45;
  const padY = 16;
  const W = opts.width || 720;
  const H = opts.height || 140;
  const plotW = W - padX - 16;
  const plotH = H - padY * 2;

  const dx = xMax - xMin || 1;
  const dy = yMax - yMin || 1;

  const sx = (x) => padX + ((x - xMin) / dx) * plotW;
  const sy = (y) => padY + plotH - ((y - yMin) / dy) * plotH;

  // Grid lines
  let gridHtml = '';
  const yTicks = opts.yTicks || 3;
  for (let i = 0; i <= yTicks; i++) {
    const val = yMin + (dy * i) / yTicks;
    const yPos = sy(val);
    const label = opts.yFmt ? opts.yFmt(val) : Math.round(val);
    gridHtml += `<line x1="${padX}" y1="${yPos}" x2="${W - 16}" y2="${yPos}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="3 3"/>`;
    gridHtml += `<text x="${padX - 8}" y="${yPos + 4}" fill="#777" font-size="10" font-family="JetBrains Mono, monospace" text-anchor="end">${esc(label)}</text>`;
  }

  // Zero-line if configured
  if (opts.zeroLine && yMin < 0 && yMax > 0) {
    const y0 = sy(0);
    gridHtml += `<line x1="${padX}" y1="${y0}" x2="${W - 16}" y2="${y0}" stroke="rgba(255,255,255,0.25)" stroke-width="1.2"/>`;
  }

  // Paths
  let pathsHtml = '';
  for (const s of valid) {
    let d = '';
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      const px = sx(p.x);
      const py = sy(p.y);
      if (i === 0) d += `M${px},${py}`;
      else if (s.step) d += `H${px}V${py}`;
      else d += `L${px},${py}`;
    }
    const strokeW = s.width || 1.8;
    pathsHtml += `<path d="${d}" fill="none" stroke="${s.colour}" stroke-width="${strokeW}" stroke-linejoin="round"/>`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="none">
      ${gridHtml}
      ${pathsHtml}
    </svg>
  `;
}

/**
 * Visualizes the 2D traction friction envelope (G-G Diagram).
 * Horizontal: Lateral G (cornering left/right)
 * Vertical: Longitudinal G (acceleration / braking)
 */
export function ggDiagram(container, envelope, opts = {}) {
  if (!container) return;
  const size = opts.size || 260;
  const maxG = 5.0; // Standard F1 5G envelope limit
  const center = size / 2;
  const scale = (size / 2 - 20) / maxG;

  const toX = (gLat) => center + gLat * scale;
  const toY = (gLong) => center - gLong * scale;

  // Circles for 1G, 2G, 3G, 4G, 5G
  let ringsHtml = '';
  for (let g = 1; g <= 5; g++) {
    const r = g * scale;
    ringsHtml += `<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="rgba(255,255,255,${g === 5 ? '0.18' : '0.07'})" stroke-dasharray="${g === 5 ? 'none' : '2 2'}"/>`;
    ringsHtml += `<text x="${center + 4}" y="${center - r + 11}" fill="#555" font-size="9" font-family="JetBrains Mono, monospace">${g}G</text>`;
  }

  // Axes
  const axesHtml = `
    <line x1="16" y1="${center}" x2="${size - 16}" y2="${center}" stroke="rgba(255,255,255,0.18)"/>
    <line x1="${center}" y1="16" x2="${center}" y2="${size - 16}" stroke="rgba(255,255,255,0.18)"/>
    <text x="${size - 14}" y="${center - 6}" fill="#777" font-size="9" text-anchor="end">Right</text>
    <text x="16" y="${center - 6}" fill="#777" font-size="9">Left</text>
    <text x="${center + 6}" y="24" fill="#777" font-size="9">Acc (+G)</text>
    <text x="${center + 6}" y="${size - 18}" fill="#777" font-size="9">Brake (-G)</text>
  `;

  // Scatter dots
  let dotsHtml = '';
  const samples = envelope.samples || [];
  for (const s of samples) {
    const px = toX(s.gLat);
    const py = toY(s.gLong);
    const speedRatio = Math.max(0, Math.min(1, (s.speed - 80) / 240));
    // Color gradient from yellow (low speed) to Rosso Corsa (high speed)
    const dotColour = `hsl(${55 - speedRatio * 55}, 100%, 50%)`;
    dotsHtml += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.2" fill="${dotColour}" opacity="0.75"/>`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" class="gg-svg">
      ${ringsHtml}
      ${axesHtml}
      ${dotsHtml}
      <circle id="gg-live-dot" cx="${center}" cy="${center}" r="4.5" fill="#FED402" stroke="#000" stroke-width="1.5" style="display:none"/>
    </svg>
  `;

  return {
    place(gLat, gLong) {
      const dot = container.querySelector('#gg-live-dot');
      if (dot && Number.isFinite(gLat) && Number.isFinite(gLong)) {
        dot.style.display = 'block';
        dot.setAttribute('cx', toX(gLat).toFixed(1));
        dot.setAttribute('cy', toY(gLong).toFixed(1));
      }
    },
  };
}

/**
 * Real Track Map generated from 2D (x, y) GPS coordinates.
 */
export function trackMap(container, points, corners = [], opts = {}) {
  if (!container || !points || points.length === 0) return null;

  const valid = points.filter((p) => p.x !== null && p.y !== null);
  if (valid.length < 2) return null;

  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const size = opts.size || 380;
  const pad = 28;
  const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanY);

  const tx = (x) => pad + (x - minX) * scale;
  const ty = (y) => size - (pad + (y - minY) * scale); // Invert Y for standard SVG coordinates

  let pathD = '';
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const px = tx(p.x).toFixed(1);
    const py = ty(p.y).toFixed(1);
    pathD += i === 0 ? `M${px},${py}` : `L${px},${py}`;
  }

  // Corner apex markers
  let cornersHtml = '';
  for (const c of corners) {
    const cx = tx(c.x).toFixed(1);
    const cy = ty(c.y).toFixed(1);
    cornersHtml += `
      <g class="corner-marker" transform="translate(${cx}, ${cy})">
        <circle r="6" fill="#141619" stroke="#FED402" stroke-width="1.5"/>
        <text y="3" text-anchor="middle" font-size="8" font-weight="700" fill="#FED402" font-family="JetBrains Mono">${c.index}</text>
      </g>
    `;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" class="track-svg">
      <path d="${pathD}" class="track-bg" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pathD}" class="track-outline" fill="none" stroke="#DC0000" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${cornersHtml}
      <circle id="car-dot" cx="-99" cy="-99" r="6" fill="#FED402" stroke="#111" stroke-width="2"/>
    </svg>
  `;

  return {
    place(x, y) {
      const dot = container.querySelector('#car-dot');
      if (dot && x !== null && y !== null) {
        dot.setAttribute('cx', tx(x).toFixed(1));
        dot.setAttribute('cy', ty(y).toFixed(1));
      }
    },
  };
}
