(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const COLORS = ['#c8102e', '#1f6feb', '#1f9d55', '#e8710a', '#8250df', '#0aa2b5', '#d63384', '#7a6400', '#3d3d3d', '#b35900'];
  const MAX_PLAYERS = 10;
  const PEER_PREFIX = 'skanekoll-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const SETS = {
    kommun: { label: 'Kommunhuvudorter', filter: (t) => t.k === 1 },
    stor: { label: 'Större orter', filter: (t) => t.k === 1 || t.pop >= 2000 },
    alla: { label: 'Alla orter', filter: () => true },
  };

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('skanekoll.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('skanekoll.' + key, JSON.stringify(value)); } catch { /* ignoreras */ }
    },
  };

  const settings = {
    set: store.get('set', 'kommun'),
    localRounds: store.get('localRounds', 10),
    tiles: store.get('tiles', false),
  };
  if (!SETS[settings.set]) settings.set = 'kommun';

  // ---------- hjälpfunktioner ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const townsFor = (set) => TOWNS.filter(SETS[set].filter);
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const pointsFor = (km) => Math.round(1000 * Math.exp(-km / 18));
  function fmtKm(km) {
    if (km == null) return '–';
    if (km < 1) return Math.round(km * 1000) + ' m';
    return km.toLocaleString('sv-SE', { maximumFractionDigits: km < 10 ? 1 : 0 }) + ' km';
  }
  const fmtPts = (p) => p.toLocaleString('sv-SE') + ' p';
  function fmtTime(ms) {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function cleanName(s) { return s.trim().replace(/\s+/g, ' ').slice(0, 16); }

  let toastTimer = null;
  function toast(text, ms = 2600) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------- karta ----------
  const SKANE_BOUNDS = L.latLngBounds([55.32, 12.42], [56.57, 14.62]);
  const map = L.map('map', {
    zoomControl: false,
    zoomSnap: 0.25,
    minZoom: 7,
    maxZoom: 13,
    doubleClickZoom: false,
    maxBounds: SKANE_BOUNDS.pad(0.6),
    maxBoundsViscosity: 0.8,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Kartdata: Natural Earth · Orter: GeoNames');
  map.fitBounds(SKANE_BOUNDS);

  const otherStyle = { color: '#cbc4b4', weight: 1, fillColor: '#e2ddd0', fillOpacity: 1 };
  const othersLayer = L.geoJSON([GEO.sweden, GEO.denmark], { style: otherStyle, interactive: false }).addTo(map);
  const skaneLayer = L.geoJSON(GEO.skane, { interactive: false }).addTo(map);
  const gameLayer = L.layerGroup().addTo(map);

  // Bakgrundskarta med vägar: OpenFreeMap (gratis vektorkarta utan API-nyckel) där alla
  // ortnamn och etiketter tas bort så att man inte kan fuska. Laddas först när den slås på.
  // Går den inte att ladda (eller saknas WebGL) används Esris grå karta utan namn i stället.
  const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  let baseLayer = null;
  let baseLoading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Kunde inte ladda ' + src));
      document.head.appendChild(s);
    });
  }
  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
  }
  async function vectorBase() {
    if (!hasWebGL()) throw new Error('WebGL saknas');
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/maplibre/maplibre-gl.css';
    document.head.appendChild(css);
    await loadScript('vendor/maplibre/maplibre-gl.js');
    await loadScript('vendor/maplibre/leaflet-maplibre-gl.js');
    const res = await fetch('https://tiles.openfreemap.org/styles/positron');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const style = await res.json();
    style.layers = style.layers.filter((l) => l.type !== 'symbol');
    return L.maplibreGL({ style, attributionControl: { customAttribution: '<a href="https://openfreemap.org">OpenFreeMap</a> ' + OSM_ATTR } });
  }
  function rasterBase() {
    return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Bakgrund © Esri',
      maxZoom: 16,
    });
  }
  function getBaseLayer() {
    if (!baseLoading) {
      baseLoading = vectorBase()
        .catch((err) => {
          console.warn('Vektorkartan gick inte att ladda, använder Esri:', err);
          return rasterBase();
        })
        .then((layer) => (baseLayer = layer));
    }
    return baseLoading;
  }

  function applyTiles() {
    if (settings.tiles) {
      getBaseLayer().then((layer) => { if (settings.tiles) layer.addTo(map); });
      othersLayer.setStyle({ ...otherStyle, fillOpacity: 0.55 });
      skaneLayer.setStyle({ color: '#c8102e', weight: 2, fillOpacity: 0 });
    } else {
      if (baseLayer) map.removeLayer(baseLayer);
      othersLayer.setStyle(otherStyle);
      skaneLayer.setStyle({ color: '#8f8571', weight: 1.5, fillColor: '#f6f1e4', fillOpacity: 1 });
    }
  }
  applyTiles();

  let onMapClick = null;
  map.on('click', (e) => { if (onMapClick) onMapClick(e.latlng); });

  function mapPadding() {
    const top = $('hud').classList.contains('hidden') ? 10 : document.querySelector('.hud-top').offsetHeight + 12;
    const bottomEl = $('hud-bottom');
    const bottom = $('hud').classList.contains('hidden') || bottomEl.classList.contains('hidden') ? 10 : bottomEl.offsetHeight + 24;
    return { paddingTopLeft: [10, top], paddingBottomRight: [10, bottom] };
  }
  function fitSkane() {
    map.invalidateSize();
    map.fitBounds(SKANE_BOUNDS, { ...mapPadding(), animate: false });
  }
  function fitPoints(latlngs) {
    map.invalidateSize();
    map.flyToBounds(L.latLngBounds(latlngs).pad(0.25), { ...mapPadding(), maxZoom: 9, duration: 0.6 });
  }

  function answerMarker(town) {
    const m = L.circleMarker([town.lat, town.lon], {
      radius: 8, color: '#c8102e', weight: 3, fillColor: '#ffcd00', fillOpacity: 1, interactive: false,
    });
    m.bindTooltip(esc(town.n), { permanent: true, direction: 'top', offset: [0, -8], className: 'town-label answer' });
    return m;
  }
  function guessMarker(lat, lon, color, label) {
    const m = L.circleMarker([lat, lon], {
      radius: 7, color: '#fff', weight: 2.5, fillColor: color, fillOpacity: 1, interactive: false,
    });
    if (label) {
      m.bindTooltip(esc(label), { permanent: true, direction: 'bottom', offset: [0, 6], className: 'player-label' });
    }
    return m;
  }
  function guessLine(a, b, color) {
    return L.polyline([a, b], { color, weight: 2, dashArray: '5 6', opacity: 0.9, interactive: false });
  }

  // ---------- skärmar & HUD ----------
  function show(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== screenId));
    $('overlay').classList.toggle('empty', !screenId);
  }

  const hud = {
    show(on) {
      $('hud').classList.toggle('hidden', !on);
      if (on) this.measure();
    },
    measure() {
      document.documentElement.style.setProperty('--hud-h', document.querySelector('.hud-top').offsetHeight + 'px');
    },
    set({ label, town, round, score }) {
      if (label !== undefined) $('hud-label').textContent = label;
      if (town !== undefined) $('hud-town').textContent = town;
      if (round !== undefined) $('hud-round').textContent = round;
      if (score !== undefined) $('hud-score').textContent = score;
    },
    msgTimer: null,
    msg(text, cls = '', ms = 1600) {
      const el = $('hud-msg');
      el.textContent = text;
      el.className = 'hud-msg ' + cls;
      clearTimeout(this.msgTimer);
      if (ms) this.msgTimer = setTimeout(() => el.classList.add('hidden'), ms);
    },
    clearMsg() { clearTimeout(this.msgTimer); $('hud-msg').classList.add('hidden'); },
    bottom(on) { $('hud-bottom').classList.toggle('hidden', !on); },
    info(html) { $('hud-info').innerHTML = html; },
    actionHandler: null,
    action(text, enabled, handler) {
      const b = $('hud-action');
      b.classList.toggle('hidden', text == null);
      if (text != null) b.textContent = text;
      b.disabled = !enabled;
      if (handler !== undefined) this.actionHandler = handler;
    },
    timerEnd: null,
    timerTick: null,
    startTimer(ms, onDone) {
      this.stopTimer();
      const wrap = $('hud-timer'), bar = $('hud-timer-bar');
      wrap.classList.remove('hidden');
      bar.classList.remove('low');
      bar.style.transition = 'none';
      bar.style.width = '100%';
      void bar.offsetWidth;
      bar.style.transition = `width ${ms}ms linear`;
      bar.style.width = '0%';
      this.timerEnd = Date.now() + ms;
      this.timerTick = setInterval(() => {
        const left = this.timerEnd - Date.now();
        if (left <= 5000) bar.classList.add('low');
        if (left <= 0) {
          this.stopTimer(true);
          onDone();
        }
      }, 100);
    },
    stopTimer(keepVisible) {
      clearInterval(this.timerTick);
      this.timerTick = null;
      if (!keepVisible) $('hud-timer').classList.add('hidden');
    },
  };
  $('hud-action').addEventListener('click', () => { if (hud.actionHandler) hud.actionHandler(); });
  window.addEventListener('resize', () => { if (!$('hud').classList.contains('hidden')) hud.measure(); });

  // Nuvarande spel – har en stop()-funktion för att städa upp
  let game = null;
  let againFn = null;

  function stopGame() {
    if (game && game.stop) game.stop();
    game = null;
    onMapClick = null;
    hud.stopTimer();
    hud.clearMsg();
    gameLayer.clearLayers();
  }

  function goHome() {
    stopGame();
    hud.show(false);
    show('screen-home');
    fitSkane();
  }

  $('hud-quit').addEventListener('click', () => {
    if (game && game.confirmQuit && !confirm(game.confirmQuit)) return;
    if (game && game.onQuit) game.onQuit();
    goHome();
  });

  function showResults({ title, sub, rows, again }) {
    hud.stopTimer();
    hud.show(false);
    onMapClick = null;
    fitSkane();
    $('results-title').textContent = title;
    $('results-sub').textContent = sub || '';
    $('results-list').innerHTML = rows.map((r, i) => `
      <li class="${r.first ? 'first' : ''}">
        <span class="pos">${r.pos ?? i + 1}</span>
        <span class="who">${r.color ? `<span class="dot" style="background:${r.color}"></span>` : ''}<span>${esc(r.name)}</span></span>
        <span class="pts">${esc(r.value)}${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</span>
      </li>`).join('');
    $('results-list').classList.toggle('hidden', rows.length === 0);
    againFn = again;
    $('results-again').classList.toggle('hidden', !again);
    show('screen-results');
  }
  $('results-home').addEventListener('click', () => {
    if (game && game.onResultsHome) game.onResultsHome();
    goHome();
  });
  $('results-again').addEventListener('click', () => { if (againFn) againFn(); });

  function roundTable(rows) {
    const best = rows.find((r) => r.d != null);
    return `<table class="round-table">${rows.map((r) => `
      <tr class="${r === best ? 'best' : ''}">
        <td class="n"><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</td>
        <td class="r ${r.d == null ? 'muted' : ''}">${r.d == null ? 'ingen gissning' : fmtKm(r.d)}</td>
        <td class="r">+${r.pts}</td>
        <td class="r muted">${fmtPts(r.total)}</td>
      </tr>`).join('')}</table>`;
  }

  function standings(players) {
    const sorted = players.slice().sort((a, b) => b.total - a.total || a.km - b.km);
    let pos = 0;
    return sorted.map((p, i) => {
      if (i === 0 || p.total !== sorted[i - 1].total) pos = i + 1;
      return {
        pos, first: pos === 1, name: p.name, color: p.color, value: fmtPts(p.total),
        detail: p.guesses ? 'snitt ' + fmtKm(p.km / p.guesses) : 'inga gissningar',
      };
    });
  }

  // ---------- Öva: Hitta orten (Seterra-stil) ----------
  function startFind() {
    stopGame();
    const all = townsFor(settings.set);
    const queue = shuffle(all);
    const g = { idx: 0, wrong: 0, firstTry: 0, misses: [], start: Date.now(), done: new Set(), markers: new Map(), clock: null };
    game = g;
    g.confirmQuit = 'Avsluta övningen?';
    g.stop = () => clearInterval(g.clock);
    againFn = null;

    show(null);
    hud.show(true);
    hud.bottom(false);
    hud.set({ label: 'Klicka på', town: queue[0].n, round: `1/${queue.length}`, score: '0:00' });
    fitSkane();

    const radius = all.length > 100 ? 4.5 : all.length > 40 ? 5.5 : 7;
    for (const t of all) {
      const m = L.circleMarker([t.lat, t.lon], {
        radius, color: '#1d1d1f', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1, bubblingMouseEvents: false,
      });
      m.on('click', () => clickTown(t));
      m.addTo(gameLayer);
      g.markers.set(t, m);
    }
    g.clock = setInterval(() => hud.set({ score: fmtTime(Date.now() - g.start) }), 500);

    function clickTown(t) {
      const target = queue[g.idx];
      if (!target) return;
      const m = g.markers.get(t);
      if (g.done.has(t)) {
        hud.msg(`Det där är ${t.n}`, '', 1200);
        return;
      }
      if (t === target) {
        const color = ['#1f9d55', '#e0a100', '#e8710a'][g.wrong] || '#d1242f';
        m.setStyle({ fillColor: color, color: '#fff', weight: 2 });
        m.getElement()?.classList.remove('pulse');
        m.bindTooltip(esc(t.n), { direction: 'top', className: 'town-label' });
        g.done.add(t);
        if (g.wrong === 0) { g.firstTry++; hud.msg('Rätt!', 'good', 700); } else {
          g.misses.push({ t, wrong: g.wrong });
          hud.clearMsg();
        }
        g.wrong = 0;
        g.idx++;
        if (g.idx >= queue.length) return finishFind();
        hud.set({ town: queue[g.idx].n, round: `${g.idx + 1}/${queue.length}` });
      } else {
        g.wrong++;
        m.setStyle({ fillColor: '#d1242f' });
        setTimeout(() => { if (!g.done.has(t)) m.setStyle({ fillColor: '#ffffff' }); }, 500);
        if (g.wrong >= 3) {
          const tm = g.markers.get(target);
          tm.setStyle({ fillColor: '#d1242f' });
          tm.getElement()?.classList.add('pulse');
          tm.bringToFront();
          hud.msg(`Nä, det där är ${t.n}. Rätt svar blinkar!`, 'bad', 2400);
        } else {
          hud.msg(`Nä, det där är ${t.n}`, 'bad', 1400);
        }
      }
    }

    function finishFind() {
      clearInterval(g.clock);
      const pct = Math.round((g.firstTry / queue.length) * 100);
      const time = fmtTime(Date.now() - g.start);
      const rows = g.misses.sort((a, b) => b.wrong - a.wrong).slice(0, 12).map((m) => ({
        pos: '✗', name: m.t.n, value: m.wrong === 1 ? '1 fel' : `${m.wrong} fel`,
      }));
      setTimeout(() => showResults({
        title: pct === 100 ? 'Fläckfritt! 🎉' : `${pct} % rätt`,
        sub: `${g.firstTry} av ${queue.length} rätt på första försöket · tid ${time}` + (rows.length ? ' · Orter att öva mer på:' : ''),
        rows,
        again: startFind,
      }), 600);
    }
  }

  // ---------- gemensamt: placera en gissning ----------
  function pinPlacer(color, onChange) {
    let pin = null;
    onMapClick = (ll) => {
      if (pin) pin.setLatLng(ll); else pin = guessMarker(ll.lat, ll.lng, color).addTo(gameLayer);
      onChange(ll);
    };
    return { get: () => (pin ? pin.getLatLng() : null) };
  }

  // ---------- Öva: Gissa var ----------
  function startGuess() {
    stopGame();
    const rounds = 10;
    const towns = shuffle(townsFor(settings.set)).slice(0, rounds);
    const g = { r: -1, total: 0, km: 0, rows: [] };
    game = g;
    g.confirmQuit = 'Avsluta övningen?';
    show(null);
    hud.show(true);
    hud.bottom(true);
    next();

    function next() {
      g.r++;
      if (g.r >= towns.length) return finish();
      const t = towns[g.r];
      gameLayer.clearLayers();
      hud.set({ label: 'Var ligger', town: t.n, round: `${g.r + 1}/${towns.length}`, score: fmtPts(g.total) });
      hud.info('');
      hud.action('Klicka på kartan', false, lock);
      fitSkane();
      g.pin = pinPlacer('#1f6feb', () => hud.action('Lås gissning', true));
    }
    function lock() {
      const t = towns[g.r];
      const ll = g.pin.get();
      if (!ll) return;
      onMapClick = null;
      const d = distanceKm(ll.lat, ll.lng, t.lat, t.lon);
      const pts = pointsFor(d);
      g.total += pts;
      g.km += d;
      g.rows.push({ t, d, pts });
      guessLine(ll, [t.lat, t.lon], '#1f6feb').addTo(gameLayer);
      answerMarker(t).addTo(gameLayer);
      hud.set({ score: fmtPts(g.total) });
      hud.info(`<div class="big">${fmtKm(d)} bort</div>+${pts} poäng`);
      hud.action(g.r === towns.length - 1 ? 'Se resultat' : 'Nästa', true, next);
      fitPoints([ll, [t.lat, t.lon]]);
    }
    function finish() {
      showResults({
        title: fmtPts(g.total),
        sub: `av max ${fmtPts(rounds * 1000)} · snittavstånd ${fmtKm(g.km / rounds)}`,
        rows: g.rows.map((r, i) => ({ pos: i + 1, name: r.t.n, value: fmtKm(r.d), detail: `+${r.pts} p` })),
        again: startGuess,
      });
    }
  }

  // ---------- Tävla: samma enhet ----------
  const local = { players: store.get('localPlayers', []).slice(0, MAX_PLAYERS) };

  function renderLocalSetup() {
    $('local-players').innerHTML = local.players.map((p, i) => `
      <div class="p"><span class="dot" style="background:${COLORS[i]}"></span>${esc(p)}
      <button class="rm" data-i="${i}" aria-label="Ta bort">✕</button></div>`).join('');
    $('local-start').disabled = local.players.length < 2;
    $('local-add').disabled = local.players.length >= MAX_PLAYERS;
    $('local-name').placeholder = local.players.length >= MAX_PLAYERS ? 'Max 10 spelare' : `Spelare ${local.players.length + 1}`;
    store.set('localPlayers', local.players);
  }
  function addLocalPlayer() {
    const name = cleanName($('local-name').value);
    if (!name || local.players.length >= MAX_PLAYERS) return;
    if (local.players.some((p) => p.toLowerCase() === name.toLowerCase())) { toast('Det namnet finns redan'); return; }
    local.players.push(name);
    $('local-name').value = '';
    renderLocalSetup();
    $('local-name').focus();
  }
  $('local-add').addEventListener('click', addLocalPlayer);
  $('local-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addLocalPlayer(); });
  $('local-players').addEventListener('click', (e) => {
    const b = e.target.closest('.rm');
    if (!b) return;
    local.players.splice(+b.dataset.i, 1);
    renderLocalSetup();
  });
  $('local-start').addEventListener('click', startLocal);

  function startLocal() {
    stopGame();
    const towns = shuffle(townsFor(settings.set)).slice(0, settings.localRounds);
    const players = local.players.map((name, i) => ({ name, color: COLORS[i], total: 0, km: 0, guesses: 0 }));
    const g = { r: -1, turn: 0, guesses: [] };
    game = g;
    g.confirmQuit = 'Avsluta spelet?';
    nextRound();

    function nextRound() {
      g.r++;
      if (g.r >= towns.length) return finish();
      g.turn = 0;
      g.guesses = [];
      nextTurn();
    }
    function nextTurn() {
      gameLayer.clearLayers();
      onMapClick = null;
      if (g.turn >= players.length) return reveal();
      const p = players[g.turn];
      hud.show(false);
      $('handover-name').textContent = p.name;
      $('handover-name').style.color = p.color;
      show('screen-handover');
      $('handover-go').onclick = () => {
        show(null);
        hud.show(true);
        hud.bottom(true);
        hud.set({ label: `${p.name}, var ligger`, town: towns[g.r].n, round: `${g.r + 1}/${towns.length}`, score: fmtPts(p.total) });
        hud.info('');
        hud.action('Klicka på kartan', false, lock);
        fitSkane();
        g.pin = pinPlacer(p.color, () => hud.action('Lås gissning', true));
      };
    }
    function lock() {
      const ll = g.pin.get();
      if (!ll) return;
      g.guesses[g.turn] = ll;
      g.turn++;
      nextTurn();
    }
    function reveal() {
      const t = towns[g.r];
      show(null);
      hud.show(true);
      const rows = players.map((p, i) => {
        const ll = g.guesses[i];
        const d = distanceKm(ll.lat, ll.lng, t.lat, t.lon);
        const pts = pointsFor(d);
        p.total += pts; p.km += d; p.guesses++;
        return { name: p.name, color: p.color, lat: ll.lat, lon: ll.lng, d, pts, total: p.total };
      }).sort((a, b) => a.d - b.d);
      hud.set({ label: 'Rätt svar', town: t.n, score: '' });
      hud.info(roundTable(rows));
      drawReveal(t, rows);
      hud.action(g.r === towns.length - 1 ? 'Se resultat' : 'Nästa runda', true, nextRound);
    }
    function finish() {
      const rows = standings(players);
      showResults({ title: `${rows[0].name} vinner! 🏆`, sub: `${towns.length} rundor · ${SETS[settings.set].label}`, rows, again: startLocal });
    }
  }

  function drawReveal(town, rows) {
    gameLayer.clearLayers();
    const pts = [[town.lat, town.lon]];
    for (const r of rows) {
      if (r.lat == null) continue;
      guessLine([r.lat, r.lon], [town.lat, town.lon], r.color).addTo(gameLayer);
      guessMarker(r.lat, r.lon, r.color, rows.length > 1 ? r.name : null).addTo(gameLayer);
      pts.push([r.lat, r.lon]);
    }
    answerMarker(town).addTo(gameLayer);
    hud.bottom(true);
    fitPoints(pts);
  }

  // ---------- Tävla online (PeerJS / WebRTC) ----------
  function peerOptions() {
    const q = new URLSearchParams(location.search);
    if (q.get('peerhost')) {
      return { host: q.get('peerhost'), port: +q.get('peerport') || 9000, path: q.get('peerpath') || '/', secure: q.get('peersecure') === '1', debug: 1 };
    }
    return { debug: 1 };
  }
  const randCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const settingsText = (s) => `${SETS[s.set].label} · ${s.rounds} rundor · ${s.time} s per runda`;

  // Tillståndet för online-spel. Värden (host) bestämmer allt, gästerna visar bara.
  let net = null;

  function netCleanup() {
    if (!net) return;
    net.leaving = true;
    clearTimeout(net.roundTimer);
    clearTimeout(net.joinTimer);
    try { net.peer && net.peer.destroy(); } catch { /* redan stängd */ }
    net = null;
  }

  function onlineGame(confirmText) {
    return {
      confirmQuit: confirmText,
      onQuit: netCleanup,
      onResultsHome: netCleanup,
    };
  }

  // ----- gemensam online-UI -----
  function renderLobby(players, s) {
    const isHost = net.role === 'host';
    $('lobby-code').textContent = net.code;
    $('lobby-count').textContent = `(${players.length}/${MAX_PLAYERS})`;
    $('lobby-players').innerHTML = players.map((p) => `
      <li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}
      <span class="tag">${p.id === 'host' ? 'värd' : ''}${p.id === net.myId ? (p.id === 'host' ? ' · du' : 'du') : ''}</span></li>`).join('');
    $('lobby-settings').classList.toggle('hidden', !isHost);
    $('lobby-guest-settings').classList.toggle('hidden', isHost);
    $('lobby-guest-settings').textContent = settingsText(s);
    $('lobby-start').classList.toggle('hidden', !isHost);
    $('lobby-start').disabled = players.length < 2;
    $('lobby-status').textContent = isHost
      ? (players.length < 2 ? 'Väntar på spelare… Dela koden eller länken!' : 'Starta när alla är med.')
      : 'Väntar på att värden startar spelet…';
    if (isHost) {
      setSeg('lobby-set-seg', s.set);
      setSeg('lobby-rounds-seg', String(s.rounds));
      setSeg('lobby-time-seg', String(s.time));
    }
    net.players = players;
    stopGame();
    game = onlineGame('Lämna rummet?');
    hud.show(false);
    show('screen-lobby');
  }

  function renderWaiting(players, locked) {
    hud.info(`<div class="waiting">${players.filter((p) => p.connected !== false).map((p) => `
      <span class="${locked.includes(p.id) ? 'locked' : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${locked.includes(p.id) ? ' ✓' : ''}</span>`).join('')}</div>`);
  }

  function onRound(msg) {
    stopGame();
    game = onlineGame('Lämna spelet?');
    net.players = msg.players;
    net.round = msg.r;
    net.locked = false;
    const me = msg.players.find((p) => p.id === net.myId);
    show(null);
    hud.show(true);
    hud.bottom(true);
    hud.set({ label: 'Var ligger', town: msg.town, round: `${msg.r + 1}/${msg.total}`, score: fmtPts(me ? me.total : 0) });
    renderWaiting(msg.players, []);
    hud.action('Klicka på kartan', false, lockOnline);
    fitSkane();
    const pin = pinPlacer(me ? me.color : COLORS[0], () => { if (!net.locked) hud.action('Lås gissning', true); });
    net.getPin = pin.get;
    hud.startTimer(msg.ms, () => {
      if (!net || net.locked) return;
      if (pin.get()) lockOnline(); else {
        net.locked = true;
        onMapClick = null;
        hud.action('Tiden är ute!', false);
      }
    });
  }

  function lockOnline() {
    if (!net || net.locked) return;
    const ll = net.getPin();
    if (!ll) return;
    net.locked = true;
    onMapClick = null;
    hud.action('Väntar på de andra…', false);
    const guess = { t: 'guess', r: net.round, lat: ll.lat, lon: ll.lng };
    if (net.role === 'host') hostGuess('host', guess); else net.conn.send(guess);
  }

  function onReveal(msg) {
    if (!game) game = onlineGame('Lämna spelet?');
    hud.stopTimer();
    onMapClick = null;
    show(null);
    hud.show(true);
    const me = msg.rows.find((r) => r.id === net.myId);
    hud.set({ label: 'Rätt svar', town: msg.town.n, round: `${msg.r + 1}/${msg.total}`, score: fmtPts(me ? me.total : 0) });
    hud.info(roundTable(msg.rows));
    drawReveal(msg.town, msg.rows);
    if (net.role === 'host') hud.action(msg.last ? 'Se resultat' : 'Nästa runda', true, msg.last ? hostFinal : hostNextRound);
    else hud.action(msg.last ? 'Väntar på slutresultatet…' : 'Väntar på värden…', false, null);
  }

  function onFinal(msg) {
    const rows = standings(msg.players);
    game = onlineGame(null);
    showResults({
      title: `${rows[0].name} vinner! 🏆`,
      sub: settingsText(msg.settings),
      rows,
      again: net.role === 'host' ? hostBackToLobby : null,
    });
    if (net.role !== 'host') $('results-sub').textContent += ' · Värden kan starta en ny omgång.';
  }

  // ----- värd -----
  function hostCreate(name, attempt = 0) {
    netCleanup();
    const code = randCode();
    const peer = new Peer(PEER_PREFIX + code, peerOptions());
    net = {
      role: 'host', peer, code, myId: 'host', conns: new Map(), phase: 'lobby',
      settings: { set: settings.set, rounds: store.get('onlineRounds', 10), time: store.get('onlineTime', 15) },
      all: [{ id: 'host', name, color: COLORS[0], total: 0, km: 0, guesses: 0, connected: true }],
    };
    const self = net;
    $('host-error').classList.add('hidden');
    $('host-go').disabled = true;
    $('host-go').textContent = 'Skapar…';

    peer.on('open', () => {
      if (net !== self) return;
      $('host-go').disabled = false;
      $('host-go').textContent = 'Skapa';
      hostBroadcastLobby();
    });
    peer.on('connection', (conn) => {
      conn.on('data', (msg) => { if (net === self) hostOnMsg(conn, msg); });
      conn.on('close', () => { if (net === self) hostDrop(conn.peer); });
      conn.on('error', () => { if (net === self) hostDrop(conn.peer); });
    });
    peer.on('disconnected', () => { if (net === self && !self.leaving) peer.reconnect(); });
    peer.on('error', (err) => {
      if (net !== self || self.leaving) return;
      if (err.type === 'unavailable-id' && attempt < 4) return hostCreate(name, attempt + 1);
      if (self.phase === 'lobby' && !peer.open) {
        $('host-go').disabled = false;
        $('host-go').textContent = 'Skapa';
        $('host-error').textContent = 'Kunde inte skapa rummet (' + (err.type || err.message) + '). Kolla internet och försök igen.';
        $('host-error').classList.remove('hidden');
        show('screen-hostname');
        netCleanup();
      } else if (err.type !== 'peer-unavailable') {
        toast('Nätverksfel: ' + (err.type || err.message));
      }
    });
  }

  const publicPlayers = () => net.all.map(({ id, name, color, total, km, guesses, connected }) => ({ id, name, color, total, km, guesses, connected }));

  function hostBroadcast(msg) {
    for (const c of net.conns.values()) { if (c.open) c.send(msg); }
  }
  function hostBroadcastLobby() {
    const players = publicPlayers();
    hostBroadcast({ t: 'lobby', code: net.code, players, settings: net.settings });
    renderLobby(players, net.settings);
  }

  function hostOnMsg(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      const reject = (reason) => { conn.send({ t: 'reject', reason }); setTimeout(() => conn.close(), 500); };
      if (net.phase !== 'lobby') return reject('Spelet har redan börjat. Vänta tills omgången är slut.');
      if (net.all.length >= MAX_PLAYERS) return reject('Rummet är fullt (max 10 spelare).');
      let name = cleanName(String(msg.name || '')) || 'Spelare';
      const base = name;
      for (let n = 2; net.all.some((p) => p.name.toLowerCase() === name.toLowerCase()); n++) name = `${base.slice(0, 13)} ${n}`;
      const used = new Set(net.all.map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[net.all.length % COLORS.length];
      net.all.push({ id: conn.peer, name, color, total: 0, km: 0, guesses: 0, connected: true });
      net.conns.set(conn.peer, conn);
      conn.send({ t: 'welcome', id: conn.peer });
      hostBroadcastLobby();
      toast(`${name} gick med`);
    } else if (msg.t === 'guess') {
      hostGuess(conn.peer, msg);
    }
  }

  function hostDrop(id) {
    if (!net.conns.has(id)) return;
    net.conns.delete(id);
    const p = net.all.find((x) => x.id === id);
    if (!p) return;
    toast(`${p.name} lämnade`);
    if (net.phase === 'lobby') {
      net.all = net.all.filter((x) => x.id !== id);
      hostBroadcastLobby();
    } else {
      p.connected = false;
      if (net.phase === 'round') hostProgress();
    }
  }

  function hostStart() {
    if (net.all.length < 2) return;
    net.towns = shuffle(townsFor(net.settings.set)).slice(0, net.settings.rounds);
    for (const p of net.all) Object.assign(p, { total: 0, km: 0, guesses: 0 });
    net.r = -1;
    hostNextRound();
  }

  function hostNextRound() {
    net.r++;
    if (net.r >= net.towns.length) return hostFinal();
    net.phase = 'round';
    net.guesses = {};
    const ms = net.settings.time * 1000;
    const msg = { t: 'round', r: net.r, total: net.towns.length, town: net.towns[net.r].n, ms, players: publicPlayers() };
    hostBroadcast(msg);
    onRound(msg);
    clearTimeout(net.roundTimer);
    net.roundTimer = setTimeout(hostEndRound, ms + 1500);
  }

  function hostGuess(id, msg) {
    if (net.phase !== 'round' || msg.r !== net.r || net.guesses[id]) return;
    const lat = +msg.lat, lon = +msg.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    net.guesses[id] = { lat, lon };
    hostProgress();
  }

  function hostProgress() {
    const locked = Object.keys(net.guesses);
    const players = publicPlayers();
    hostBroadcast({ t: 'progress', locked, players });
    renderWaiting(players, locked);
    const waiting = net.all.filter((p) => p.connected && !net.guesses[p.id]);
    if (waiting.length === 0) hostEndRound();
  }

  function hostEndRound() {
    if (net.phase !== 'round') return;
    clearTimeout(net.roundTimer);
    net.phase = 'reveal';
    const t = net.towns[net.r];
    const rows = net.all.filter((p) => p.connected || net.guesses[p.id]).map((p) => {
      const g = net.guesses[p.id];
      let d = null, pts = 0;
      if (g) {
        d = distanceKm(g.lat, g.lon, t.lat, t.lon);
        pts = pointsFor(d);
        p.total += pts; p.km += d; p.guesses++;
      }
      return { id: p.id, name: p.name, color: p.color, lat: g ? g.lat : null, lon: g ? g.lon : null, d, pts, total: p.total };
    }).sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    const msg = { t: 'reveal', r: net.r, total: net.towns.length, town: { n: t.n, lat: t.lat, lon: t.lon }, rows, last: net.r === net.towns.length - 1 };
    hostBroadcast(msg);
    onReveal(msg);
  }

  function hostFinal() {
    net.phase = 'final';
    const msg = { t: 'final', players: publicPlayers(), settings: net.settings };
    hostBroadcast(msg);
    onFinal(msg);
  }

  function hostBackToLobby() {
    net.phase = 'lobby';
    net.all = net.all.filter((p) => p.connected);
    for (const p of net.all) Object.assign(p, { total: 0, km: 0, guesses: 0 });
    hostBroadcastLobby();
  }

  // ----- gäst -----
  function joinRoom(code, name) {
    netCleanup();
    const peer = new Peer(peerOptions());
    net = { role: 'guest', peer, code, myId: null, conn: null, players: [] };
    const self = net;
    const fail = (text) => {
      if (net !== self) return;
      netCleanup();
      $('join-go').disabled = false;
      $('join-go').textContent = 'Gå med';
      $('join-error').textContent = text;
      $('join-error').classList.remove('hidden');
      hud.show(false);
      stopGame();
      show('screen-join');
    };
    $('join-error').classList.add('hidden');
    $('join-go').disabled = true;
    $('join-go').textContent = 'Ansluter…';
    self.joinTimer = setTimeout(() => fail(`Hittade inget rum med koden ${code}.`), 12000);

    peer.on('open', () => {
      if (net !== self) return;
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      self.conn = conn;
      conn.on('open', () => conn.send({ t: 'join', name }));
      conn.on('data', (msg) => { if (net === self) guestOnMsg(msg, fail); });
      conn.on('close', () => {
        if (net !== self || self.leaving) return;
        if (!self.myId) return;
        netCleanup();
        toast('Anslutningen till värden bröts.', 4000);
        goHome();
      });
    });
    peer.on('disconnected', () => { if (net === self && !self.leaving) peer.reconnect(); });
    peer.on('error', (err) => {
      if (net !== self || self.leaving) return;
      if (err.type === 'peer-unavailable') {
        if (!self.myId) fail(`Hittade inget rum med koden ${code}.`);
        return;
      }
      if (!self.myId) fail('Kunde inte ansluta (' + (err.type || err.message) + '). Kolla internet och försök igen.');
      else toast('Nätverksfel: ' + (err.type || err.message));
    });
  }

  function guestOnMsg(msg, fail) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        clearTimeout(net.joinTimer);
        net.myId = msg.id;
        $('join-go').disabled = false;
        $('join-go').textContent = 'Gå med';
        break;
      case 'reject':
        clearTimeout(net.joinTimer);
        fail(msg.reason);
        break;
      case 'lobby':
        renderLobby(msg.players, msg.settings);
        break;
      case 'round':
        onRound(msg);
        break;
      case 'progress':
        net.players = msg.players;
        if (net.round !== undefined && !$('hud').classList.contains('hidden')) renderWaiting(msg.players, msg.locked);
        break;
      case 'reveal':
        onReveal(msg);
        break;
      case 'final':
        onFinal(msg);
        break;
    }
  }

  // ---------- menyer ----------
  function setSeg(id, value) {
    document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
  }
  function bindSeg(id, onPick) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      setSeg(id, b.dataset.v);
      onPick(b.dataset.v);
    });
  }
  function updateSetHint() {
    const n = townsFor(settings.set).length;
    $('set-hint').textContent = {
      kommun: `${n} orter – centralorten i varje skånsk kommun. Bra start!`,
      stor: `${n} orter – kommunhuvudorter plus orter med minst 2 000 invånare.`,
      alla: `${n} orter – ända ner till byar med ett par hundra invånare. För riktiga skåningar.`,
    }[settings.set];
  }

  setSeg('set-seg', settings.set);
  updateSetHint();
  bindSeg('set-seg', (v) => { settings.set = v; store.set('set', v); updateSetHint(); });
  setSeg('local-rounds-seg', String(settings.localRounds));
  bindSeg('local-rounds-seg', (v) => { settings.localRounds = +v; store.set('localRounds', +v); });
  bindSeg('lobby-set-seg', (v) => { if (net && net.role === 'host') { net.settings.set = v; hostBroadcastLobby(); } });
  bindSeg('lobby-rounds-seg', (v) => { if (net && net.role === 'host') { net.settings.rounds = +v; store.set('onlineRounds', +v); hostBroadcastLobby(); } });
  bindSeg('lobby-time-seg', (v) => { if (net && net.role === 'host') { net.settings.time = +v; store.set('onlineTime', +v); hostBroadcastLobby(); } });

  $('opt-tiles').checked = settings.tiles;
  $('opt-tiles').addEventListener('change', (e) => { settings.tiles = e.target.checked; store.set('tiles', settings.tiles); applyTiles(); });

  $('go-find').addEventListener('click', startFind);
  $('go-guess').addEventListener('click', startGuess);
  $('go-local').addEventListener('click', () => { renderLocalSetup(); show('screen-local'); });
  $('go-host').addEventListener('click', () => {
    $('host-name').value = store.get('name', '');
    $('host-error').classList.add('hidden');
    show('screen-hostname');
    $('host-name').focus();
  });
  $('go-join').addEventListener('click', () => openJoin(''));
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { netCleanup(); goHome(); }));

  function openJoin(code) {
    $('join-code').value = code;
    $('join-name').value = store.get('name', '');
    $('join-error').classList.add('hidden');
    show('screen-join');
    (code ? $('join-name') : $('join-code')).focus();
  }

  function submitHost() {
    const name = cleanName($('host-name').value);
    if (!name) { $('host-name').focus(); return; }
    store.set('name', name);
    hostCreate(name);
  }
  function submitJoin() {
    const code = $('join-code').value.trim().toUpperCase();
    const name = cleanName($('join-name').value);
    if (!/^[A-Z]{4}$/.test(code)) {
      $('join-error').textContent = 'Koden är fyra bokstäver.';
      $('join-error').classList.remove('hidden');
      $('join-code').focus();
      return;
    }
    if (!name) { $('join-name').focus(); return; }
    store.set('name', name);
    joinRoom(code, name);
  }
  $('host-go').addEventListener('click', submitHost);
  $('host-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitHost(); });
  $('join-go').addEventListener('click', submitJoin);
  $('join-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitJoin(); });
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-name').focus(); });
  $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });

  $('lobby-start').addEventListener('click', () => { if (net && net.role === 'host') hostStart(); });
  $('lobby-leave').addEventListener('click', () => { netCleanup(); goHome(); });
  $('lobby-share').addEventListener('click', async () => {
    if (!net) return;
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('rum', net.code);
    for (const k of ['peerhost', 'peerport', 'peerpath', 'peersecure']) {
      const v = new URLSearchParams(location.search).get(k);
      if (v) url.searchParams.set(k, v);
    }
    const text = `Kör Skånekoll med mig! Rumskod: ${net.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Skånekoll', text, url: url.toString() }); return; }
    } catch { /* avbruten delning */ }
    try {
      await navigator.clipboard.writeText(url.toString());
      toast('Länken är kopierad!');
    } catch {
      prompt('Kopiera länken:', url.toString());
    }
  });

  // Starta: öppna "gå med" direkt om länken har en rumskod
  const roomParam = (new URLSearchParams(location.search).get('rum') || '').toUpperCase();
  if (/^[A-Z]{4}$/.test(roomParam)) openJoin(roomParam); else show('screen-home');
})();
