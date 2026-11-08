// 共通部品: 定数・時刻表示・タイムアウト・配色

// 台湾レーダー・地上観測の配信（taiwan-radar-frames）。10分ごとに更新・過去3時間分
// 開発・検証用に、?feed=http://127.0.0.1:8000/ のように配信元を差し替えられる
export const FEED_BASE = new URLSearchParams(location.search).get('feed') || 'https://masauehr.github.io/taiwan-radar-frames/';
// 台湾の地上観測（中央氣象署 O-A0003-001・有人/主要局363地点・10分更新）。公開S3でAPIキー不要
export const OBS_URL = 'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0003-001.json';

export const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

// 端末のタイムゾーンに依存せず、指定のUTCオフセットで "HH:MM" を返す
export function fmtHM(ms, offsetHours) {
  const d = new Date(ms + offsetHours * 3600 * 1000);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
export const fmtJst = (ms) => fmtHM(ms, 9);     // 日本時間
export const fmtTaipei = (ms) => fmtHM(ms, 8);  // 台北時間

// 応答が止まった通信を打ち切る（止まると「取得中」のまま以降の更新が全て止まるため）
export function withTimeout(promise, ms = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// キャッシュを避けて JSON を取得（30秒で打ち切り）
export function fetchJson(url) {
  const sep = url.includes('?') ? '&' : '?';
  return withTimeout(
    fetch(url + sep + '_=' + Date.now(), { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }),
  );
}

// 画面に戻ったとき・回線復帰時に fn を呼ぶ（スリープ復帰後に古いまま残るのを防ぐ）
export function onWake(fn) {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
  window.addEventListener('online', fn);
}

// レーダーの色（dBZ 0〜64）。中央氣象署の凡例から読み取ったもの（配信側と同じ）
export const RADAR_PALETTE = [
  [0, 255, 255], [0, 236, 255], [0, 218, 255], [0, 200, 255], [0, 182, 255], [0, 163, 255],
  [0, 145, 255], [0, 127, 255], [0, 109, 255], [0, 91, 255], [0, 72, 255], [0, 54, 255],
  [0, 36, 255], [0, 18, 255], [0, 0, 255], [0, 255, 0], [0, 244, 0], [0, 233, 0],
  [0, 222, 0], [0, 211, 0], [0, 200, 0], [0, 190, 0], [0, 180, 0], [0, 170, 0],
  [0, 160, 0], [0, 150, 0], [51, 171, 0], [102, 192, 0], [153, 213, 0], [204, 234, 0],
  [255, 255, 0], [255, 233, 0], [255, 222, 0], [255, 222, 0], [255, 200, 0], [255, 184, 0],
  [255, 168, 0], [255, 152, 0], [255, 136, 0], [255, 120, 0], [255, 96, 0], [255, 72, 0],
  [255, 48, 0], [255, 24, 0], [255, 0, 0], [244, 0, 0], [233, 0, 0], [222, 0, 0],
  [211, 0, 0], [200, 0, 0], [190, 0, 0], [180, 0, 0], [170, 0, 0], [160, 0, 0],
  [150, 0, 0], [171, 0, 51], [192, 0, 102], [213, 0, 153], [234, 0, 204], [255, 0, 255],
  [234, 0, 255], [213, 0, 255], [192, 0, 255], [171, 0, 255], [150, 0, 255],
];

// 観測の配色（気象庁アメダスの配色に準拠）。th[i]以上のとき cl[i]
export const SCALES = {
  wind: { th: [0, 5, 10, 15, 20, 25], cl: ['rgb(242,242,255)', 'rgb(0,65,255)', 'rgb(250,245,0)', 'rgb(255,153,0)', 'rgb(255,40,0)', 'rgb(180,0,104)'] },
  temp: { th: [-50, -5, 0, 5, 10, 15, 20, 25, 30, 35], cl: ['rgb(0,32,128)', 'rgb(0,65,255)', 'rgb(0,150,255)', 'rgb(185,235,255)', 'rgb(255,255,240)', 'rgb(255,255,150)', 'rgb(250,245,0)', 'rgb(255,153,0)', 'rgb(255,40,0)', 'rgb(180,0,104)'] },
  humidity: { th: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], cl: ['rgb(84,6,0)', 'rgb(118,17,0)', 'rgb(171,74,1)', 'rgb(231,135,7)', 'rgb(255,200,70)', 'rgb(255,255,240)', 'rgb(128,248,231)', 'rgb(31,194,211)', 'rgb(0,114,154)', 'rgb(0,75,150)', 'rgb(1,31,125)'] },
  rain: { th: [0, 1, 5, 10, 20, 30, 50, 80], cl: ['rgb(242,242,255)', 'rgb(160,210,255)', 'rgb(33,140,255)', 'rgb(0,65,255)', 'rgb(250,245,0)', 'rgb(255,153,0)', 'rgb(255,40,0)', 'rgb(180,0,104)'] },
};
export function scaleColor(name, v) {
  const s = SCALES[name];
  let c = s.cl[0];
  for (let i = 0; i < s.th.length; i++) if (v >= s.th[i]) c = s.cl[i];
  return c;
}

// 暗い青系は白縁、それ以外は黒縁（地図の上で読みやすくする）
const BLUE = new Set(['rgb(0,32,128)', 'rgb(0,65,255)', 'rgb(0,150,255)', 'rgb(0,114,154)', 'rgb(0,75,150)', 'rgb(1,31,125)', 'rgb(33,140,255)']);
export const outlineOf = (c) => (BLUE.has(c) ? '#fff' : '#000');
