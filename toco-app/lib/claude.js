// Claude Code の呼び出し
// （server.js から切り出したものです。処理内容は変えていません）

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const APP = path.join(__dirname, "..");

// ---------- Claude Code の呼び出し ----------
// ボタンを押したときだけ実行します。定期実行や自動連続実行はしません。
// ANTHROPIC_API_KEY を子プロセスから外し、必ずサブスクリプション側で動かします。

const PROJECT_ROOT = path.join(APP, '..');
const JOBS = {}; // { id: {status, output, error, startedAt, child} }

function styleGuide() {
  try {
    return fs.readFileSync(path.join(PROJECT_ROOT, 'CLAUDE.md'), 'utf8');
  } catch (e) {
    return '（スタイルガイドが見つかりませんでした）';
  }
}

// 体験の段落など、AIに書き換えさせない部分を拾う
function protectedBlocks(text) {
  const out = [];
  (text.match(/^>.*(?:\n>.*)*/gm) || []).forEach((b) => out.push(b));
  (text.match(/【[^】]{4,}】/g) || []).forEach((b) => out.push(b));
  return out;
}

const GUARD = [
  '【絶対に守ること】',
  '- 作業は「ファイルを編集して保存する」ことです。記事本文を画面に出力してはいけません。',
  '- 引用ブロック（行頭が > の部分）は、体験を書くための場所です。一字も変えずそのまま残してください。',
  '- 【ここに体験を書く】【立場を示す1文をここに…】のような角括弧の指示文も、消さずにそのまま残してください。',
  '- 実際に使っていない商品には、体験や使用感を書かないでください（景品表示法のステルスマーケティング規制）。',
  '- 記事を短くしないでください。指示された箇所以外は一字も変えないでください。',
].join('\n');

// 作業用ファイルの置き場所（Claude Code にここを読み書きさせる）
const WORK_DIR = path.join(PROJECT_ROOT, 'articles', 'work');

function workPaths(project) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  return {
    article: path.join(WORK_DIR, `${project.id}.md`),
    brief: path.join(WORK_DIR, `${project.id}-brief.md`),
    rel: (p) => path.relative(PROJECT_ROOT, p),
  };
}

// 記事が長いと「全文を出力してください」では出力上限で切れてしまうため、
// ファイルを直接読み書きさせる方式にしています。
function buildPrompt(mode, project, instruction, brief, body) {
  const w = workPaths(project);
  fs.writeFileSync(w.article, body || '', 'utf8');
  if (mode === 'write') fs.writeFileSync(w.brief, brief, 'utf8');

  const head = [
    'あなたはうさぎ専門メディア「tocoとくらし」の記事を担当します。',
    '次のスタイルガイドに必ず従ってください。',
    '',
    '===== スタイルガイド（CLAUDE.md） =====',
    styleGuide(),
    '===== ここまで =====',
    '',
    GUARD,
    '',
  ].join('\n');

  if (mode === 'write') {
    return head + [
      '【依頼】',
      `1. ${w.rel(w.brief)} を読んでください。記事の材料です。`,
      `2. スタイルガイドに沿って記事本文（Markdown）を書き、${w.rel(w.article)} に保存してください。`,
      '3. 保存できたら「保存しました」とだけ答えてください。記事本文を画面に出力する必要はありません。',
      '',
      `※ ${w.rel(w.article)} 以外のファイルは変更しないでください。`,
    ].join('\n');
  }

  return head + [
    '【依頼】',
    `1. ${w.rel(w.article)} を読んでください。いまの記事です。`,
    '2. 次の指示どおりに直して、同じファイルに保存してください。',
    '3. 保存できたら「保存しました」とだけ答えてください。記事本文を画面に出力する必要はありません。',
    '',
    '--- 指示 ---',
    instruction,
    '------------',
    '',
    '※ 指示に関係のない箇所は、一字も変更しないでください。',
    `※ ${w.rel(w.article)} 以外のファイルは変更しないでください。`,
  ].join('\n');
}

// よくある失敗を、何をすればいいか分かる日本語にする
function explainError(raw, code) {
  const t = raw || '';
  if (/authentication_error|OAuth access token is invalid|Invalid API key|401/.test(t)) {
    return [
      '■ Claude Code にログインできていません',
      '',
      'ターミナル（アプリケーション → ユーティリティ → ターミナル）を開いて、',
      '次のように打ってください。',
      '',
      '    claude',
      '',
      '起動したら /login と打ってログインします。',
      'ブラウザが開くので、いつものアカウントで許可すれば完了です。',
      '終わったら Control + C で抜けて、このアプリでもう一度お試しください。',
      '',
      'それでも直らないときは、いったん最新版に更新してみてください。',
      '',
      '    npm install -g @anthropic-ai/claude-code',
      '',
      '--- 元のメッセージ ---',
      t.slice(0, 500),
    ].join('\n');
  }
  if (/rate.?limit|usage limit|too many requests|429/i.test(t)) {
    return [
      '■ 使用量の上限に達しています',
      '',
      'しばらく時間をおくと再開できます。5時間ごとに枠が戻ります。',
      '',
      '--- 元のメッセージ ---',
      t.slice(0, 500),
    ].join('\n');
  }
  if (/ENOENT|command not found/.test(t)) {
    return [
      '■ claude コマンドが見つかりません',
      '',
      'Claude Code がインストールされていないか、場所が変わった可能性があります。',
      'ターミナルで claude --version が動くか確認してください。',
    ].join('\n');
  }
  if (!t) return `終了コード ${code}。出力がありませんでした。`;
  return t.slice(0, 1500);
}

