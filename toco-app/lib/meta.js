// 本文から、記事のタイトル・説明文・タグの案を作る
//
// 記事ネタの段階では「うさぎのトイレ」のような簡単な名前で足りますが、
// 公開するときは、本文の中身に合ったタイトルと説明文が要ります。
// ここでは、すでに入っている Claude Code に本文を読ませて案を出してもらいます。
// ファイルは触らせません。

const { spawn } = require('child_process');
const path = require('path');

const APP = path.join(__dirname, '..');

// 本文から、紹介している商品の数を数えます（「○選」を間違えないため）
function countProducts(body) {
  const m = String(body || '').match(/\{\{product:[^}]+\}\}/g);
  return m ? new Set(m).size : 0;
}

// 見出しだけを抜き出す（記事の骨組みを短く伝えるため）
function outline(body) {
  return String(body || '').split('\n')
    .filter((l) => /^#{2,3}\s/.test(l))
    .map((l) => l.replace(/\*\*/g, '').trim())
    .slice(0, 40).join('\n');
}

function instruction(o) {
  const L = [];
  L.push('あなたは、うさぎ専門メディア「tocoとくらし」の編集担当です。');
  L.push('これから渡す記事の本文を読んで、タイトル・説明文・タグの案を作ってください。');
  L.push('');
  L.push('## タイトルの決まり');
  L.push('');
  L.push('・形は `〇〇のおすすめ○選｜サブ要素やサブ要素まで詳しく紹介` です');
  L.push('・区切りは全角の縦棒（｜）を使います');
  if (o.productCount) {
    L.push(`・この記事で紹介している商品は${o.productCount}点なので、「${o.productCount}選」と書きます`);
  } else {
    L.push('・商品を並べる形の記事でないときは「○選」を無理に入れません');
  }
  L.push('・縦棒のうしろには、検索されそうな語を2つ入れます（安い／選び方／初心者／掃除／サイズ など）');
  L.push('・本文に書かれていない語は入れません');
  L.push('・全角で38字前後まで。長くなりすぎないようにします');
  L.push('');
  L.push('## 説明文の決まり');
  L.push('');
  L.push('・80〜120字。です・ます調');
  L.push('・その記事を読むと何が分かるのかを、本文の中身に沿って書きます');
  L.push('・「絶対」「必ず」「最強」「No.1」などの言い切りは使いません');
  L.push('・価格は書きません（変わるため）');
  L.push('・「この記事では」で始めません。中身から書き出します');
  L.push('');
  L.push('## タグの決まり');
  L.push('');
  L.push('・2〜4個。カンマ区切り。それぞれ10字以内');
  L.push('・本文で扱っているテーマの語にします（例：ケージ選び, 初心者, 掃除）');
  L.push('');
  L.push('## 出し方');
  L.push('');
  L.push('次の形のJSONだけを1行で出してください。説明や前置き、```は付けないでください。');
  L.push('{"title":"…","description":"…","tags":"…, …"}');
  L.push('');
  L.push('## 記事の情報');
  L.push('');
  L.push(`- キーワード：${o.keyword || '（なし）'}`);
  L.push(`- カテゴリ：${o.category || '（なし）'}`);
  L.push(`- 掲載商品数：${o.productCount}点`);
  L.push('');
  L.push('## 見出しの並び');
  L.push('');
  L.push(o.outline || '（見出しなし）');
  L.push('');
  L.push('## 本文');
  L.push('');
  L.push(o.body);
  return L.join('\n');
}

// 前後に付いてきた説明や ``` を落として、JSONの部分だけ取り出します
function parse(out) {
  const text = String(out || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

function suggest(opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const body = String(o.body || '').trim();
    if (body.length < 200) {
      return reject(new Error('本文がまだ短いため、タイトルと説明文は作れませんでした。'));
    }

    const env = Object.assign({}, process.env);
    if (!env.LC_ALL) env.LC_ALL = env.LANG || 'ja_JP.UTF-8';
    if (!env.LANG) env.LANG = env.LC_ALL;
    ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ANTHROPIC_API_KEY']
      .forEach((k) => delete env[k]);

    const prompt = instruction({
      keyword: o.keyword, category: o.category,
      productCount: countProducts(body),
      outline: outline(body),
      body: body.slice(0, 24000),
    });

    const args = ['-p', prompt, '--output-format', 'text', '--allowedTools', ''];
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
      reject(new Error('時間がかかりすぎたため、いったん止めました。もう一度お試しください。'));
    }, o.timeoutMs || 180000);

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error('うまくいきませんでした：' + (err || out || '（詳細なし）').trim().slice(0, 300)));
      }
      const j = parse(out);
      if (!j || !j.title) {
        return reject(new Error('結果を読み取れませんでした。もう一度お試しください。'));
      }
      resolve({
        title: String(j.title || '').trim(),
        description: String(j.description || '').trim(),
        tags: String(j.tags || '').trim(),
      });
    });
  });
}

module.exports = { suggest, countProducts, outline };
