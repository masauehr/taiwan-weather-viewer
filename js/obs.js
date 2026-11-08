// 観測タブ: 台湾の地上観測（363局・10分更新）を、風の矢羽や数値ラベルで表示する。
// 配信（taiwan-radar-frames）が10分ごとに保存したスナップショットを、過去3時間分スライダーで再生できる。
// 配信に観測が無い間は、気象署の最新ファイルを直接取得する（最新のみ）。
import { FEED_BASE, OBS_URL, SCALES, fetchJson, fmtJst, fmtTaipei, onWake, outlineOf, scaleColor } from './common.js';

const POLL_MS = 5 * 60 * 1000;   // 配信の確認間隔（配信は10分ごと）
const STEP_MS = 500;
const LAST_PAUSE_MS = 1200;

// 欠測(-99など)は null
const num = (x) => {
  const v = parseFloat(x);
  return Number.isNaN(v) || v <= -90 ? null : v;
};

// 種別: 日本語＋中国語の表記・単位・配色・値の取り方
const KINDS = {
  wind: { label: '風 風向風速', unit: 'm/s', scale: 'wind', arrow: true, digits: 0, val: (s) => s.ws },
  temp: { label: '気温 氣溫', unit: '℃', scale: 'temp', digits: 1, val: (s) => s.temp },
  dew: {
    label: '露点 露點', unit: '℃', scale: 'temp', digits: 1,
    // 気温と湿度から露点を計算（Magnus の式）
    val: (s) => {
      if (s.temp == null || s.rh == null || s.rh <= 0) return null;
      const g = Math.log(s.rh / 100) + 17.62 * s.temp / (243.12 + s.temp);
      return 243.12 * g / (17.62 - g);
    },
  },
  hum: { label: '湿度 濕度', unit: '%', scale: 'humidity', digits: 0, val: (s) => s.rh },
  rain: { label: '当日雨量 當日累積雨量', unit: 'mm', scale: 'rain', digits: 1, val: (s) => s.rain },
};

const COMPASS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西']; // 日本語・中国語で同じ字
const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];

// 配信のスナップショットの値の並び（taiwan-radar-frames の OBS_KEYS と同じ）
const DEFAULT_KEYS = ['wd', 'ws', 'temp', 'rh', 'rain', 'gust', 'pres', 'weather'];

