// レーダータブ: 台湾レーダー（taiwan-radar-frames の配信）を過去3時間分ループ再生する
import { FEED_BASE, RADAR_PALETTE, fetchJson, fmtJst, fmtTaipei, onWake } from './common.js';

const POLL_MS = 5 * 60 * 1000;   // index.json の確認間隔（配信は10分ごと）
const STEP_MS = 400;             // 再生の1コマの長さ
const LAST_PAUSE_MS = 1200;      // 最新コマで少し止まってからループ

export function initRadar(map) {
  const $ = (id) => document.getElementById(id);
  const el = {
    play: $('rPlay'), slider: $('rSlider'), time: $('rTime'),
    opacity: $('rOpacity'), status: $('rStatus'), legend: $('rLegend'), reload: $('rReload'),
  };

  let frames = [];        // [{t(ms), file, layer}]
  let idx = -1;
  let playing = false;
  let timer = null;
  let busy = false;
  let active = false;
  let error = false;
  let fetchedAt = 0;
  let bounds = null;
  let pollId = null;
  let alpha = parseFloat(el.opacity.value);

  // 凡例: dBZ 0〜64 のグラデーション
  const stops = RADAR_PALETTE.map((c, i) => 'rgb(' + c.join(',') + ') ' + (i / (RADAR_PALETTE.length - 1) * 100).toFixed(1) + '%');
  el.legend.style.background = 'linear-gradient(to right,' + stops.join(',') + ')';

  const frameOpacity = (i) => (i === idx ? alpha : 0);

  function show(i) {
    if (!frames.length) { idx = -1; return; }
    idx = ((i % frames.length) + frames.length) % frames.length;
    frames.forEach((f, k) => f.layer.setOpacity(frameOpacity(k)));
    el.slider.value = String(idx);
    const t = frames[idx].t;
    el.time.textContent = fmtJst(t) + ' JST ／ 台北 ' + fmtTaipei(t);
  }

  function updateStatus() {
    if (error && !frames.length) { el.status.textContent = '取得失敗 取得失敗（再読込を押してください）'; return; }
    if (!frames.length) { el.status.textContent = '取得中… 取得中…'; return; }
    const last = frames[frames.length - 1].t;
    const lag = Math.max(0, Math.round((Date.now() - last) / 60000));
    el.status.textContent = frames.length + '枚 ／ 最新の観測 ' + fmtJst(last) + ' JST（台北 ' + fmtTaipei(last) +
      '）／ 観測から ' + lag + ' 分前' + (error ? ' ／ 更新失敗（前回の表示を継続）' : '');
  }

  // index.json に合わせて、新しいコマを追加・消えたコマを削除
  function sync(index) {
    bounds = index.bounds;
    const keep = new Set(index.frames.map((f) => f.file));
    const wasLast = idx === frames.length - 1;
    frames = frames.filter((f) => {
      if (keep.has(f.file)) return true;
      map.removeLayer(f.layer);
      return false;
    });
    const have = new Set(frames.map((f) => f.file));
    for (const f of index.frames) {
      if (have.has(f.file)) continue;
      const layer = L.imageOverlay(FEED_BASE + f.file, bounds, { opacity: 0, interactive: false });
      layer.addTo(map);
      frames.push({ t: Date.parse(f.t), file: f.file, layer });
    }
    frames.sort((a, b) => a.t - b.t);
    el.slider.max = String(Math.max(0, frames.length - 1));
    if (idx < 0 || wasLast) idx = frames.length - 1;
    else if (idx >= frames.length) idx = frames.length - 1;
    return index.attribution;
  }

  async function load() {
    if (busy || !active) return;
    busy = true;
    try {
      sync(await fetchJson(FEED_BASE + 'index.json'));
      error = false;
      fetchedAt = Date.now();
    } catch (e) {
      error = true;
    } finally {
      busy = false;
    }
    show(idx);
    updateStatus();
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
    el.play.textContent = '▶ 再生 播放';
  }
  function play() {
    if (!frames.length) return;
    playing = true;
    el.play.textContent = '⏸ 停止 暫停';
    const tick = () => {
      if (!playing) return;
      const next = (idx + 1) % frames.length;
      show(next);
      timer = setTimeout(tick, next === frames.length - 1 ? LAST_PAUSE_MS : STEP_MS);
    };
    timer = setTimeout(tick, STEP_MS);
  }

  el.play.addEventListener('click', () => (playing ? stop() : play()));
  el.slider.addEventListener('input', () => { stop(); show(parseInt(el.slider.value, 10)); });
  el.opacity.addEventListener('input', () => { alpha = parseFloat(el.opacity.value); show(idx); });
  el.reload.addEventListener('click', () => load());
  onWake(() => load());
  setInterval(() => { if (active) updateStatus(); }, 30000); // 「◯分前」の表示を更新

  return {
    // タブを開いたとき: 取得して自動再生
    activate() {
      active = true;
      load().then(() => { if (frames.length && !playing) { show(frames.length - 1); play(); } });
      pollId = setInterval(load, POLL_MS);
    },
    // タブを閉じたとき: 停止し、画像を解放（メモリ節約）
    deactivate() {
      active = false;
      stop();
      clearInterval(pollId);
      frames.forEach((f) => map.removeLayer(f.layer));
      frames = [];
      idx = -1;
    },
    get fetchedAt() { return fetchedAt; },
  };
}
