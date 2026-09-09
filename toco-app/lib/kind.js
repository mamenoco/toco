// 記事の種類（商品紹介 / コラム）
//
// 商品紹介はおすすめ○選の比較記事。コラムは読み物で、商品は軽く触れるだけにして
// 詳しい紹介は商品紹介の記事へ送ります。
// 構成も、執筆の材料も、公開前チェックも種類ごとに変わるので、ここで判定を一本化します。

const PRODUCT = 'product';
const COLUMN = 'column';

// カテゴリが「コラム」なら、指定がなくてもコラムとして扱います。
// 記事ネタを77件ぶん手で直さなくて済むようにするためです。
function of(x) {
  if (!x) return PRODUCT;
  if (x.kind === COLUMN || x.kind === PRODUCT) return x.kind;
  return String(x.category || '').includes('コラム') ? COLUMN : PRODUCT;
}

function isColumn(x) { return of(x) === COLUMN; }

function label(x) { return isColumn(x) ? 'コラム' : '商品紹介'; }

module.exports = { PRODUCT, COLUMN, of, isColumn, label };