// 気象署の最新ファイル → { meta: 地点の一覧, snap: {t, v} }（配信と同じ形にそろえる）
function parseLatest(json) {
  const meta = [];
  const v = {};
  let tmax = 0;
  for (const s of json.cwaopendata.dataset.Station) {
    const w = s.WeatherElement || {};
    const geo = s.GeoInfo || {};
    const wgs = (geo.Coordinates || []).find((c) => c.CoordinateName === 'WGS84');
    if (!wgs || !s.StationId) continue;
    const lat = parseFloat(wgs.StationLatitude);
    const lon = parseFloat(wgs.StationLongitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const t = s.ObsTime && s.ObsTime.DateTime ? Date.parse(s.ObsTime.DateTime) : 0;
    if (t > tmax) tmax = t;
    meta.push({ id: s.StationId, name: s.StationName, county: geo.CountyName || '', town: geo.TownName || '', lat, lon, alt: num(geo.StationAltitude) });
    v[s.StationId] = [num(w.WindDirection), num(w.WindSpeed), num(w.AirTemperature), num(w.RelativeHumidity),
      num(w.Now && w.Now.Precipitation), num(w.GustInfo && w.GustInfo.PeakGustSpeed), num(w.AirPressure),
      w.Weather && w.Weather !== '-99' ? w.Weather : null];
  }
  return { meta, snap: { t: tmax, v } };
}

const fmt = (v, d, unit) => (v == null ? '—' : v.toFixed(d) + ' ' + unit);

function popupHtml(s) {
  const wind = s.ws == null ? '—' : s.ws.toFixed(1) + ' m/s' + (s.wd != null && s.ws > 0.2 ? '（' + compass(s.wd) + 'から ' + s.wd.toFixed(0) + '°）' : '（静穏 靜風）');
  return '<b>' + s.name + '</b> <small>' + s.county + ' ' + s.town + (s.alt != null ? ' ／ 標高 海拔 ' + s.alt.toFixed(0) + ' m' : '') + '</small>' +
    '<table class="pop">' +
    (s.weather ? '<tr><th>天気 天氣</th><td>' + s.weather + '</td></tr>' : '') +
    '<tr><th>気温 氣溫</th><td>' + fmt(s.temp, 1, '℃') + '</td></tr>' +
    '<tr><th>湿度 濕度</th><td>' + fmt(s.rh, 0, '%') + '</td></tr>' +
    '<tr><th>風 風</th><td>' + wind + '</td></tr>' +
    '<tr><th>最大瞬間風速 瞬間陣風</th><td>' + fmt(s.gust, 1, 'm/s') + '</td></tr>' +
    '<tr><th>当日雨量 當日降水量</th><td>' + fmt(s.rain, 1, 'mm') + '</td></tr>' +
    '<tr><th>測站気圧 測站氣壓</th><td>' + fmt(s.pres, 1, 'hPa') + ' <small>（海面気圧ではない）</small></td></tr>' +
    '</table>';
}

export function initObs(map) {
  const $ = (id) => document.getElementById(id);
  const el = {
    kind: $('obsKind'), status: $('obsStatus'), legend: $('obsLegend'), reload: $('obsReload'),
    play: $('oPlay'), slider: $('oSlider'), time: $('oTime'),
  };
  const layer = L.layerGroup();

  let stations = [];          // 地点の一覧 [{id,name,county,town,lat,lon,alt}]
  let snaps = [];             // スナップショット [{t(ms), file, v}]（t昇順）
  let idx = -1;
  let kind = el.kind.value;
  let busy = false;
  let active = false;
  let error = false;
  let fromFeed = false;       // 配信から読んでいるか（false=気象署の最新ファイルを直接取得）
  let keys = DEFAULT_KEYS;
  let playing = false;
  let timer = null;
  let pollId = null;
  let fetchedAt = 0;

  // 配信のスナップショットを地点の情報と結合した配列にする
  function current() {
    const sn = snaps[idx];
    if (!sn) return [];
    const ix = Object.fromEntries(keys.map((k, i) => [k, i]));
    const out = [];
    for (const m of stations) {
      const a = sn.v[m.id];
      if (!a) continue;
      out.push({ ...m, wd: a[ix.wd], ws: a[ix.ws], temp: a[ix.temp], rh: a[ix.rh], rain: a[ix.rain], gust: a[ix.gust], pres: a[ix.pres], weather: a[ix.weather] });
    }
    return out;
  }

  function buildLegend() {
    const k = KINDS[kind];
    const sc = SCALES[k.scale];
    // 先頭は「次の閾値未満」、2番目以降は「閾値以上」
    el.legend.innerHTML = sc.th.map((th, i) =>
      '<span class="lg"><i style="background:' + sc.cl[i] + '"></i>' + (i === 0 ? '<' + sc.th[1] : '≥' + th) + '</span>').join('') +
      '<span class="lg unit">' + k.unit + '</span>';
  }

  function markerHtml(s, v) {
    const c = scaleColor(KINDS[kind].scale, v);
    const oc = outlineOf(c);
    const sh = `-1px 0 ${oc},0 1px ${oc},1px 0 ${oc},0 -1px ${oc}`;
    if (KINDS[kind].arrow) {
      if (v > 0.2 && s.wd != null) {
        const rot = (s.wd + 180) % 360; // 風向(吹いてくる方位) → 吹先方向
        const stroke = oc === '#fff' ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.85)';
        return { anchor: [9, 14], html: '<div class="mk"><svg width="18" height="28" viewBox="0 0 12 20" style="transform:rotate(' + rot + 'deg)">' +
          '<polygon points="6,0 0,20 6,15 12,20" stroke="' + stroke + '" stroke-width="1.5" fill="' + c + '"/></svg>' +
          '<div style="color:' + c + ';text-shadow:' + sh + '">' + v.toFixed(0) + '</div></div>' };
      }
      return { anchor: [5, 5], html: '<svg width="10" height="10"><circle cx="5" cy="5" r="4" stroke="rgba(0,0,0,.7)" fill="rgb(160,210,255)"/></svg>' };
    }
    return { anchor: [14, 7], html: '<div class="mk"><div style="color:' + c + ';text-shadow:' + sh + '">' + v.toFixed(KINDS[kind].digits) + '</div></div>' };
  }

  function render() {
    layer.clearLayers();
    updateStatus();
    const list = current();
    if (!list.length) return;
    const z = map.getZoom();
    const b = map.getBounds().pad(0.05);
    const grid = { 6: 1.2, 7: 0.6, 8: 0.25, 9: 0.1 }[z] || 0; // ズームアウト時はセルごとに1局へ間引く
    const seen = new Set();
    for (const s of list) {
      if (!b.contains([s.lat, s.lon])) continue;
      const v = KINDS[kind].val(s);
      if (v == null) continue;
      if (grid > 0) {
        const key = Math.floor(s.lat / grid) + '_' + Math.floor(s.lon / grid);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const m = markerHtml(s, v);
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ html: m.html, className: '', iconSize: [0, 0], iconAnchor: m.anchor }),
        keyboard: false,
      }).bindPopup(popupHtml(s)).addTo(layer);
    }
  }

  function show(i) {
    if (!snaps.length) { idx = -1; el.time.textContent = '-'; render(); return; }
    idx = ((i % snaps.length) + snaps.length) % snaps.length;
    el.slider.value = String(idx);
    const t = snaps[idx].t;
    el.time.textContent = fmtJst(t) + ' JST ／ 台北 ' + fmtTaipei(t);
    render();
  }

  function updateStatus() {
    if (error && !snaps.length) { el.status.textContent = '取得失敗 取得失敗（再読込を押してください）'; return; }
    if (!snaps.length) { el.status.textContent = '取得中… 取得中…'; return; }
    const last = snaps[snaps.length - 1].t;
    const lag = Math.max(0, Math.round((Date.now() - last) / 60000));
    el.status.textContent = current().length + '局 ／ ' + snaps.length + '回分' + (fromFeed ? '' : '（最新のみ）') +
      ' ／ 最新の観測 ' + fmtJst(last) + ' JST（台北 ' + fmtTaipei(last) + '）／ ' + lag + ' 分前' +
      (error ? ' ／ 更新失敗（前回の表示を継続）' : '');
  }

  // 配信から観測を読む。観測が無ければ false
  async function loadFromFeed() {
    const index = await fetchJson(FEED_BASE + 'index.json');
    const o = index.obs;
    if (!o || !o.frames || !o.frames.length) return false;
    keys = o.keys || DEFAULT_KEYS;
    if (!stations.length) stations = (await fetchJson(FEED_BASE + o.stations)).stations;
    const have = new Map(snaps.map((s) => [s.file, s]));
    const next = await Promise.all(o.frames.map(async (f) => {
      if (have.has(f.file)) return have.get(f.file);
      const j = await fetchJson(FEED_BASE + f.file);
      return { t: Date.parse(j.t), file: f.file, v: j.v };
    }));
    const wasLast = idx < 0 || idx === snaps.length - 1;
    snaps = next.sort((a, b) => a.t - b.t);
    el.slider.max = String(Math.max(0, snaps.length - 1));
    idx = wasLast || idx >= snaps.length ? snaps.length - 1 : idx;
    fromFeed = true;
    return true;
  }

  // 気象署の最新ファイルを直接取得（配信に観測が無いときの代替・最新のみ）
  async function loadLatestOnly() {
    const { meta, snap } = parseLatest(await fetchJson(OBS_URL));
    keys = DEFAULT_KEYS;
    stations = meta;
    snaps = [{ t: snap.t, file: 'latest', v: snap.v }];
    el.slider.max = '0';
    idx = 0;
    fromFeed = false;
  }

  async function load() {
    if (busy || !active) return;
    busy = true;
    try {
      let ok = false;
      try { ok = await loadFromFeed(); } catch (e) { ok = false; }
      if (!ok) await loadLatestOnly();
      error = false;
      fetchedAt = Date.now();
    } catch (e) {
      error = true;
    } finally {
      busy = false;
    }
    show(idx);
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
    el.play.textContent = '▶ 再生 播放';
  }
  function play() {
    if (snaps.length < 2) return;
    playing = true;
    el.play.textContent = '⏸ 停止 暫停';
    const tick = () => {
      if (!playing) return;
      const next = (idx + 1) % snaps.length;
      show(next);
      timer = setTimeout(tick, next === snaps.length - 1 ? LAST_PAUSE_MS : STEP_MS);
    };
    timer = setTimeout(tick, STEP_MS);
  }

  el.play.addEventListener('click', () => (playing ? stop() : play()));
  el.slider.addEventListener('input', () => { stop(); show(parseInt(el.slider.value, 10)); });
  el.kind.addEventListener('change', () => { kind = el.kind.value; buildLegend(); render(); });
  el.reload.addEventListener('click', () => load());
  map.on('moveend', () => { if (active) render(); });
  onWake(() => load());
  setInterval(() => { if (active) updateStatus(); }, 30000);

  return {
    activate() {
      active = true;
      layer.addTo(map);
      buildLegend();
      load();
      pollId = setInterval(load, POLL_MS);
    },
    deactivate() {
      active = false;
      stop();
      clearInterval(pollId);
      map.removeLayer(layer);
      layer.clearLayers();
    },
    get fetchedAt() { return fetchedAt; },
  };
}
