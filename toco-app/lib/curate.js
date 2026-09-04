// 検索結果から、記事に載せる候補を絞り込む
//
// 楽天の検索結果は「同じ商品を別のショップが出している」ものが大量に混ざります。
// 30件あっても実質10商品ということが珍しくありません。
// ここでは次の順に処理します。
//
//   1. 同じ商品どうしをまとめる（レビューの多いショップを代表にする）
//   2. 人気と評価から点数を付ける
//   3. 価格帯が散るように候補を選ぶ
//
// ※「購入数」は楽天APIでは取得できません。レビュー件数を人気の代理指標にしています。

// ショップが付ける宣伝文句。商品の区別には関係しないので落とします。
const NOISE = [
  '送料無料', '送料込', 'あす楽', '即納', '在庫あり', '新品', '正規品', '国内正規',
  'ポイント', '倍', '最大', 'セール', '期間限定', 'クーポン', '限定', '数量限定',
  'まとめ買い', 'お買い得', '人気', 'おすすめ', '楽天', 'ランキング', '入賞',
  '沖縄', '離島', '別途', '配送', '同梱', '代引', '予約', '入荷', 'レビュー',
];
const SIZE_HINT = /(\d{2,3})\s*(cm|センチ)/;

// 記事に載せる名前として使えるよう、宣伝文句や飾りを落とします。
// 「◆令和8年度産新刈り◆【送料無料】牧草市場 スーパープレミアム…」→「牧草市場 スーパープレミアム…」
function cleanName(name) {
  let s = String(name || '')
    .replace(/◆[^◆]{0,20}◆/g, ' ')
    .replace(/【[^】]{0,24}】/g, ' ')
    .replace(/\([^)]{0,10}(送料|ポイント|クーポン)[^)]{0,10}\)/g, ' ')
    .replace(/[★☆◇■●▲♪]/g, ' ');
  NOISE.forEach((w) => { s = s.split(w).join(' '); });
  return s.replace(/[　\s]+/g, ' ').replace(/^[\s・,、/|]+/, '').trim().slice(0, 60);
}

// 「一番刈り」と「1番刈り」のような表記ゆれをそろえます。
// 同じ商品なのに別物と数えてしまうのを防ぐためです。
const KANJI_NUM = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' };

function normalize(name) {
  let s = String(name || '')
    .replace(/[一二三四五六七八九](?=番)/g, (c) => KANJI_NUM[c])
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[【】\[\]（）()《》〈〉]/g, ' ')
    .replace(/[!！?？★☆◆■●▲♪]/g, ' ')
    .replace(/[　\s]+/g, ' ')
    .trim();
  NOISE.forEach((w) => { s = s.split(w).join(' '); });
  return s.replace(/\s+/g, ' ').trim();
}

