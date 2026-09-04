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

// 報告書のように見える言い回し。ペットショップの店員の話し方から遠ざかります。
const REPORTY = [
  ['報告', '「〜ということもあるようです」「〜という声もあります」'],
  ['投稿', '「〜という方もいます」「〜ということも起こります」'],
  ['という報告', '「〜ということもあるようです」「〜という声もあります」'],
  ['との報告', '「〜という声が目立ちます」'],
  ['報告があ', '「〜という声があります」'],
  ['指摘があ', '「〜が気になるという方もいます」'],
  ['事例が', '「〜ということが起こります」'],
  ['傾向として', '「〜が多いです」'],
  ['ユーザーは', '「使っている方は」'],
  ['ユーザーが', '「使っている方が」'],
  ['見受けられ', '「〜が多いです」'],
  ['散見され', '「〜という声もあります」'],
];

// 商品ブロック以外では使わない語（情報源の明示が要るのは商品ブロックだけ）
const SOURCE_WORDS = ['口コミ', 'レビュー', 'クチコミ'];

// 本文を「商品ブロック」とそれ以外に分ける。
// 「おすすめ○選」の h2 から、次の h2 までを商品ブロックとみなします。
function splitByProductSection(text) {
  const lines = String(text).split('\n');
  const inside = [];
  const outside = [];
  let inProduct = false;
  lines.forEach((line, i) => {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) inProduct = /おすすめ.*選/.test(h2[1]);
    (inProduct ? inside : outside).push({ line, no: i + 1 });
  });
  return { inside, outside };
}

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
// 楽天の商品名は宣伝文句だらけで、記事では短く書き直されます。
//   登録名：RENEWAL 歴代名馬も愛した チモシー1番刈り 2番刈り 王様チモシー / 魔法の様な…
//   本文  ：王様チモシー 1番刈り・2番刈り
// そのため「長い語が含まれるか」では判定できません。
// 商品名から宣伝文句を落としたうえで、隣り合う2文字の集合がどれだけ本文に含まれるかで見ます。
const NAME_NOISE = /送料無料|送料込|あす楽|即納|在庫あり|新品|正規品|ポイント|倍|最大|セール|期間限定|クーポン|限定|数量限定|まとめ買い|お買い得|人気|おすすめ|楽天|ランキング|入賞|新刈り|年度産|令和\d*年?産?|\d+%オフ|パスプレ|袋付/g;

function nameKey(name) {
  return String(name || '')
    .replace(/[【】\[\]（）()《》]/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/[\s　・,、/／|｜×xX+＋]/g, '')
    .toLowerCase();
}

