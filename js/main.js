// 台湾天気ビューア: 地図とタブの制御
import { initRadar } from './radar.js';
import { initObs } from './obs.js';

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

const tabs = {
  radar: { ctl: initRadar(map), bars: ['radarBar', 'radarBottom'], map: true },
  obs: { ctl: initObs(map), bars: ['obsBar'], map: true },
  about: { ctl: null, bars: [], map: false },
};
const barIds = ['radarBar', 'radarBottom', 'obsBar'];
let current = null;

function select(name) {
  if (!tabs[name]) name = 'radar';
  if (current && tabs[current].ctl) tabs[current].ctl.deactivate();
  current = name;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  barIds.forEach((id) => { document.getElementById(id).hidden = !tabs[name].bars.includes(id); });
  document.getElementById('map').hidden = !tabs[name].map;
  document.getElementById('about').hidden = name !== 'about';
  if (tabs[name].map) map.invalidateSize();
  if (tabs[name].ctl) tabs[name].ctl.activate();
  history.replaceState(null, '', '#' + name);
}

document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => select(b.dataset.tab)));
select(location.hash.slice(1) || 'radar');
