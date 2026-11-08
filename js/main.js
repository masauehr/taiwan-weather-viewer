// 台湾天気ビューア: 地図・タブ・共通の時刻スライダーの制御
// レーダーと観測を1つの地図に重ね、1本のスライダーで同じ時刻を見る。
import { initRadar } from './radar.js';
import { initObs } from './obs.js';
import { RADAR_PALETTE, fmtJst, fmtTaipei } from './common.js';

const STEP_MS = 450;        // 再生の1コマの長さ
const LAST_PAUSE_MS = 1200; // 最新コマで少し止まってからループ

const map = L.map('map', {
  center: [23.7, 121.0], zoom: 7, minZoom: 6, maxZoom: 12,
  maxBounds: [[10, 105], [35, 135]], // 台湾周辺から大きく外れないように
});

// 背景地図（キー不要）。OpenStreetMap の利用ポリシーに従い出典を表示
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
map.attributionControl.addAttribution('資料來源 出典: 交通部中央氣象署');

const $ = (id) => document.getElementById(id);
const el = {
  time: $('vTime'), status: $('vStatus'), reload: $('vReload'),
  chkRadar: $('chkRadar'), chkObs: $('chkObs'), kind: $('obsKind'), obsLegend: $('obsLegend'),
  play: $('vPlay'), slider: $('vSlider'), opacity: $('rOpacity'), radarLegend: $('rLegend'),
  radarLegendBox: $('rLegendBox'),
};

const radar = initRadar(map, refresh);
const obs = initObs(map, refresh);

// レーダー凡例（dBZ 0〜64 のグラデーション）
const stops = RADAR_PALETTE.map((c, i) => 'rgb(' + c.join(',') + ') ' + (i / (RADAR_PALETTE.length - 1) * 100).toFixed(1) + '%');
el.radarLegend.style.background = 'linear-gradient(to right,' + stops.join(',') + ')';

// ── 共通の時刻 ──
let selected = null;     // 選択中の時刻(ms)
let follow = true;       // 最新を追いかけるか（スライダーを最新から離すと false）
let playing = false;
let timer = null;

// 有効な層のコマ・観測の時刻を合わせた一覧（昇順・重複なし）
function timeline() {
  const set = new Set();
  if (el.chkRadar.checked) radar.times().forEach((t) => set.add(t));
  if (el.chkObs.checked) obs.times().forEach((t) => set.add(t));
  return [...set].sort((a, b) => a - b);
}

function layersHtml() {
  const lines = [];
  if (el.chkRadar.checked) lines.push(radar.status());
  if (el.chkObs.checked) lines.push(obs.status());
  return lines.length ? lines.join('<br>') : 'レーダーか観測を選んでください 請選擇雷達或觀測';
}

// 選択中の時刻を各層に反映
function apply() {
  radar.show(el.chkRadar.checked ? selected : null);
  obs.show(el.chkObs.checked ? selected : null);
  el.time.textContent = selected == null ? '-' : fmtJst(selected) + ' JST ／ 台北 ' + fmtTaipei(selected);
  el.status.innerHTML = layersHtml();
}

// データの読み込み・層の切替のあとに呼ぶ: スライダーの範囲と選択時刻を整える
function refresh() {
  const ts = timeline();
  el.slider.max = String(Math.max(0, ts.length - 1));
  if (!ts.length) {
    selected = null;
  } else if (follow || selected == null) {
    selected = ts[ts.length - 1];
  } else if (!ts.includes(selected)) {
    selected = ts.reduce((a, b) => (Math.abs(b - selected) < Math.abs(a - selected) ? b : a)); // 一番近い時刻へ
  }
  el.slider.value = String(selected == null ? 0 : ts.indexOf(selected));
  apply();
}

function stop() {
  playing = false;
  clearTimeout(timer);
  el.play.textContent = '▶ 再生 播放';
}
function play() {
  const ts = timeline();
  if (ts.length < 2) return;
  playing = true;
  el.play.textContent = '⏸ 停止 暫停';
  const tick = () => {
    if (!playing) return;
    const cur = timeline();
    const i = cur.indexOf(selected);
    const next = (i + 1) % cur.length;
    selected = cur[next];
    follow = next === cur.length - 1;
    el.slider.value = String(next);
    apply();
    timer = setTimeout(tick, next === cur.length - 1 ? LAST_PAUSE_MS : STEP_MS);
  };
  timer = setTimeout(tick, STEP_MS);
}

el.play.addEventListener('click', () => (playing ? stop() : play()));
el.slider.addEventListener('input', () => {
  stop();
  const ts = timeline();
  const i = parseInt(el.slider.value, 10);
  selected = ts[i] ?? selected;
  follow = i === ts.length - 1; // 最新に合わせたら、以後も最新を追いかける
  apply();
});
el.opacity.addEventListener('input', () => radar.setOpacity(parseFloat(el.opacity.value)));
el.reload.addEventListener('click', () => { radar.load(); obs.load(); });

// 層のオン・オフ（オフにした層は画像・マーカーを解放）
function updateLayerUi() {
  el.kind.disabled = !el.chkObs.checked;
  el.obsLegend.hidden = !el.chkObs.checked;
  el.radarLegendBox.hidden = !el.chkRadar.checked;
}
el.chkRadar.addEventListener('change', () => {
  el.chkRadar.checked ? radar.activate() : radar.deactivate();
  updateLayerUi();
  refresh();
});
el.chkObs.addEventListener('change', () => {
  el.chkObs.checked ? obs.activate() : obs.deactivate();
  updateLayerUi();
  refresh();
});
el.kind.addEventListener('change', () => {
  obs.setKind(el.kind.value);
  el.obsLegend.innerHTML = obs.legendHtml();
});
setInterval(apply, 30000); // 「◯分前」の表示を更新

// ── タブ（天気 / 仕組み）──
function select(name) {
  if (name !== 'about') name = 'weather'; // 旧URL(#radar, #obs)は天気へ
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  const weather = name === 'weather';
  ['viewBar', 'viewBottom', 'map'].forEach((id) => { $(id).hidden = !weather; });
  $('about').hidden = weather;
  if (weather) map.invalidateSize();
  history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => select(b.dataset.tab)));
select(location.hash.slice(1));

// 起動: 両方の層を有効にする
el.obsLegend.innerHTML = obs.legendHtml();
updateLayerUi();
radar.activate();
obs.activate();
