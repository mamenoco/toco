// ブリーフ（執筆用の材料）の書き出し
// （server.js から切り出したものです。処理内容は変えていません）

const fs = require("fs");
const path = require("path");
const { today } = require("./db.js");

// ---------- ブリーフ（執筆用の材料）の書き出し ----------

// カテゴリごとにスペック項目を固定する（public/app.js と同じ定義）
const SPEC_PRESET = {
  'えさ・牧草': ['種類', '刈り取り時期', '内容量', '原産国', '対象'],
  'ケージ・サークル': ['外寸', '底面', '扉', 'トレー', 'キャスター'],
  'おもちゃ・用品': ['素材', 'サイズ', 'タイプ', '対象', '洗えるか'],
  'お手入れ・健康': ['タイプ', 'サイズ', '素材', '対象', '洗えるか'],
  'しつけ・暮らし': ['タイプ', 'サイズ', '素材', '対象', '備考'],
};

function buildBrief(project, inventory, styleGuide) {
  const L = [];
  L.push(`# 執筆用ブリーフ：${project.title || project.keyword}`);
  L.push('');
  L.push('このファイルをClaude Codeに読ませて記事を書いてください。');
  L.push('');
  L.push('## 記事の条件');
  L.push('');
  L.push(`- キーワード：${project.keyword}`);
  L.push(`- カテゴリ：${project.category || '（未設定）'}`);
  L.push(`- 掲載商品数：${(project.products || []).length}点`);
  L.push(`- 作成日：${today()}`);
  if (project.ideaNote) L.push(`- この記事のねらい：${project.ideaNote}`);
  L.push('');
  L.push('## 守るルール');
  L.push('');
  L.push('プロジェクト直下の CLAUDE.md（スタイルガイド）に従ってください。とくに以下。');
  L.push('');
  L.push('1. すべてを良いと書かず、合わない場面を必ず書く');
  L.push('2. 低評価の口コミから共通する不満を、高評価から共通する評価を拾う');
  L.push('3. 一般論だけで終わらせない');
  L.push('4. 誇大表現・保証表現を使わない');
  L.push('5. 効果や結果を断定しない');
  L.push('6. 他社商品を貶めない');
  L.push('7. 価格は本文に書かない（ポチップに任せる）');
  L.push('8. 文の長さにゆらぎを作り、同じ構成を商品ごとに繰り返さない');
  L.push('');
  const owned = inventory.filter((i) =>
    (project.products || []).some((p) => p.owned && p.name && p.name.includes(i.name.slice(0, 8)))
  );
  L.push('## 実体験を書いてよい商品（ステマ規制）');
  L.push('');
  if (owned.length) {
    owned.forEach((i) => {
      L.push(`### ${i.name}`);
      L.push('');
      L.push(`- 使用開始：${i.since || '不明'} ／ 状況：${i.status || '不明'}`);
      if ((i.notes || []).length) {
        L.push('- 気づいたことメモ：');
        i.notes.forEach((n) => L.push(`  - (${n.date}) ${n.text}`));
      } else {
        L.push('- メモなし');
      }
      L.push('');
    });
    L.push('**上記以外の商品には、体験の段落を書かないでください。**');
    L.push('体験段落の下書きはAIが書かず、空欄のまま「【ここに体験を書く】」と残してください。');
  } else {
    L.push('（この記事に、実際に使っている商品は含まれていません）');
    L.push('');
    L.push('**体験の段落は書かないでください。** すべて「口コミでは〜」の形で書いてください。');
  }
  L.push('');
  L.push('## 掲載商品と調査データ');
  L.push('');
  (project.products || []).forEach((p, idx) => {
    L.push(`### ${idx + 1}. ${p.name}`);
    L.push('');
    if (p.masterId) {
      L.push('- **記事に書く記法：`{{product:' + p.masterId + '}}`**');
      L.push('  この商品を紹介する見出しの直後に、この1行をそのまま置いてください。');
      L.push('  IDを勝手に変えたり、新しく作ったりしないでください。カードが出なくなります。');
    }
    L.push(`- 商品コード：${p.code || '–'}`);
    L.push(`- ショップ：${p.shop || '–'}`);
    L.push(`- レビュー：${p.reviewAverage || '–'}（${p.reviewCount || 0}件）`);
    L.push(`- 参考価格：${p.price ? p.price + '円' : '–'} ※本文には書かないこと`);
    L.push(`- 商品ページ：${p.url || '–'}`);
    L.push(`- 持ちもの台帳：${p.owned ? 'あり（体験を書いてよい）' : 'なし（体験を書かない）'}`);
    if (p.caption) {
      L.push('');
      L.push('**商品説明（販売ページより）**');
      L.push('');
      L.push('```');
      L.push(p.caption);
      L.push('```');
    }
    if (Object.keys(p.specs || {}).length) {
      L.push('');
      L.push('**スペック**（記事内ではこの順・この項目名で表にする）');
      L.push('');
      const order = SPEC_PRESET[project.category] || Object.keys(p.specs);
      order.forEach((k) => L.push(`- ${k}：${(p.specs || {})[k] || '–'}`));
    }
    if (p.reviewText) {
      L.push('');
      L.push(`**口コミ本文（${p.reviewUrl}）**`);
      L.push('');
      L.push('```');
      L.push(p.reviewText);
      L.push('```');
    } else {
      L.push('');
      L.push('**口コミ未取得**');
    }
    L.push('');
  });
  L.push('## 出力してほしいもの');
  L.push('');
  L.push('CLAUDE.mdのテンプレートに沿った記事本文（Markdown）を1本。');
  L.push('書き終えたら、アプリの「記事を読み込む」画面に貼り付けます。');
  return L.join('\n');
}


module.exports = { buildBrief, SPEC_PRESET };