function bigrams(t) {
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

function nameAppears(name, flatText) {
  const key = nameKey(name);
  if (key.length < 4) return true;
  if (flatText.includes(key)) return true;
  // 商品名の2文字並びが、本文にどれだけ出てくるか
  const g = bigrams(key);
  if (!g.size) return true;
  let hit = 0;
  g.forEach((x) => { if (flatText.includes(x)) hit++; });
  return hit / g.size >= 0.8;
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

  // 報告書のような言い回し
  // 「という報告」と「報告」のように重なる語があるので、長いほうから数えて二重計上を防ぎます。
  {
    let rest = String(text);
    REPORTY.slice().sort((a, b) => b[0].length - a[0].length).forEach(([word, better]) => {
      const n = (rest.match(new RegExp(word, 'g')) || []).length;
      if (!n) return;
      rest = rest.split(word).join('');
      add('warn', `報告書のような言い回し「${word}」（${n}か所）`,
        `ペットショップの店員が話しているような文章にします。${better} のように書き換えてください。`,
        `本文の「${word}」を含む文を、${better} のような話し言葉に書き換えてください。`
        + '意味は変えず、同じ言い換えを繰り返さないでください。ほかの箇所は変更しないでください。');
    });
  }

  // カギ括弧は商品ブロックの中だけ
  {
    const { outside } = splitByProductSection(text);
    const prose = [];
    let structural = 0;
    outside.forEach(({ line }) => {
      const t = line.trim();
      if (!t || !/[「」]/.test(t)) return;
      // 見出し・表・引用は文章ではないので分けて数えます
      if (/^[#>|]/.test(t)) { structural += (t.match(/「/g) || []).length; return; }
      (t.match(/「[^」]{1,40}」/g) || []).forEach((q) => prose.push(q));
    });

    // カギ括弧には2種類あります。
    //   ・声の引用   「最初からMにしておけばよかった」← 直したい
    //   ・語の強調   「幅」「新刈り」「どんな子に合うか」← 残してよい
    // 文の形をしていて、末尾が「か」でないものを引用とみなします。
    const quotes = prose.filter((q) => {
      const inner = q.slice(1, -1);
      return inner.length >= 6 && !/か$/.test(inner);
    });
    const terms = prose.length - quotes.length;

    if (quotes.length) {
      add('warn', `商品ブロック以外に声の引用があります（${quotes.length}か所${terms ? `／語の強調は ${terms}か所で対象外` : ''}）`,
        '読者の声をカギ括弧で引くと、資料を読み上げている調子になります。地の文で書いてください。'
        + `　例：${quotes.slice(0, 3).join(' ')}`,
        '「おすすめ○選」の商品ブロック以外にあるカギ括弧「」を外し、地の文に直してください。'
        + '例：「最初からMにしておけばよかった」という声が多いです → '
        + '最初から大きいほうにしておけばよかった、という方が多いですよ。'
        + '「幅」「新刈り」のような短い語の強調と、見出し・表の中のカギ括弧は、そのままにしてください。');
    }
  }

  // 文末が同じ形で続いていないか
  {
    const paras = String(text).split(/\n\s*\n/);
    const runs = [];
    paras.forEach((para) => {
      const t = para.trim();
      if (!t || /^[#>|\-*!]/.test(t) || /^\{\{/.test(t)) return;
      const ends = t.split(/。/).map((x) => x.trim()).filter(Boolean)
        .map((x) => (x.match(/(です|ます|ました|ません|でしょう)$/) || [''])[0]).filter(Boolean);
      let run = 1;
      for (let i = 1; i < ends.length; i++) {
        if (ends[i] === ends[i - 1]) { run++; } else { run = 1; }
        if (run >= 3) { runs.push({ end: ends[i], para: t.slice(0, 46) }); break; }
      }
    });
    if (runs.length) {
      add('warn', `同じ文末が3回以上続いています（${runs.length}か所）`,
        `「〜${runs[0].end}。」が並ぶと単調に読めます。2回続いたら3回目で形を変えてください。`
        + '「〜ですよ」「〜ますね」「体言止め」などが使えます。'
        + `　例：${runs[0].para}…`,
        '本文で同じ文末（です／ます）が3回以上続いている段落を探し、'
        + '3文目の語尾を「〜ですよ」「〜ますね」「体言止め」などに変えてください。'
        + '意味は変えず、1段落につき1か所だけ変えてください。ほかの箇所は変更しないでください。');
    }
  }

  if (false) REPORTY.forEach(([word, better]) => {
    const n = 0;
    if (!n) return;
    add('warn', `報告書のような言い回し「${word}」（${n}か所）`,
      `ペットショップの店員が話しているような文章にします。${better} のように書き換えてください。`,
      `本文の「${word}」を含む文を、${better} のような話し言葉に書き換えてください。`
      + '意味は変えず、同じ言い換えを繰り返さないでください。ほかの箇所は変更しないでください。');
  });

  // 本文中の太字（行まるごとの ** は構造として使うので対象外）
  {
    const inlineBold = [];
    String(text).split('\n').forEach((line) => {
      const t = line.trim();
      if (!t || /^\*\*[^*]+\*\*$/.test(t)) return;   // 結論の1文・ブランド名・キャッチ
      const m = t.match(/\*\*[^*\n]+\*\*/g);
      if (m) inlineBold.push(...m);
    });
    if (inlineBold.length) {
      add('warn', `本文中に太字があります（${inlineBold.length}か所）`,
        '本文の強調は、太字ではなくマーカー（==テキスト==）を使う方針です。'
        + `　例：${inlineBold.slice(0, 3).join(' / ')}`
        + '　公開前チェックの「本文の太字をすべてマーカーに」で一括変換できます。',
        '本文の途中にある **強調** を、==強調== の形（マーカー）に書き換えてください。'
        + 'ただし、行まるごとが **…** になっているもの（結論の1文・ブランド名・キャッチ）は変更しないでください。');
    }
  }

  // 商品ブロックのメーカー名（商品カードと重複するので不要）
  {
    const lines = String(text).split('\n');
    let inProd = false; let hit = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      const h2 = t.match(/^##\s+(.+)$/);
      if (h2) { inProd = /おすすめ.*選/.test(h2[1]); continue; }
      if (!inProd || !/^###\s/.test(t)) continue;
      let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
      let k = j + 1; while (k < lines.length && !lines[k].trim()) k++;
      if (j < lines.length && /^\*\*[^*]+\*\*$/.test(lines[j].trim())
        && k < lines.length && /^\{\{product:/.test(lines[k].trim())) hit++;
    }
    if (hit) {
      add('warn', `商品ブロックにメーカー名の行があります（${hit}か所）`,
        'メーカー名は商品カードに出るので、本文に書くと二重になります。',
        '「おすすめ○選」の各商品ブロックで、見出しの直後にありカードの記法の直前にある'
        + '太字1行（メーカー名）を、空行ごと削除してください。ほかの箇所は変更しないでください。');
    }
  }

  // 「口コミ」「レビュー」は商品ブロックの中だけ
  {
    const { outside } = splitByProductSection(text);
    const hits = [];
    outside.forEach(({ line, no }) => {
      const t = line.trim();
      // 見出しと、出典を断る引用ブロックは対象外。
      // 「この記事で紹介している口コミは〜」の注記はスタイルガイドで必須のため。
      if (/^#/.test(t) || /^>/.test(t)) return;
      SOURCE_WORDS.forEach((w) => {
        if (t.includes(w)) hits.push({ w, no, line: t });
      });
    });
    if (hits.length) {
      add('warn', `商品ブロック以外に「口コミ」が出ています（${hits.length}か所）`,
        '情報源を明示するのは商品ブロックだけにします。ほかの本文では「〜という声」にとどめてください。'
        + `　例：${hits[0].line.slice(0, 40)}`,
        'つぎの方針で書き換えてください。「おすすめ○選」の各商品ブロックの中では「口コミでは〜」のままでよい。'
        + 'それ以外の本文（導入・選び方・よくある質問・まとめ）にある「口コミ」「レビュー」という語は、'
        + '「〜という声が多いです」のように言い換え、出典を名乗らない書き方にしてください。ほかの箇所は変更しないでください。',
        { step: 4, find: hits[0].line.slice(0, 30) });
    }
  }

  // 「声」の出しすぎ（セクションごとに数える）
  {
    const count = (t) => (t.match(/という声|との声|声が多い|声もあり/g) || []).length;
    const noisy = [];
    String(text).split(/^##\s+/m).slice(1).forEach((sec) => {
      const title = sec.split('\n')[0].trim();
      if (/おすすめ.*選/.test(title)) {
        // 商品ブロックは商品ごとに1つの塊なので、h3 単位で数えます
        sec.split(/^###\s+/m).slice(1).forEach((block) => {
          const name = block.split('\n')[0].trim();
          const n = count(block);
          if (n >= 3) noisy.push({ title: name, n });
        });
        return;
      }
      const n = count(sec);
      if (n >= 3) noisy.push({ title, n });
    });
    if (noisy.length) {
      add('warn', `「声」の話が続いています（${noisy.map((x) => x.title.slice(0, 14) + `：${x.n}回`).join(' / ')}）`,
        '同じセクションで3回以上続くと、報告書のような印象に戻ります。'
        + '声を根拠に置いたら、次の文は自分の言葉で言い切ってください。',
        `「${noisy[0].title}」のセクションで「〜という声」の形が${noisy[0].n}回出ています。`
        + '2回までに減らし、残りは「迷ったら大きいほうを選んでおくと安心です」のように、'
        + '自分の言葉で言い切る文に書き換えてください。ほかのセクションは変更しないでください。');
    }
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
    // 本文に {{product:xxx}} が書かれていれば、その商品は確実に載っています。
    // 商品マスタを引いて、登録した商品と結び付けます。
    let referenced = [];
    try {
      const master = require('./products.js').load();
      const ids = [...String(text).matchAll(/\{\{product:([A-Za-z0-9_-]+)\}\}/g)].map((m) => m[1]);
      referenced = ids.map((id) => master.find((x) => x.id === id)).filter(Boolean);
    } catch (e) { /* 商品マスタが無くても判定は続けます */ }

    const isReferenced = (pd) => referenced.some((r) =>
      (r.rakuten && pd.code && r.rakuten.itemCode === pd.code)
      || (r.rakuten && pd.url && r.rakuten.url && r.rakuten.url.split('?')[0] === String(pd.url).split('?')[0])
      || nameKey(r.name) === nameKey(pd.name));

    const missing = products.filter((pd) => !isReferenced(pd) && !nameAppears(pd.name, flat));
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
