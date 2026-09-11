// 記事ネタの候補を出す
//
// すでにある記事ネタ・公開した記事・リンク待ちを全部見せたうえで、
// まだ書いていないテーマを Claude に挙げてもらいます。
// ファイルは触らせません。
//
// 出てきたものをそのまま登録はしません。画面で選んでから登録します。

const { spawn } = require('child_process');
const path = require('path');

const APP = path.join(__dirname, '..');

function instruction(o) {
  const L = [];
  L.push('あなたは、うさぎ専門メディア「tocoとくらし」の編集担当です。');
  L.push(`これから書く記事のネタを${o.count}件挙げてください。`);
  L.push('');
  L.push('## サイトの方針');
  L.push('');
  L.push('- うさぎと暮らしている人が書いています（実体験が最大の強み）');
  L.push('- 商品紹介・比較記事（アフィリエイト）と、コラムの2種類があります');
  L.push('- コラムは商品を売る記事ではなく、**商品記事へ読者を送る入り口**です');
  L.push('- 使えるカテゴリ：' + o.categories.join(' / '));
  L.push('');
  L.push('## 挙げ方');
  L.push('');
  if (o.kind === 'product') {
    L.push('- 商品紹介の記事だけを挙げてください（カテゴリに「コラム」は使わない）');
    L.push('- 楽天やAmazonでうさぎ用として実際に売られているものに限ります');
  } else if (o.kind === 'column') {
    L.push('- コラムだけを挙げてください（カテゴリはすべて「コラム」）');
    L.push('- 商品が無くても構いません。読み物として成立するものを挙げます');
  } else {
    L.push('- 商品紹介とコラムの両方を挙げてください');
    L.push('- コラムを多めにします。商品カテゴリは埋まってきているためです');
  }
  L.push('- **1本のコラムから複数の商品記事へ送れるもの**を優先します');
  L.push('- うさぎを飼っている人が実際に検索しそうな言葉を選びます');
  L.push('- ニッチすぎるもの、うさぎと関係が薄いものは挙げません');
  L.push('- すでにあるネタ・記事と重ならないようにします（下に一覧があります）');
  L.push('');
  L.push('## それぞれに書くもの');
  L.push('');
  L.push('- title … 記事ネタの名前。この段階では簡単で構いません（例：うさぎの寿命は何年？）');
  L.push('- keyword … 検索されそうな言葉。空白区切り（例：うさぎ 寿命）');
  L.push('- category … 上のカテゴリ名のどれか');
  L.push('- slug … URL。英小文字・数字・ハイフン。うさぎの記事は rabbit- で始めます');
  L.push('- priority … 高 / 中 / 低。検索が多く入り口になるものを「高」に');
  L.push('- note … 書くときの切り口と、どの記事へリンクさせるか。1〜2文');
  L.push('');
  if (o.pending && o.pending.length) {
    L.push('## すでに本文からリンクされているのに、まだ無い記事');
    L.push('');
    L.push('本文に「あとで書く」としてリンクが置かれています。');
    L.push('**このURLをそのまま slug に使って、必ず候補に入れてください。**');
    L.push('書けばリンクが自動でつながります。priority は「高」にします。');
    L.push('');
    o.pending.forEach((p) => L.push(`- slug: ${p.slug} ／ 本文での呼び方: ${p.labels.join('・')}`));
    L.push('');
  }
  L.push('## すでにある記事ネタ（重複させない）');
  L.push('');
  o.ideas.forEach((i) => L.push(`- ${i.title}（${i.keyword || ''}）`));
  L.push('');
  L.push('## 公開ずみの記事（重複させない）');
  L.push('');
  o.articles.forEach((a) => L.push(`- ${a.title} … /${a.slug}/`));
  L.push('');
  if (o.hint) {
    L.push('## 今回の希望');
    L.push('');
    L.push(o.hint);
    L.push('');
  }
  L.push('## 出し方');
  L.push('');
  L.push('次の形のJSONだけを出してください。説明・前置き・```は付けないでください。');
  L.push('[{"title":"…","keyword":"…","category":"…","slug":"…","priority":"高","note":"…"}]');
  return L.join('\n');
}

function parse(out) {
  const text = String(out || '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

function suggest(opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env);
    if (!env.LC_ALL) env.LC_ALL = env.LANG || 'ja_JP.UTF-8';
    if (!env.LANG) env.LANG = env.LC_ALL;
    ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ANTHROPIC_API_KEY']
      .forEach((k) => delete env[k]);

    const args = ['-p', instruction(o), '--output-format', 'text', '--allowedTools', ''];
    if (o.model) args.push('--model', o.model);

    let child;
    try {
      child = spawn('claude', args, { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error('claude コマンドを起動できませんでした：' + e.message));
    }

    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      reject(new Error('時間がかかりすぎたため、いったん止めました。件数を減らしてお試しください。'));
    }, o.timeoutMs || 300000);

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error('うまくいきませんでした：' + (err || out || '（詳細なし）').trim().slice(0, 300)));
      }
      const arr = parse(out);
      if (!Array.isArray(arr) || !arr.length) {
        return reject(new Error('結果を読み取れませんでした。もう一度お試しください。'));
      }
      resolve(arr.map((x) => ({
        title: String(x.title || '').trim(),
        keyword: String(x.keyword || '').trim(),
        category: String(x.category || '').trim(),
        slug: String(x.slug || '').trim(),
        priority: ['高', '中', '低'].includes(x.priority) ? x.priority : '中',
        note: String(x.note || '').trim(),
      })).filter((x) => x.title));
    });
  });
}

module.exports = { suggest };