function startClaude(jobId, prompt, model, opts) {
  const env = Object.assign({}, process.env);
  // 入れ子起動を避ける／必ずサブスクリプションを使う
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.ANTHROPIC_API_KEY;

  const job = JOBS[jobId] = {
    status: 'running', output: '', error: '', startedAt: Date.now(),
    workFile: (opts && opts.workFile) || null,
    baseText: (opts && opts.baseText) || '',
    baseLength: (opts && opts.baseLength) || 0,
    protectedBefore: (opts && opts.protectedBefore) || [],
  };
  let child;
  try {
    // モデルは明示する。古い CLI は既に無いモデルを既定にしていることがあるため。
    const args = ['-p', prompt, '--output-format', 'text',
      // 作業用ファイルの読み書きだけ許可する（複数箇所を直すときは MultiEdit を使う）
      '--allowedTools', 'Read,Write,Edit,MultiEdit'];
    if (model) args.push('--model', model);
    child = spawn('claude', args, {
      cwd: PROJECT_ROOT, env,
      // stdin は開けたままにすると入力待ちで止まるので閉じる
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    job.status = 'error';
    job.error = 'claude コマンドを起動できませんでした：' + e.message;
    return;
  }
  job.child = child;

  child.stdout.on('data', (d) => (job.output += d.toString()));
  child.stderr.on('data', (d) => (job.error += d.toString()));
  child.on('error', (e) => {
    job.status = 'error';
    job.error = (job.error + '\n' + e.message).trim();
  });
  child.on('close', (code) => {
    if (job.status === 'canceled') return;

    if (code !== 0) {
      job.status = 'error';
      const raw = [job.error, job.output].filter((s) => s && s.trim()).join('\n').trim();
      job.error = explainError(raw, code);
      return;
    }

    // 結果はファイルから読み戻す（標準出力は出力上限で切れることがあるため）
    let text = '';
    try {
      text = fs.readFileSync(job.workFile, 'utf8');
    } catch (e) {
      job.status = 'error';
      job.error = '記事ファイルを読み込めませんでした：' + e.message;
      return;
    }

    const warnings = [];
    // ファイルが1文字も変わっていない＝AIが編集しなかった
    if (job.baseText && text === job.baseText) {
      job.status = 'error';
      job.error = [
        '■ 記事が変更されませんでした',
        '',
        'Claude Code は動きましたが、ファイルを書き換えませんでした。',
        '指示が伝わらなかった可能性があります。',
        '',
        '・指示をもう少し具体的に書いて、もう一度試してください',
        '・「〜を〜に書き換えてください」のように、対象と結果をはっきり書くと通りやすくなります',
        '',
        '--- Claude Code の返事 ---',
        (job.output || '（返事なし）').trim().slice(0, 600),
      ].join('\n');
      return;
    }
    if (!text.trim()) {
      job.status = 'error';
      job.error = '記事が空のままでした。指示を変えて試してみてください。';
      return;
    }
    // 途中で切れていないかを見る
    if (job.baseLength && text.length < job.baseLength * 0.8) {
      warnings.push(`本文が ${job.baseLength} 字から ${text.length} 字に減っています。`
        + '途中で切れている可能性があるので、反映する前に末尾まで確認してください。');
    }
    // 体験の段落が消えていないかを、中身を見て確かめる
    const flat = text.replace(/\s+/g, '');
    const lost = (job.protectedBefore || []).filter(
      (b) => !flat.includes(b.replace(/\s+/g, '')));
    if (lost.length) {
      warnings.push(`体験の段落など、変更しないはずの箇所が ${lost.length} か所 失われています。`);
    }
    job.status = 'done';
    job.article = text;
    job.warnings = warnings;
  });

  // 20分で打ち切り
  setTimeout(() => {
    if (job.status === 'running') {
      job.status = 'error';
      job.error = '20分たっても終わりませんでした。指示を短くして試してみてください。';
      try { child.kill(); } catch (e) {}
    }
  }, 20 * 60 * 1000);
}


module.exports = { JOBS, startClaude, protectedBlocks, styleGuide, workPaths, buildPrompt, explainError, WORK_DIR, PROJECT_ROOT };
