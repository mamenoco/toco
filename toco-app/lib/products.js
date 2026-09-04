// 商品マスタ
//
// 同じ商品を複数の記事で使うため、記事ごとではなく1か所にまとめて持ちます。
// ポチップのカスタム投稿タイプにあたるものです。

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'products.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return []; }
}

function save(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
  return list;
}

function get(id) {
  return load().find((p) => p.id === id) || null;
}

// 商品IDは記事のMarkdownに {{product:xxx}} の形で書くので、
// あとから見て何の商品か分かる文字列にします。
// 商品IDは記事に {{product:xxx}} と書くので、あとから見て分かる文字列にします。
// 日本語の商品名からは英数字が取れないため、楽天の商品コード（shop:number）を使います。
//   「牧草市場 スーパープレミアム…」＋ mapet:10003327 → mapet-3327
function suggestId(name, taken, code) {
  const used = new Set(taken || load().map((p) => p.id));
  let base = String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  if (base.length < 3 && code) {
    const m = String(code).match(/^([a-z0-9-]+):(\d+)$/i);
    if (m) base = `${m[1]}-${m[2].slice(-4)}`;
  }
  if (base.length < 3) base = 'item';
  if (!used.has(base)) return base;
  for (let i = 2; i < 200; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

function upsert(product) {
  const list = load();
  const i = list.findIndex((p) => p.id === product.id);
  const next = Object.assign({}, i >= 0 ? list[i] : {}, product,
    { updatedAt: new Date().toISOString().slice(0, 10) });
  if (i >= 0) list[i] = next; else list.push(next);
  save(list);
  return next;
}

function remove(id) {
  save(load().filter((p) => p.id !== id));
}

// 記事の作業画面で選んだ商品（楽天APIの生データ）を、マスタの形に整えます。
function fromSearchItem(item, opts) {
  const o = opts || {};
  return {
    id: o.id || suggestId(o.idHint || item.name, null, item.code),
    name: item.name || '',
    brand: o.brand || '',
    category: o.category || '',
    image: item.image || '',
    rakuten: { itemCode: item.code || '', url: item.url || '' },
    amazon: { asin: o.asin || '' },
    yahoo: { url: '' },
    specs: item.specs || {},
    reviewCount: item.reviewCount || 0,
    reviewAverage: item.reviewAverage || '',
    reviewSummary: '',
    owned: !!item.owned,
  };
}

// 持ちもの台帳と照合して、体験を書いてよい商品かを判定します。
function markOwned(list, inventory) {
  return list.map((p) => {
    const hit = (inventory || []).find((i) => {
      const key = (i.name || '').replace(/\s+/g, '').slice(0, 8);
      return key && (p.name || '').replace(/\s+/g, '').includes(key);
    });
    return Object.assign({}, p, { owned: !!hit, ownedSince: hit ? hit.since : '' });
  });
}

module.exports = { FILE, load, save, get, upsert, remove, suggestId, fromSearchItem, markOwned };
