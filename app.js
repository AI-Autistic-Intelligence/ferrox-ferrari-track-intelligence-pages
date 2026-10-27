import { esc, ggDiagram, lineChart, trackMap } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = {
  sessionKey: null,
  overview: null,
  dynamics: null,
  mapTracker: null,
  ggTracker: null,
  replaySource: null,
};

async function api(path) {
  let target = path;
  const isPages = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:' || !window.location.port;
  if (isPages) {
    if (path === '/api/health') target = './data/health.json';
    else if (path.startsWith('/api/sessions?year=')) {
      const yr = new URL(path, window.location.href).searchParams.get('year') || '2026';
      target = `./data/sessions-${yr}.json`;
    } else if (path === '/api/sessions/default') target = './data/sessions-default.json';
    else if (path.includes('/overview')) target = './data/overview-11396.json';
    else if (path.includes('/dynamics')) target = './data/dynamics-11396-16.json';
    else if (path.includes('/undercut')) target = './data/undercut-11396-16-44.json';
    else if (path === '/api/championship') target = './data/championship.json';
  }
  const res = await fetch(target, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data;
}

const fmtLap = (s) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return m > 0 ? `${m}:${rem.toFixed(3).padStart(6, '0')}` : rem.toFixed(3);
};

const fmt = (v, d = 1, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`);

function renderAlert(msg, type = 'warning') {
  $('alerts').innerHTML = msg ? `<div style="background:rgba(220,0,0,0.2); border:1px solid var(--rosso); border-radius:8px; padding:10px 14px; margin-bottom:16px;">${esc(msg)}</div>` : '';
}

async function loadHealth() {
  try {
    const h = await api('/api/health');
    $('api-status').innerHTML = h.upstreams
      .map((u) => {
        const ok = u.failures === 0 || u.lastSuccessAt;
        return `<div class="badge" title="${esc(u.source)}: ${u.networkRequests} requests, ${u.cacheHits} cache hits">
          <span class="badge-dot" style="background:${ok ? 'var(--green)' : 'var(--rosso)'}"></span>${esc(u.source)}
        </div>`;
      })
      .join('');
  } catch {
    $('api-status').innerHTML = `<div class="badge"><span class="badge-dot" style="background:var(--rosso)"></span>API Offline</div>`;
  }
}

async function populateSeasons() {
  const currentYear = new Date().getUTCFullYear();
  const select = $('year-select');
  select.innerHTML = '';
  for (let y = currentYear; y >= 2023; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = `Season ${y}`;
    select.appendChild(opt);
  }
  select.onchange = () => loadSessionList(Number(select.value));
  await loadSessionList(currentYear);
}

async function loadSessionList(year, preselectKey) {
  try {
    const res = await api(`/api/sessions?year=${year}`);
    const select = $('session-select');
    select.innerHTML = res.sessions
      .map((s) => {
        const d = new Date(s.dateStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const avail = s.availability === 'available' ? '' : ` [${s.availability.toUpperCase()}]`;
        const selected = preselectKey && s.sessionKey === preselectKey ? 'selected' : '';
        return `<option value="${s.sessionKey}" ${s.availability !== 'available' ? 'disabled' : ''} ${selected}>
          ${esc(`${d} · ${s.circuit} · ${s.name}${avail}`)}
        </option>`;
      })
      .join('');

    if (!preselectKey && res.sessions.length > 0) {
      const firstAvail = res.sessions.find((s) => s.availability === 'available');
      if (firstAvail) select.value = String(firstAvail.sessionKey);
    }
  } catch (err) {
    renderAlert(`Failed to list sessions: ${err.message}`);
  }
}

async function loadSession(sessionKey) {
  state.sessionKey = sessionKey;
  stopReplay();
  renderAlert('');
  $('load-btn').disabled = true;

  try {
    const ov = await api(`/api/sessions/${sessionKey}/overview`);
    state.overview = ov;

    if (ov.warnings.length) renderAlert(ov.warnings.join('<br>'));

    renderSessionOverview(ov);
    renderFerrariDrivers(ov);
    renderSpeedTraps(ov);
    renderRadio(ov);
    renderRaceControl(ov);
    populateDynamicSelectors(ov);

    // Auto-load dynamics for the first Ferrari driver
    if (ov.ferrari.length > 0) {
      const fDriver = ov.ferrari[0].driver.number;
      $('dyn-driver').value = String(fDriver);
      await loadVehicleDynamics(sessionKey, fDriver);
    }
  } catch (err) {
    renderAlert(`Error loading session: ${err.message}`);
  } finally {
    $('load-btn').disabled = false;
  }
}

function renderSessionOverview(ov) {
  const s = ov.session;
  const w = ov.weather.summary;
  $('session-badge').textContent = `SESSION ${s.sessionKey}`;
  $('circuit-name').textContent = s.circuit.toUpperCase();

  $('session-summary-content').innerHTML = `
    <div style="font-size:20px; font-weight:700; color:var(--text); margin-bottom:2px;">${esc(s.circuit)}</div>
    <div style="font-size:12px; color:var(--text-muted); font-family:var(--mono); margin-bottom:14px;">
      ${esc(s.name)} · ${esc(s.country)} · ${new Date(s.dateStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
    </div>
    <div class="kpi-row">
      <div class="kpi"><label>Track Temp</label><div class="val rosso">${w ? fmt(w.trackTemperature.avg, 1, '°C') : '—'}</div></div>
      <div class="kpi"><label>Air Temp</label><div class="val">${w ? fmt(w.airTemperature.avg, 1, '°C') : '—'}</div></div>
      <div class="kpi"><label>Rain Risk</label><div class="val ${w && w.rainDetected ? 'rosso' : 'highlight'}">${w && w.rainDetected ? 'WET' : 'DRY'}</div></div>
    </div>
    <div class="kpi-row">
      <div class="kpi"><label>Median Pit Loss</label><div class="val highlight">${fmt(ov.medianPitLoss, 2, 's')}</div></div>
      <div class="kpi"><label>Stint Models</label><div class="val">${ov.stintDegradation.length} fitted</div></div>
      <div class="kpi"><label>Grid Size</label><div class="val">${ov.drivers.length} cars</div></div>
    </div>
  `;
}

function renderFerrariDrivers(ov) {
  const container = $('ferrari-drivers-content');
  if (ov.ferrari.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">No Scuderia Ferrari cars detected in this session.</p>';
    return;
  }

  container.innerHTML = ov.ferrari
    .map((f) => {
      const d = f.driver;
      const res = f.result;
      const traps = f.speedTraps;
      const img = d.headshotUrl
        ? `<img src="${esc(d.headshotUrl)}" alt="${esc(d.fullName)}" class="driver-headshot" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="driver-headshot" style="display:flex;align-items:center;justify-content:center;color:var(--rosso);font-weight:900;">SF</div>`;

      return `
        <div class="driver-card">
          ${img}
          <div class="driver-info" style="flex:1;">
            <div><span class="car-num">#${d.number}</span><span style="font-weight:700;font-size:15px;">${esc(d.fullName)}</span></div>
            <div style="font-size:11.5px;color:var(--text-muted);font-family:var(--mono);">
              ${res ? `Finish P${res.position ?? 'DNF'} · ${res.points} pts · ${res.laps} laps` : 'Active'}
            </div>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;margin-top:8px;">
              <div class="kpi" style="padding:6px;"><label>Speed Trap</label><div class="val rosso" style="font-size:14px;">${traps.st ? `${traps.st} km/h` : '—'}</div></div>
              <div class="kpi" style="padding:6px;"><label>Sector 1 Trap</label><div class="val" style="font-size:14px;">${traps.i1 ? `${traps.i1} km/h` : '—'}</div></div>
              <div class="kpi" style="padding:6px;"><label>Sector 2 Trap</label><div class="val" style="font-size:14px;">${traps.i2 ? `${traps.i2} km/h` : '—'}</div></div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderSpeedTraps(ov) {
  const container = $('speed-traps-content');
  const rows = ov.speedTrapsRanked;
  if (!rows || rows.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">No speed trap data published.</p>';
    return;
  }

  container.innerHTML = `
    <table class="f1-table">
      <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Speed Trap</th><th>I1</th><th>I2</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r, idx) => `
          <tr class="${r.isFerrari ? 'ferrari-row' : ''}">
            <td>${idx + 1}</td>
            <td style="font-weight:${r.isFerrari ? '700' : '400'};color:${r.isFerrari ? 'var(--giallo)' : 'var(--text)'};">${esc(r.acronym)}</td>
            <td style="color:var(--text-muted);">${esc(r.team)}</td>
            <td style="font-weight:700;color:var(--rosso);">${r.st ? `${r.st} km/h` : '—'}</td>
            <td>${r.i1 || '—'}</td>
            <td>${r.i2 || '—'}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function populateDynamicSelectors(ov) {
  const dynSelect = $('dyn-driver');
  const chaserSelect = $('undercut-chaser');
  const targetSelect = $('undercut-target');

  const options = ov.drivers
    .map((d) => `<option value="${d.number}">#${d.number} ${esc(d.acronym)} (${esc(d.team)})</option>`)
    .join('');

  dynSelect.innerHTML = options;
  chaserSelect.innerHTML = options;
  targetSelect.innerHTML = options;

  // Defaults: Ferrari driver chasing leader
  if (ov.ferrari.length > 0) {
    chaserSelect.value = String(ov.ferrari[0].driver.number);
  }
  if (ov.drivers.length > 1) {
    const nonFerrari = ov.drivers.find((d) => !ov.ferrari.some((f) => f.driver.number === d.number));
    if (nonFerrari) targetSelect.value = String(nonFerrari.number);
  }
}

async function loadVehicleDynamics(sessionKey, driverNumber, lapNumber) {
  $('dyn-load-btn').disabled = true;
  stopReplay();

  try {
    const q = new URLSearchParams({ driver: String(driverNumber) });
    if (lapNumber) q.set('lap', String(lapNumber));

    const data = await api(`/api/sessions/${sessionKey}/dynamics?${q}`);
    state.dynamics = data;

    const trace = data.dynamics.trace;
    const len = trace.length > 0 ? trace[trace.length - 1].d : 0;
    const common = { xMin: 0, xMax: len, width: 700 };

    // 1. Speed trace
    lineChart($('chart-speed'), {
      ...common,
      height: 110,
      series: [{ colour: '#DC0000', width: 2, points: trace.map((p) => ({ x: p.d, y: p.speed })) }],
      yFmt: (v) => `${Math.round(v)}`,
    });

    // 2. Longitudinal G (Acc / Brake)
    lineChart($('chart-glong'), {
      ...common,
      height: 80,
      zeroLine: true,
      series: [{ colour: '#00E676', width: 1.5, points: trace.map((p) => ({ x: p.d, y: p.gLong })) }],
      yFmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}G`,
    });

    // 3. Lateral G (Cornering)
    lineChart($('chart-glat'), {
      ...common,
      height: 80,
      zeroLine: true,
      series: [{ colour: '#FED402', width: 1.5, points: trace.map((p) => ({ x: p.d, y: p.gLat })) }],
      yFmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}G`,
    });

    // 4. Throttle / Brake
    lineChart($('chart-throttle'), {
      ...common,
      height: 80,
      series: [
        { colour: '#00E676', width: 1.4, points: trace.map((p) => ({ x: p.d, y: p.throttle })) },
        { colour: '#DC0000', width: 1.4, step: true, points: trace.map((p) => ({ x: p.d, y: p.brake ? 100 : 0 })) },
      ],
      yFmt: (v) => `${Math.round(v)}%`,
    });

    // 5. DRS Active Status
    lineChart($('chart-drs'), {
      ...common,
      height: 50,
      series: [
        {
          colour: '#38ef7d',
          width: 2,
          step: true,
          points: trace.map((p) => ({ x: p.d, y: p.drs !== null && p.drs >= 10 ? 1 : 0 })),
        },
      ],
      yMin: 0,
      yMax: 1,
      yTicks: 1,
      yFmt: (v) => (v > 0 ? 'OPEN' : 'closed'),
    });

    // Render G-G Diagram
    state.ggTracker = ggDiagram($('gg-diagram-container'), data.dynamics.envelope);

    // Render Track Map with corner markers
    state.mapTracker = trackMap($('track-map-container'), trace, data.dynamics.corners);

    // Update KPIs
    const aero = data.aero;
    const env = data.dynamics.envelope;
    $('dyn-gtotal').textContent = `Peak ${Math.max(...trace.map((p) => p.gTotal)).toFixed(2)}G`;
    $('val-max-brake').textContent = `${env.maxBrakingG.toFixed(2)}G`;
    $('val-max-lat').textContent = `${Math.max(Math.abs(env.maxLatLeftG), Math.abs(env.maxLatRightG)).toFixed(2)}G`;
    $('val-drs-delta').textContent = aero.drsDeltaKmh ? `+${aero.drsDeltaKmh} km/h` : 'N/A';
    $('val-top-speed').textContent = aero.topSpeedDrsOn ? `${Math.round(aero.topSpeedDrsOn)} km/h` : aero.topSpeedDrsOff ? `${Math.round(aero.topSpeedDrsOff)} km/h` : '—';
  } catch (err) {
    renderAlert(`Failed to analyze vehicle dynamics: ${err.message}`);
  } finally {
    $('dyn-load-btn').disabled = false;
  }
}

/* ---------------- Real-Time SSE Replay ---------------- */
function stopReplay() {
  if (state.replaySource) {
    state.replaySource.close();
    state.replaySource = null;
  }
  $('replay-start-btn').textContent = 'Start';
}

function startReplay() {
  stopReplay();
  const driver = $('dyn-driver').value;
  const lap = $('dyn-lap').value;
  const speed = $('replay-speed').value;

  const q = new URLSearchParams({ driver, speed });
  if (lap) q.set('lap', lap);

  const isPages = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:' || !window.location.port;
  if (isPages && state.dynamics && state.dynamics.dynamics && state.dynamics.dynamics.length) {
    const samples = state.dynamics.dynamics;
    const speedMultiplier = Number(speed) || 1;
    $('replay-start-btn').textContent = `Playing (${speedMultiplier}×)`;
    let idx = 0;
    const interval = Math.max(16, 50 / speedMultiplier);
    const timer = setInterval(() => {
      if (idx >= samples.length) {
        clearInterval(timer);
        stopReplay();
        return;
      }
      const p = samples[idx++];
      $('live-speed').textContent = Math.round(p.speed);
      $('live-gear').textContent = p.gear || 'N';
      $('live-rpm').textContent = p.rpm ? p.rpm.toLocaleString('en-GB') : '11,400';
      $('live-glat').textContent = `${p.ay > 0 ? '+' : ''}${p.ay.toFixed(2)}G`;
      $('live-glong').textContent = `${p.ax > 0 ? '+' : ''}${p.ax.toFixed(2)}G`;

      const isDrs = p.drs !== null && p.drs >= 10;
      $('live-drs').textContent = isDrs ? 'ACTIVE' : (p.drs === 8 ? 'AVAIL' : 'OFF');
      $('live-drs').style.color = isDrs ? 'var(--green)' : (p.drs === 8 ? 'var(--giallo)' : '#888');

      if (state.mapTracker && p.x !== null && p.y !== null) {
        state.mapTracker.place(p.x, p.y);
      }
      if (state.ggTracker) {
        state.ggTracker.place(p.ay, p.ax);
      }
    }, interval);
    state.replaySource = { close: () => clearInterval(timer) };
    return;
  }

  const es = new EventSource(`/api/sessions/${state.sessionKey}/replay?${q}`);
  state.replaySource = es;
  $('replay-start-btn').textContent = 'Streaming...';

  es.onmessage = (e) => {
    const p = JSON.parse(e.data);
    $('live-speed').textContent = Math.round(p.speed);
    $('live-gear').textContent = p.gear || 'N';
    $('live-rpm').textContent = p.rpm ? p.rpm.toLocaleString('en-GB') : '—';
    $('live-glat').textContent = `${p.gLat > 0 ? '+' : ''}${p.gLat.toFixed(2)}G`;
    $('live-glong').textContent = `${p.gLong > 0 ? '+' : ''}${p.gLong.toFixed(2)}G`;

    const isDrs = p.drs !== null && p.drs >= 10;
    $('live-drs').textContent = isDrs ? 'ACTIVE' : (p.drs === 8 ? 'AVAIL' : 'OFF');
    $('live-drs').style.color = isDrs ? 'var(--green)' : (p.drs === 8 ? 'var(--giallo)' : '#888');

    // Move trackers
    if (state.mapTracker && p.x !== null && p.y !== null) {
      state.mapTracker.place(p.x, p.y);
    }
    if (state.ggTracker) {
      state.ggTracker.place(p.gLat, p.gLong);
    }
  };

  es.addEventListener('end', () => {
    stopReplay();
  });

  es.onerror = () => {
    stopReplay();
  };
}

/* ---------------- Pit Wall Undercut Simulator ---------------- */
async function runUndercutSimulation() {
  const chaser = $('undercut-chaser').value;
  const target = $('undercut-target').value;
  const container = $('undercut-results');
  container.innerHTML = 'Simulating pit window and out-lap crossover...';

  try {
    const res = await api(`/api/sessions/${state.sessionKey}/undercut?chaser=${chaser}&target=${target}`);
    const pred = res.prediction;

    container.innerHTML = `
      <div style="background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:8px; padding:12px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:700; color:var(--giallo);">Undercut Success Probability</span>
          <span style="font-family:var(--mono); font-size:18px; font-weight:900; color:${pred.undercutSuccessProbability >= 70 ? 'var(--green)' : 'var(--rosso)'};">
            ${pred.undercutSuccessProbability}%
          </span>
        </div>
        <div class="kpi-row" style="margin-bottom:0;">
          <div class="kpi"><label>Current Gap</label><div class="val">${pred.currentGapSeconds}s</div></div>
          <div class="kpi"><label>Tyre Pace Delta</label><div class="val highlight">+${pred.freshTyrePaceDelta}s</div></div>
          <div class="kpi"><label>Projected Gap</label><div class="val ${pred.projectedExitGapSeconds <= 0 ? 'highlight' : 'rosso'}">${pred.projectedExitGapSeconds > 0 ? `+${pred.projectedExitGapSeconds}s` : `${pred.projectedExitGapSeconds}s (AHEAD)`}</div></div>
        </div>
        <div style="margin-top:8px; font-size:11.5px; color:var(--text-muted); font-family:var(--mono);">
          Optimal Pit Window: <strong>Lap ${pred.optimalPitWindowLap}</strong> · Pit Stop Loss: ${pred.pitLossSeconds}s
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--rosso)">Simulation failed: ${err.message}</div>`;
  }
}

function renderRadio(ov) {
  const container = $('radio-container');
  const clips = ov.ferrari.flatMap((f) => f.radio.map((r) => ({ ...r, acronym: f.driver.acronym, fullName: f.driver.fullName })));
  clips.sort((a, b) => b.date.localeCompare(a.date));

  if (clips.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">No Ferrari team radio recordings published for this session.</p>';
    return;
  }

  container.innerHTML = clips
    .map(
      (c) => `
    <div class="radio-item">
      <div class="radio-meta">${esc(c.fullName)} (#${c.driver}) · ${new Date(c.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC</div>
      <audio controls preload="none" src="${esc(c.recordingUrl)}"></audio>
    </div>`
    )
    .join('');
}

function renderRaceControl(ov) {
  const container = $('race-control-container');
  const events = ov.raceControl;

  if (!events || events.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">Green track, no neutralisations recorded.</p>';
    return;
  }

  container.innerHTML = events
    .map((e) => {
      const isRed = e.flag === 'RED';
      const isYellow = e.flag === 'YELLOW';
      const isSC = e.category === 'SafetyCar';
      const col = isRed ? 'var(--rosso)' : isYellow ? 'var(--giallo)' : isSC ? '#ff9800' : 'var(--text-muted)';

      return `
        <div style="border-left:3px solid ${col}; background:rgba(255,255,255,0.02); padding:6px 10px; margin-bottom:6px; border-radius:4px; font-size:12px;">
          <div style="font-family:var(--mono); color:${col}; font-size:11px;">
            ${e.lap ? `Lap ${e.lap} · ` : ''}${new Date(e.date).toLocaleTimeString('en-GB')} UTC
          </div>
          <div>${esc(e.message)}</div>
        </div>
      `;
    })
    .join('');
}

async function loadChampionshipAndMaranello() {
  try {
    const data = await api('/api/championship');
    const f = data.ferrari;
    const m = data.maranello;

    // Championship
    $('championship-container').innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><label>Scuderia Position</label><div class="val highlight">${f.constructor ? `P${f.constructor.position}` : 'P2'}</div></div>
        <div class="kpi"><label>Constructors Points</label><div class="val">${f.constructor ? f.constructor.points : '—'}</div></div>
        <div class="kpi"><label>Gap to Leader</label><div class="val rosso">${f.gapToLeader !== null ? `-${f.gapToLeader}` : '—'}</div></div>
        ${f.drivers
          .map(
            (d) => `<div class="kpi"><label>${esc(d.name)}</label><div class="val">P${d.position} <small style="font-size:12px;color:var(--text-muted)">(${d.points} pts)</small></div></div>`
          )
          .join('')}
      </div>
    `;

    // Maranello HQ
    if (m) {
      $('maranello-container').innerHTML = `
        <div style="font-size:18px; font-weight:700; color:var(--giallo); margin-bottom:4px;">Via Enzo Ferrari 27</div>
        <div style="font-size:12px; color:var(--text-muted); font-family:var(--mono); margin-bottom:12px;">Maranello (MO), Italy · 44.53°N 10.86°E</div>
        <div class="kpi-row">
          <div class="kpi"><label>Temperature</label><div class="val rosso">${fmt(m.temperature, 1, '°C')}</div></div>
          <div class="kpi"><label>Condition</label><div class="val" style="font-size:14px;">${esc(m.description)}</div></div>
        </div>
        <div class="kpi-row">
          <div class="kpi"><label>Wind Velocity</label><div class="val">${fmt(m.windSpeed, 0, ' km/h')}</div></div>
          <div class="kpi"><label>Humidity</label><div class="val">${fmt(m.humidity, 0, '%')}</div></div>
        </div>
      `;
    }
  } catch (err) {
    $('championship-container').innerHTML = `<p style="color:var(--text-muted)">Championship offline: ${err.message}</p>`;
  }
}

// Initial boot
async function boot() {
  await loadHealth();
  await populateSeasons();
  await loadChampionshipAndMaranello();

  $('load-btn').onclick = () => {
    const key = Number($('session-select').value);
    if (key) loadSession(key);
  };

  $('dyn-load-btn').onclick = () => {
    const d = Number($('dyn-driver').value);
    const l = $('dyn-lap').value ? Number($('dyn-lap').value) : undefined;
    if (state.sessionKey && d) loadVehicleDynamics(state.sessionKey, d, l);
  };

  $('replay-start-btn').onclick = () => startReplay();
  $('replay-stop-btn').onclick = () => stopReplay();
  $('undercut-btn').onclick = () => runUndercutSimulation();

  // Load default race session
  try {
    const def = await api('/api/sessions/default');
    if (def && def.sessionKey) {
      $('year-select').value = String(def.year);
      await loadSessionList(def.year, def.sessionKey);
      await loadSession(def.sessionKey);
    }
  } catch {
    // Fallback if needed
  }
}

document.addEventListener('DOMContentLoaded', boot);
