// データの読み書き
// （server.js から切り出したものです。処理内容は変えていません）

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
// APIの鍵だけは別ファイルに置きます。
// db.json はGitに入れてバックアップしますが、こちらは .gitignore で除外します。
const SECRET_PATH = path.join(__dirname, "..", "data", "secrets.json");
const SECRET_KEYS = ["rakutenAppId", "rakutenAccessKey", "moshimoAmazon", "moshimoRakuten", "moshimoYahoo"];



const DEFAULT_DB = {
  settings: {
    rakutenAppId: '',
    rakutenAccessKey: '',
    wpUrl: 'https://toco-to.com',
    wpUser: '',
    wpAppPassword: '',
    aiModel: 'claude-opus-5',
  },
  inventory: [],
  projects: [],
  ideas: null, // null のときは初回に下の一覧を入れる
};

// 初回に入れておく記事ネタ。優先度は「内部リンクのハブが先に立つ順番」で付けています。
const SEED_IDEAS = [
  // しつけ・暮らし
  ['はじめてうさぎを迎える方へ｜準備リストと迎えた日の過ごし方', 'うさぎ 飼い方 準備', 'しつけ・暮らし', '高', 'すべての記事のハブ。ここから各用品の記事へ流す。ヘッダーからリンク済みだが現在404'],
  ['うさぎの部屋んぽの安全対策', 'うさぎ 部屋んぽ 対策', 'しつけ・暮らし', '中', 'コードカバー・観葉植物・隙間。事故防止の実用記事'],
  ['うさぎの留守番はどれくらい大丈夫？', 'うさぎ 留守番', 'しつけ・暮らし', '低', 'コラム寄り。ペットカメラの紹介につなげられる'],
  ['うさぎとの防災・停電対策', 'うさぎ 防災 グッズ', 'しつけ・暮らし', '低', '夏の停電が一番こわい。保冷剤・キャリー・備蓄'],

  // えさ・牧草
  ['うさぎの牧草のおすすめ｜チモシーの選び方や食べない子向けの商品まで紹介', 'うさぎ 牧草 チモシー', 'えさ・牧草', '高', '検索需要が最も大きい。1番刈り／2番刈り／3番刈りの違いを軸に'],
  ['うさぎのペレットのおすすめ', 'うさぎ ペレット', 'えさ・牧草', '中', '主原料がチモシーかアルファルファかで分ける'],
  ['うさぎの牧草入れのおすすめ', 'うさぎ 牧草入れ', 'えさ・牧草', '中', 'ケージ記事と相互リンク。柵の向き（横柵／縦柵）の話が効く'],
  ['うさぎの給水ボトル・給水器のおすすめ', 'うさぎ 給水ボトル', 'えさ・牧草', '中', 'ボトルと皿の比較。飲水量が測れるかが選定軸'],
  ['うさぎのおやつのおすすめ', 'うさぎ おやつ', 'えさ・牧草', '低', '与えすぎ注意の注意書きを厚めに'],
  ['うさぎが牧草を食べないときに試したいこと', 'うさぎ 牧草 食べない', 'えさ・牧草', '中', 'コラム。牧草記事へ流す。動物病院への誘導を必ず入れる'],

  // ケージ・サークル
  ['うさぎのケージのおすすめ｜サイズの選び方や掃除しやすいタイプまで紹介', 'うさぎ ケージ', 'ケージ・サークル', '高', '作成中'],
  ['うさぎのサークルのおすすめ', 'うさぎ サークル', 'ケージ・サークル', '中', '部屋んぽ用。高さと安定感が軸'],
  ['うさぎのケージの置き場所と掃除のコツ', 'うさぎ ケージ 掃除', 'ケージ・サークル', '低', 'コラム。ケージ記事へ流す'],
  ['うさぎのケージカバーのおすすめ', 'うさぎ ケージカバー', 'ケージ・サークル', '低', '保温・目隠し・毛の飛散防止'],

  // おもちゃ・用品
  ['うさぎのトイレのおすすめ｜掃除しやすい形の選び方', 'うさぎ トイレ', 'おもちゃ・用品', '高', 'ケージ記事と相互リンク。角が丸いケージには収まらない話が書ける'],
  ['うさぎのキャリーバッグのおすすめ｜通院と災害時に備える', 'うさぎ キャリーバッグ', 'おもちゃ・用品', '高', 'お迎え当日から必要。通院用として需要が安定している'],
  ['うさぎのトイレ砂・シーツのおすすめ', 'うさぎ トイレ砂', 'おもちゃ・用品', '中', '紙・おから・木質ペレット。誤食しても比較的安全なもの'],
  ['うさぎのかじり木のおすすめ', 'うさぎ かじり木', 'おもちゃ・用品', '中', '歯が伸び続ける話から入る'],
  ['うさぎのおもちゃのおすすめ', 'うさぎ おもちゃ', 'おもちゃ・用品', '中', '退屈しのぎと運動。洗えるかが軸'],
  ['うさぎの食器のおすすめ', 'うさぎ 食器', 'おもちゃ・用品', '低', 'ひっくり返らない重さ。陶器が定番'],

  // お手入れ・健康
  ['うさぎのブラシのおすすめ｜換毛期の抜け毛対策', 'うさぎ ブラシ 換毛期', 'お手入れ・健康', '中', '春と秋の直前に出したい。季節記事'],
  ['うさぎの爪切りのおすすめ', 'うさぎ 爪切り', 'お手入れ・健康', '中', '血管の位置が見えるかが軸'],
  ['うさぎのヒーターのおすすめ｜冬の寒さ対策', 'うさぎ ヒーター 冬', 'お手入れ・健康', '中', '10月までに出す。コードをかじられない配線の話'],
  ['うさぎの暑さ対策グッズのおすすめ', 'うさぎ 暑さ対策 冷却', 'お手入れ・健康', '中', '5月までに出す。うさぎは暑さに弱い'],
  ['うさぎの体重管理と体重計', 'うさぎ 体重計', 'お手入れ・健康', '低', 'キッチンスケールで代用できる話。健康指標として最重要'],
];

function seedIdeas() {
  return SEED_IDEAS.map((r) => ({
    id: newId(), title: r[0], keyword: r[1], category: r[2],
    priority: r[3], note: r[4], status: '未着手', projectId: null,
  }));
}

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return Object.assign({}, DEFAULT_DB, JSON.parse(raw));
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function loadSecrets() {
  try { return JSON.parse(fs.readFileSync(SECRET_PATH, "utf8")); }
  catch (e) { return {}; }
}

function saveSecrets(obj) {
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, JSON.stringify(obj, null, 2));
}

// 画面に渡すときは、鍵とそれ以外をひとつにまとめて扱います。
function loadSettings() {
  const db = loadDb();
  return Object.assign({}, db.settings, loadSecrets());
}

function saveSettings(patch) {
  const db = loadDb();
  const secrets = loadSecrets();
  Object.keys(patch).forEach((k) => {
    if (SECRET_KEYS.includes(k)) secrets[k] = patch[k];
    else db.settings[k] = patch[k];
  });
  saveDb(db);
  saveSecrets(secrets);
  return Object.assign({}, db.settings, secrets);
}

module.exports = {
  DEFAULT_DB, SEED_IDEAS, seedIdeas, loadDb, saveDb, newId, today,
  loadSecrets, saveSecrets, loadSettings, saveSettings, SECRET_KEYS,
};
