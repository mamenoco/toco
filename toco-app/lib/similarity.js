// 文章の重なりを調べる
//
// 使いどころは3つです。
//   1. 集めた口コミの文が、そのまま本文に入っていないか（引用の転載を防ぐ）
//   2. 自分の別の記事と同じ言い回しになっていないか（重複コンテンツ対策）
//   3. 外部サイトとの照合 … これは検索が必要なので、確認用のフレーズを抜き出すところまで
//
// ※ ウェブ全体との照合には検索APIが要ります。ここではやりません（§外部照合について）。

// 比べる前に、記号や空白を落として素の文章にします。
// もとの位置に戻せるよう、対応表も一緒に作ります。
function normalize(text) {
  const src = String(text || '')
    .replace(/\{\{[^}]*\}\}/g, ' ')          // {{product:…}} などの記法
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')   // 画像
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンクは文字だけ残す
    .replace(/<!--[\s\S]*?-->/g, ' ');
  let norm = '';
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (/[\s#*>|`=~\-–—・:：、。，．,.「」『』（）()【】\[\]!！?？…]/.test(c)) continue;
    norm += c;
    map.push(i);
  }
  return { norm, map, src };
}

function shingleSet(text, n) {
  const { norm } = normalize(text);
  const set = new Set();
  for (let i = 0; i + n <= norm.length; i++) set.add(norm.slice(i, i + n));
  return set;
}

// a の中から、b にも出てくる連続した部分を探します。
function commonRuns(a, b, opts) {
  const o = opts || {};
  const n = o.gram || 18;        // この長さで一致を拾い、つながっていれば伸ばす
  const min = o.min || 24;       // これより短い一致は報告しない
  const A = normalize(a);
  const bSet = shingleSet(b, n);
  const runs = [];
  let i = 0;
  while (i + n <= A.norm.length) {
    if (!bSet.has(A.norm.slice(i, i + n))) { i++; continue; }
    let j = i + n;
    while (j < A.norm.length && bSet.has(A.norm.slice(j - n + 1, j + 1))) j++;
    if (j - i >= min) {
      runs.push({
        length: j - i,
        text: A.src.slice(A.map[i], A.map[j - 1] + 1).trim(),
      });
    }
    i = j;
  }
  return runs.sort((x, y) => y.length - x.length);
}

// 一致した割合（ざっくりの目安）
function overlapRate(a, b, opts) {
  const A = normalize(a).norm;
  if (!A.length) return 0;
  const runs = commonRuns(a, b, opts);
  const hit = runs.reduce((n, r) => n + r.length, 0);
  return Math.min(1, hit / A.length);
}

// 外部サイトとの照合に使う、特徴のある文を抜き出します。
// 短すぎる文やありふれた言い回しは、検索しても意味がないので外します。
const COMMON = /^(そのため|ただし|また|とはいえ|ぜひ|おすすめです|参考にしてください)/;

function searchPhrases(text, count) {
  const want = count || 6;
  const body = String(text || '')
    .replace(/^---[\s\S]*?---/, '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/^\s*[#>|\-*].*$/gm, ' ')      // 見出し・表・箇条書きは外す
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  const sentences = body.split(/[。\n]/).map((x) => x.trim())
    .filter((x) => x.length >= 26 && x.length <= 70)
    .filter((x) => !COMMON.test(x))
    .filter((x) => !/【|】/.test(x));

  if (!sentences.length) return [];
  // 記事全体から均等に選びます（冒頭だけだと偏るため）
  const step = Math.max(1, Math.floor(sentences.length / want));
  const picked = [];
  for (let i = 0; i < sentences.length && picked.length < want; i += step) picked.push(sentences[i]);
  return picked;
}

module.exports = { normalize, commonRuns, overlapRate, searchPhrases };