// 商品を見分けるための手がかり。
// 日本語の商品名はスペースで区切られていないことが多く、単語では比べられません。
// そこで「隣り合う2文字」の集合どうしを比べます（2-gram）。
//   「チモシー1番刈り」→ チモ, モシ, シー, ー1, 1番, 番刈, 刈り
function tokens(name) {
  // 「3kg」「1.5kg」「500g×6パック」などは商品を分ける手がかりにしません。
  // 同じ商品のサイズ違いを別物と数えてしまうためです。
  const s = normalize(name).toLowerCase()
    .replace(/\d+(?:\.\d+)?\s*(kg|ｋｇ|g|ｇ|l|ml|cm|センチ|袋|パック|個|入)/g, ' ')
    .replace(/[×x]\s*\d+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[\s・,、/／|｜]/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

// 内容量・サイズの表記を拾う（同じ商品のサイズ違いをまとめるため）
function sizeOf(name) {
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*(kg|g|ｇ|ｋｇ|l|ml|cm|センチ)/i);
  return m ? m[1] + m[2].toLowerCase() : '';
}

function overlapCount(a, b) {
  let hit = 0;
  a.forEach((t) => { if (b.has(t)) hit++; });
  return hit;
}

// 重なりの割合（Jaccard）。名前の長さが近いときに向きます。
function similarity(a, b) {
  const hit = overlapCount(a, b);
  const union = a.size + b.size - hit;
  return union ? hit / union : 0;
}

// 短いほうがどれだけ長いほうに含まれるか。
// 「◯◯チモシー 3kg」と「◯◯チモシー（うさぎ・モルモットなどの牧草）」のように
// 片方だけ説明が長い場合でも、同じ商品だと分かります。
function containment(a, b) {
  const min = Math.min(a.size, b.size);
  return min ? overlapCount(a, b) / min : 0;
}

// 同じ商品とみなす条件
//   ・名前がとてもよく似ている（0.72以上）→ 価格が違っても同じ商品のサイズ違いとみなす
//   ・そこそこ似ている（0.55以上）→ 価格帯も近ければ同じ商品（ショップ違い）
function sameProduct(x, y) {
  // 短いほうの名前が十分に短いと、偶然の一致で誤ってまとめてしまいます
  const shortest = Math.min(x._tokens.size, y._tokens.size);
  if (shortest < 8) return false;

  const sim = similarity(x._tokens, y._tokens);
  if (sim >= 0.72) return true;
  if (containment(x._tokens, y._tokens) >= 0.82) return true;
  if (sim < 0.55) return false;
  const px = Number(x.price) || 0;
  const py = Number(y.price) || 0;
  if (!px || !py) return false;
  const ratio = Math.min(px, py) / Math.max(px, py);
  return ratio >= 0.7;
}

// 1. まとめる
function dedupe(items) {
  const list = items.map((it) => Object.assign({}, it, { _tokens: tokens(it.name) }));
  const groups = [];
  list.forEach((it) => {
    const g = groups.find((x) => sameProduct(x.rep, it));
    if (g) { g.members.push(it); return; }
    groups.push({ rep: it, members: [it] });
  });

  return groups.map((g) => {
    // レビューがいちばん多いショップを代表にする（情報が揃っているため）
    const rep = g.members.slice().sort((a, b) =>
      (Number(b.reviewCount) || 0) - (Number(a.reviewCount) || 0))[0];
    const totalReviews = g.members.reduce((n, m) => n + (Number(m.reviewCount) || 0), 0);
    const prices = g.members.map((m) => Number(m.price) || 0).filter(Boolean);
    const sizes = [...new Set(g.members.map((m) => sizeOf(m.name)).filter(Boolean))];
    return Object.assign({}, rep, {
      name: cleanName(rep.name),
      rawName: rep.name,
      shopCount: g.members.length,
      totalReviews,
      sizes,
      priceMin: prices.length ? Math.min(...prices) : 0,
      priceMax: prices.length ? Math.max(...prices) : 0,
    });
  });
}

// 2. 点数を付ける
// レビュー1件で★5の商品が上位に来ないよう、全体平均に寄せた平均点を使います（ベイズ平均）。
function score(list) {
  const withReviews = list.filter((x) => (Number(x.reviewCount) || 0) > 0);
  const globalAvg = withReviews.length
    ? withReviews.reduce((n, x) => n + Number(x.reviewAverage || 0), 0) / withReviews.length
    : 4;
  const M = 10;   // この件数までは全体平均に寄せる

  return list.map((x) => {
    const v = Number(x.totalReviews) || 0;
    const r = Number(x.reviewAverage) || 0;
    const bayes = (v / (v + M)) * r + (M / (v + M)) * globalAvg;
    // 件数は桁で効かせる（100件と1000件の差を、1000倍ではなく妥当な差に）
    const popularity = Math.log10(v + 1);
    return Object.assign({}, x, {
      bayes: Number(bayes.toFixed(2)),
      _score: popularity * 2 + bayes,
    });
  }).sort((a, b) => b._score - a._score);
}

// 3. 価格帯が散るように選ぶ
// 上から10件そのまま取ると、同じ価格帯ばかりになりがちです。
function diversify(list, want, inventory) {
  const picked = [];
  const isOwned = (name) => (inventory || []).some((i) => {
    const key = (i.name || '').replace(/\s+/g, '').slice(0, 8);
    return key && String(name).replace(/\s+/g, '').includes(key);
  });

  // 持ちもの台帳にある商品は必ず入れる（実体験が書ける唯一の商品のため）
  list.forEach((x) => {
    if (picked.length < want && isOwned(x.name) && !picked.includes(x)) {
      picked.push(Object.assign(x, { owned: true, reason: '持ちもの台帳にあります（実体験が書けます）' }));
    }
  });

  const prices = list.map((x) => Number(x.price) || 0).filter(Boolean).sort((a, b) => a - b);
  const low = prices[Math.floor(prices.length * 0.33)] || 0;
  const high = prices[Math.floor(prices.length * 0.66)] || 0;
  const band = (p) => (!p ? '不明' : p <= low ? '安い' : p <= high ? '中間' : '高め');

  const counts = { 安い: 0, 中間: 0, 高め: 0, 不明: 0 };
  picked.forEach((x) => { counts[band(Number(x.price))]++; });
  const cap = Math.ceil(want / 2);   // ひとつの価格帯が半分を超えないようにする

  // まずは価格帯の上限を守りながら
  list.forEach((x) => {
    if (picked.length >= want || picked.includes(x)) return;
    const b = band(Number(x.price));
    if (counts[b] >= cap) return;
    counts[b]++;
    picked.push(Object.assign(x, { reason: reasonFor(x, b) }));
  });
  // 足りなければ点数順に埋める
  list.forEach((x) => {
    if (picked.length >= want || picked.includes(x)) return;
    picked.push(Object.assign(x, { reason: reasonFor(x, band(Number(x.price))) }));
  });

  return picked.map((x) => Object.assign({}, x, { priceBand: band(Number(x.price)) }));
}

function reasonFor(x, band) {
  const bits = [];
  if (x.totalReviews >= 300) bits.push(`口コミ${x.totalReviews}件と多い`);
  else if (x.totalReviews >= 50) bits.push(`口コミ${x.totalReviews}件`);
  else if (x.totalReviews > 0) bits.push(`口コミ${x.totalReviews}件と少なめ`);
  else bits.push('口コミなし');
  if (Number(x.reviewAverage) >= 4.5) bits.push('評価が高い');
  bits.push(`価格帯は${band}`);
  if (x.shopCount >= 3) bits.push(`${x.shopCount}件が同一商品`);
  if (x.sizes && x.sizes.length >= 2) bits.push(`容量は${x.sizes.slice(0, 4).join('・')}`);
  const m = String(x.name).match(SIZE_HINT);
  if (m) bits.push(`幅${m[1]}cm前後`);
  return bits.join('・');
}

// 記事で紹介するのに向かない出品。
// 中身が確定しないもの、期間限定の企画ものは候補から外します。
const SKIP = /(抽選|当選|福袋|くじ|訳あり|わけあり|アウトレット|お一人様|中古|ジャンク|開店|閉店セール)/;

// まとめて実行
function curate(items, opts) {
  const o = opts || {};
  const want = o.want || 10;
  const usable = items.filter((x) => !SKIP.test(String(x.name)));
  const grouped = dedupe(usable);
  const scored = score(grouped);
  const picked = diversify(scored, want, o.inventory);
  return {
    candidates: picked.map((x) => { const y = Object.assign({}, x); delete y._tokens; delete y._score; return y; }),
    searched: items.length,
    skipped: items.length - usable.length,
    unique: grouped.length,
  };
}

module.exports = { curate, dedupe, score, diversify, normalize };
