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

function normalize(name) {
  let s = String(name || '')
    .replace(/[【】\[\]（）()《》〈〉]/g, ' ')
    .replace(/[!！?？★☆◆■●▲♪]/g, ' ')
    .replace(/[　\s]+/g, ' ')
    .trim();
  NOISE.forEach((w) => { s = s.split(w).join(' '); });
  return s.replace(/\s+/g, ' ').trim();
}

// 商品を見分けるための語のあつまり
function tokens(name) {
  return new Set(normalize(name).toLowerCase()
    .split(/[\s・,、/／|｜]+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t)));
}

function similarity(a, b) {
  let hit = 0;
  a.forEach((t) => { if (b.has(t)) hit++; });
  const union = a.size + b.size - hit;
  return union ? hit / union : 0;
}

// 同じ商品とみなす条件：語の重なりが十分あり、価格帯も近いこと
function sameProduct(x, y) {
  const sim = similarity(x._tokens, y._tokens);
  if (sim < 0.55) return false;
  const px = Number(x.price) || 0;
  const py = Number(y.price) || 0;
  if (!px || !py) return sim >= 0.7;
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
    return Object.assign({}, rep, {
      shopCount: g.members.length,
      totalReviews,
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
  if (x.shopCount >= 3) bits.push(`${x.shopCount}店舗で扱いあり`);
  const m = String(x.name).match(SIZE_HINT);
  if (m) bits.push(`幅${m[1]}cm前後`);
  return bits.join('・');
}

// まとめて実行
function curate(items, opts) {
  const o = opts || {};
  const want = o.want || 10;
  const grouped = dedupe(items);
  const scored = score(grouped);
  const picked = diversify(scored, want, o.inventory);
  return {
    candidates: picked.map((x) => { const y = Object.assign({}, x); delete y._tokens; delete y._score; return y; }),
    searched: items.length,
    unique: grouped.length,
  };
}

module.exports = { curate, dedupe, score, diversify, normalize };
