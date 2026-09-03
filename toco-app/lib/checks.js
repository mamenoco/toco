// 公開前チェック
// （server.js から切り出したものです。処理内容は変えていません）

const fs = require("fs");
const path = require("path");

// ---------- 公開前チェック ----------

const BANNED = [
  ['絶対', '誇大・保証表現'],
  ['必ず', '誇大・保証表現'],
  ['誰でも', '誇大・保証表現'],
  ['最強', '誇大表現'],
  ['No.1', '誇大表現'],
  ['ナンバーワン', '誇大表現'],
  ['驚愕', '煽り表現'],
  ['確実に', '保証表現'],
  ['治る', '効果の断定（薬機法）'],
  ['治療でき', '効果の断定（薬機法）'],
  ['予防できます', '効果の断定'],
  ['完治', '効果の断定'],
];

// スタイルガイドで決めた表記。左が見つかったら右に直す。
const WORDING = [
  ['我が家', 'わが家'],
  ['うさちゃん', 'うさぎ'],
  ['下さい', 'ください'],
  ['頂く', 'いただく'],
  ['出来る', 'できる'],
  ['是非', 'ぜひ'],
  ['様々', 'さまざま'],
  ['オススメ', 'おすすめ'],
  ['お薦め', 'おすすめ'],
  ['沢山', 'たくさん'],
];

// どちらを使ってもよいが、記事の中で混ざってはいけない語
const MIXED = [
  ['うんち', 'フン'],
  ['子ウサギ', '子うさぎ'],
  ['ケージ', 'ゲージ'],
];

// 体験を書いている段落かどうかの手がかり
const EXP_WORDS = ['わが家', '我が家', 'うちのうさぎ', 'うちの子',
  '使っています', '使ってみて', '使ってみた', '買い替えました', '敷いています'];

// 商品名が本文に出てくるか判定する。
// 記事では「見出し＝商品名／次の行＝ブランド名」と分かれるため、
// 名前を語に分け、長い語（型番を含む部分）のどれかが本文にあれば一致とみなす。
function nameAppears(name, flatText) {
  const parts = String(name || '')
    .split(/[\s　・／\/（）()]+/)
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length);
  if (!parts.length) return true;
  return parts.slice(0, 2).some((k) => flatText.includes(k));
}

