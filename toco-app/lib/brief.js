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

// コラム用の材料。商品紹介とは記事の役目が違うので、別に組み立てます。
//
// コラムは読み物です。商品は「この場面ならこれ」と軽く触れるだけにして、
// 詳しい比較は商品紹介の記事へ送ります。そうしないと、
// 同じ検索語で自分の記事どうしが competing してしまいます。
// 送り先の記事。まだ無いときにも落ちないようにします。
function firstArticle(m) {
  const a = (m && m.articles && m.articles[0]) || {};
  return { slug: a.slug || 'スラッグ', title: a.title || '記事名' };
}

function buildColumnBrief(project, mentions) {
  const L = [];
  L.push(`# 執筆用ブリーフ（コラム）：${project.title || project.keyword}`);
  L.push('');
  L.push('このファイルをClaude Codeに読ませて記事を書いてください。');
  L.push('');
  L.push('## 記事の条件');
  L.push('');
  L.push(`- キーワード：${project.keyword}`);
  L.push(`- カテゴリ：${project.category || '（未設定）'}`);
  L.push('- 種類：**コラム**（商品を並べる比較記事ではありません）');
  L.push(`- 作成日：${today()}`);
  if (project.ideaNote) L.push(`- この記事のねらい：${project.ideaNote}`);
  L.push('');
  L.push('## コラムの役目');
  L.push('');
  L.push('この記事は、まだ商品を買う気になっていない読者が読む入り口です。');
  L.push('悩みや疑問に答えることが本題で、商品を売ることは本題ではありません。');
  L.push('商品は「この場面ならこれ」と軽く触れるだけにして、');
  L.push('**詳しい比較は、すでにある商品紹介の記事へ送ってください。**');
  L.push('');
  L.push('## 守るルール');
  L.push('');
  L.push('プロジェクト直下の CLAUDE.md（スタイルガイド）の「コラム記事の型」に従ってください。とくに以下。');
  L.push('');
  L.push('1. 比較表は作らない。スペック表も作らない');
  L.push('2. 商品ごとの紹介は**2〜3文まで**。良い点と気になる点を並べる書き方はしない');
  L.push('3. 商品に触れたら、**必ずその商品を詳しく紹介している記事へのリンクを置く**');
  L.push('4. 触れてよい商品は下に挙げたものだけ。ほかの商品を持ち出さない');
  L.push('5. 実体験は、下で「体験を書いてよい」とされたものだけ');
  L.push('6. 誇大表現・保証表現を使わない。効果や結果を断定しない');
  L.push('7. 価格は本文に書かない');
  L.push('');
  L.push('## この記事で触れる商品');
  L.push('');
  if (!mentions.length) {
    L.push('（商品には触れません。読み物として書いてください）');
  } else {
    L.push('見出しに商品名を置き、その直後にカードの記法を1行、そのあと2〜3文。');
    L.push('最後に送り先の記事へのリンクを置きます。書き方の見本：');
    L.push('');
    L.push('```');
    L.push('### ' + (mentions[0].name || '商品名'));
    L.push('');
    L.push('{{product:' + (mentions[0].id || 'ID') + '}}');
    L.push('');
    L.push('（この場面でなぜこれなのかを2〜3文。仕様の羅列にしない）');
    L.push('');
    L.push('詳しくは{{link:' + firstArticle(mentions[0]).slug + '|'
      + firstArticle(mentions[0]).title + '}}で紹介しています。');
    L.push('```');
    L.push('');
    mentions.forEach((m, i) => {
      L.push(`### ${i + 1}. ${m.name}`);
      L.push('');
      L.push('- **記事に書く記法：`{{product:' + m.id + '}}`**');
      L.push('- 送り先の記事：' + (m.articles || []).map((a) => `{{link:${a.slug}|${a.title}}}`).join(' / '));
      L.push('- 体験：' + (m.owned ? 'あり（実際に使っているので、体験を1文だけ書いてよい）' : 'なし（体験を書かない）'));
      if (m.why) L.push('- この記事で触れる理由：' + m.why);
      L.push('');
    });
  }
  L.push('## 出力してほしいもの');
  L.push('');
  L.push('CLAUDE.mdの「コラム記事の型」に沿った記事本文（Markdown）を1本。');
  return L.join('\n');
}

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


module.exports = { buildBrief, buildColumnBrief, SPEC_PRESET };
