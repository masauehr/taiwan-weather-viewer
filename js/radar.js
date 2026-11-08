// レーダー層: 台湾レーダー（taiwan-radar-frames の配信）を地図に重ねる。
// 画面部品は持たない。時刻は main.js の共通スライダーが決め、show(時刻) で最も近い1コマだけを表示する。
import { FEED_BASE, fetchJson, fmtJst, fmtTaipei, onWake } from './common.js';

const POLL_MS = 5 * 60 * 1000;   // index.json の確認間隔（配信は10分ごと）
const MATCH_MS = 15 * 60 * 1000; // 指定時刻との許容差（超えたら非表示）

export function initRadar(map, onUpdate) {
  let frames = [];        // [{t(ms), file, layer}]（t昇順）
  let shown = -1;         // 表示中のコマ（-1=なし）
  let alpha = 0.75;
  let busy = false;
  let active = false;
  let error = false;
  let pollId = null;

  // 指定時刻に最も近いコマ。許容差を超えるなら -1。時刻なし(null)は最新
  function pick(t) {
    if (!frames.length) return -1;
    if (t == null) return frames.length - 1;
    let best = -1;
    let bestD = Infinity;
    frames.forEach((f, k) => {
      const d = Math.abs(f.t - t);
      if (d < bestD) { bestD = d; best = k; }
    });
    return bestD > MATCH_MS ? -1 : best;
  }

  function apply() {
    frames.forEach((f, k) => f.layer.setOpacity(k === shown ? alpha : 0));
  }

  // index.json に合わせて、新しいコマを追加・消えたコマを削除
  function sync(index) {
    const keep = new Set(index.frames.map((f) => f.file));
    frames = frames.filter((f) => {
      if (keep.has(f.file)) return true;
      map.removeLayer(f.layer);
      return false;
    });
    const have = new Set(frames.map((f) => f.file));
    for (const f of index.frames) {
      if (have.has(f.file)) continue;
      const layer = L.imageOverlay(FEED_BASE + f.file, index.bounds, { opacity: 0, interactive: false });
      layer.addTo(map);
      frames.push({ t: Date.parse(f.t), file: f.file, layer });
    }
    frames.sort((a, b) => a.t - b.t);
  }

  async function load() {
    if (busy || !active) return;
    busy = true;
    try {
      sync(await fetchJson(FEED_BASE + 'index.json'));
      error = false;
    } catch (e) {
      error = true;
    } finally {
      busy = false;
    }
    onUpdate();
  }

  onWake(() => load());

  return {
    activate() {
      active = true;
      load();
      pollId = setInterval(load, POLL_MS);
    },
    // 無効化: 画像を地図から外してメモリを空ける
    deactivate() {
      active = false;
      clearInterval(pollId);
      frames.forEach((f) => map.removeLayer(f.layer));
      frames = [];
      shown = -1;
      onUpdate();
    },
    times: () => frames.map((f) => f.t),
    // 指定時刻に近いコマを表示（null=最新）
    show(t) {
      shown = pick(t);
      apply();
    },
    setOpacity(a) { alpha = a; apply(); },
    get shownTime() { return shown >= 0 ? frames[shown].t : null; },
    status() {
      if (error && !frames.length) return 'レーダー 雷達: 取得失敗 取得失敗';
      if (!frames.length) return 'レーダー 雷達: 取得中… 取得中…';
      const last = frames[frames.length - 1].t;
      const lag = Math.max(0, Math.round((Date.now() - last) / 60000));
      return 'レーダー 雷達: ' + frames.length + '枚 ／ 最新 ' + fmtJst(last) + ' JST（台北 ' + fmtTaipei(last) + '）／ ' + lag + ' 分前' +
        (error ? ' ／ 更新失敗（前回の表示を継続）' : '');
    },
    load,
  };
}