function runChecks(article, project, inventory) {
  const out = [];
  const text = article || '';
  const add = (level, label, detail, fix, goto) =>
    out.push({ level, label, detail, fix: fix || '', goto: goto || null });

  if (!text.trim()) {
    add('error', '記事が空です', 'Claude Codeで書いた記事を貼り付けてください。');
    return out;
  }

  // 禁止表現
  BANNED.forEach(([word, why]) => {
    if (text.includes(word)) add('error', `禁止表現「${word}」`, why,
      `本文にある「${word}」という表現を、断定を避けた言い方に書き換えてください。ほかの箇所は変更しないでください。`);
  });

  // 一人称
  ['私は', '私が', '私の', '筆者'].forEach((w) => {
    if (text.includes(w)) add('warn', `一人称「${w}」`, '「わが家」「うちのうさぎ」に統一してください。',
      `本文の「${w}」を「わが家」または「うちのうさぎ」に書き換えてください。ほかの箇所は変更しないでください。`);
  });

  // アフィリエイト表記
  if (!/アフィリエイト広告が含まれ/.test(text)) {
    add('error', 'アフィリエイト表記がありません', '記事冒頭に「※本記事にはアフィリエイト広告が含まれます。」を入れてください。',
      '記事の一番上のタイトル行の直後に、空行をはさんで「※本記事にはアフィリエイト広告が含まれます。」という1行を追加してください。ほかの箇所は変更しないでください。');
  }

  // 価格の直書き
  const priceHits = text.match(/[0-9０-９,，]+\s*円/g) || [];
  const realPrice = priceHits.filter((s) => /[0-9０-９]{3,}/.test(s.replace(/[,，]/g, '')));
  if (realPrice.length) {
    add('warn', `本文に価格が書かれています（${realPrice.length}か所）`,
      `${realPrice.slice(0, 5).join(' / ')} … 価格はポチップに任せる方針です。`,
      '本文に書かれている具体的な金額を、金額を出さない表現に書き換えてください（例：「6,000円台から」→「安いものでは」）。スペック表と商品名は変更しないでください。');
  }

  // 体験の記述と持ちもの台帳の整合（ステマ規制）
  const expWords = ['わが家', 'うちのうさぎ', 'うちの子', '使っています', '使ってみる', '使ってみた', '買い替えました'];
  const hasExp = expWords.some((w) => text.includes(w));
  const ownedNames = inventory.map((i) => i.name);
  if (hasExp) {
    if (!ownedNames.length) {
      add('error', '体験の記述がありますが、持ちもの台帳が空です',
        '実際に使っている商品を台帳に登録してください（ステマ規制）。',
        '', { view: 'inventory' });
    } else {
      const flatAll = text.replace(/\s+/g, '');
      const mentioned = ownedNames.filter((n) => nameAppears(n, flatAll));
      if (!mentioned.length) {
        add('warn', '体験の記述がありますが、台帳の商品名が本文に見当たりません',
          '使っていない商品に体験を書いていないか確認してください（ステマ規制）。',
          '', { view: 'inventory' });
      } else {
        add('ok', '体験の記述と台帳が対応しています', `台帳で確認：${mentioned.join(' / ')}`);
      }
    }
  } else {
    add('info', '体験の記述が見当たりません',
      '実際に使っている商品があれば、その段落を入れると独自性が上がります。',
      '', { step: 4 });
  }

  // 表記ゆれ（ガイドで決めている語）
  WORDING.forEach(([bad, good]) => {
    const n = (text.match(new RegExp(bad, 'g')) || []).length;
    if (n) add('warn', `表記「${bad}」は「${good}」に`, `${n}か所あります。記事全体で表記を揃えてください。`,
      `本文の「${bad}」をすべて「${good}」に置き換えてください。ほかの箇所は変更しないでください。`);
  });

  // 記事の中で表記が混ざっている語
  MIXED.forEach(([a, b]) => {
    const na = (text.match(new RegExp(a, 'g')) || []).length;
    const nb = (text.match(new RegExp(b, 'g')) || []).length;
    if (na && nb) {
      add('warn', `「${a}」と「${b}」が混ざっています`,
        `${a} ${na}か所 ／ ${b} ${nb}か所。どちらかに統一してください。`,
        `本文で「${a}」と「${b}」が混ざっています。多く使われている「${na >= nb ? a : b}」の方にすべて統一してください。ほかの箇所は変更しないでください。`);
    }
  });

  // 共感表現「〜ですよね」は、ひとつの見出しの中で1回まで
  text.split(/^##\s+/m).forEach((sec, i) => {
    const n = (sec.match(/(です|ます)よね/g) || []).length;
    if (n >= 2) {
      const head = i === 0 ? '記事の冒頭' : (sec.split('\n')[0] || '').trim().slice(0, 24);
      add('warn', `「〜ですよね」が${n}回あります（${head}）`,
        '共感の表現は、ひとつの見出しの中で1回までにしてください。続くとくだけた印象になります。',
        `「${head}」の中に「〜ですよね」が${n}回あります。最初の1回だけ残し、あとは「〜です」「〜ます」などの言い切りに書き換えてください。ほかの箇所は変更しないでください。`);
    }
  });

  // 体験の段落に、期間・回数・具体的な出来事が入っているか
  const expParas = text.split(/\n\s*\n/).filter(
    (p) => !/^[|>#]/.test(p.trim()) && EXP_WORDS.some((w) => p.includes(w)));
  expParas.forEach((p) => {
    const hasNumber = /[0-9０-９]+\s*(年|か月|ヶ月|カ月|週間?|日|回|分|時間|度)/.test(p);
    if (!hasNumber) {
      add('warn', '体験の記述に期間や回数が入っていません',
        `「${p.trim().slice(0, 28)}…」`
        + ' — どのくらい使っているか、何回あったかを入れると、調べただけでは書けない段落になります。',
        '', { step: 4, find: p.trim().slice(0, 24) });
    }
  });

  // 健康カテゴリの誘導
  const healthish = /健康|食事|牧草|ペレット|病気|うっ滞|ソアホック|不正咬合/.test(text);
  if (healthish && !/動物病院で相談/.test(text)) {
    add('warn', '動物病院への誘導がありません',
      '「気になる症状があるときは、自己判断せず動物病院で相談しましょう。」を該当箇所に入れてください。',
      '健康や体調に触れているセクションの末尾に「気になる症状があるときは、自己判断せず動物病院で相談しましょう。」という1文を入れてください。ほかの箇所は変更しないでください。');
  }

  // 内部リンク
  if (!/関連記事|あわせてチェック|\]\(\//.test(text)) {
    add('warn', '内部リンクが見当たりません', '関連記事へのリンクを1本以上置いてください。');
  }

  // 構成
  const h2 = (text.match(/^##\s+/gm) || []).length;
  if (h2 < 4) add('warn', `見出し（h2）が${h2}個しかありません`, 'テンプレートでは6〜8個が目安です。');

  // まとめの締め
  if (!/ぜひこの記事を参考にして/.test(text)) {
    add('info', 'まとめの定型文が見当たりません',
      '「ぜひこの記事を参考にして、〜見つけてみてください。」で締める形に揃えています。');
  }

  // 商品数と、登録した商品／本文に書かれた商品の突き合わせ
  if (project && project.products) {
    const products = project.products;
    const n = products.length;
    if (n && (n < 5 || n > 7)) add('info', `登録した商品が${n}点です`, '5〜7点に収めるルールです。');

    // 「おすすめ○選」の見出しから、次の h2 の手前までにある h3 を商品ブロックとみなす
    const after = text.split(/^##\s+.*おすすめ.*選/m)[1] || '';
    const sec = after.split(/^##\s+/m)[0] || '';
    const blocks = (sec.match(/^###\s+(?!【)/gm) || []).length;
    if (n && blocks && blocks !== n) {
      add('error', `本文の商品数（${blocks}点）と、登録した商品（${n}点）が合いません`,
        'どちらかが古い可能性があります。商品を選び直すか、本文を確認してください。');
    }

    // タイトルの「○選」とも突き合わせる
    const m = (project.title || '').match(/([0-9０-９]+)\s*選/);
    if (m) {
      const declared = Number(m[1].replace(/[０-９]/g, (c) => '０１２３４５６７８９'.indexOf(c)));
      if (n && declared !== n) {
        add('error', `タイトルは「${declared}選」ですが、登録した商品は${n}点です`,
          'タイトルか商品リストのどちらかを直してください。');
      }
    }

    // 登録した商品が本文に出てくるか
    // 記事では「見出し＝商品名／次の行＝ブランド名」と分かれるため、
    // 商品名の中でいちばん長い語（型番を含む部分）で照合する
    const flat = text.replace(/\s+/g, '');
    const missing = products.filter((pd) => !nameAppears(pd.name, flat));
    if (missing.length) {
      add('warn', `登録した商品${missing.length}点が本文に見当たりません`,
        missing.map((x) => x.name).join(' / '));
    }
  }

  if (!out.some((o) => o.level === 'error')) {
    add('ok', '重大な問題は見つかりませんでした', '最終確認のうえ投稿してください。');
  }
  return out;
}


module.exports = { runChecks, BANNED, WORDING, MIXED };
