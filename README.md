# taiwan_weather_viewer（台湾天気ビューア 臺灣天氣）

台湾の天気を、中央氣象署の公開データで見る**学習・実験用**のWebアプリ。日本語と中国語（繁体字）を併記。キー・登録・サーバーは不要で、ブラウザだけで動く。

詳しくは [MANUAL.md](MANUAL.md) を参照。

- **画面**: 天気（**レーダーと観測を1つの地図に重ねて**、共通のスライダー1本で過去3時間を再生。層は個別にオン・オフ）／仕組み（学習用の説明）
- **データ**: レーダーも観測も [taiwan-radar-frames](https://github.com/masauehr/taiwan-radar-frames) の配信（観測は配信に無い間だけ気象署の公開ファイルを直接取得・最新のみ）
- **出典（表示義務）**: 提供機關／交通部中央氣象署（政府資料開放授權條款）。地図: © OpenStreetMap contributors

## ローカルで動かす

ES Modules を使うため、`file://` では動かない。

```bash
cd ~/projects/taiwan_weather_viewer
python3 -m http.server 8080
# → http://127.0.0.1:8080/ を開く
```

## 構成

```
index.html, css/style.css
js/main.js    地図・タブ    js/radar.js  レーダー    js/obs.js  観測    js/common.js  共通
```

Vanilla JS + Leaflet 1.9.4（ビルド不要）。インデントはスペース2つ。
