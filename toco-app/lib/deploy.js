// サイトの公開（Git → GitHub → Cloudflare Pages）
//
// 公開の流れ
//   1. ビルド        toco-app/dist/ にサイト一式を書き出す
//   2. コミット      変更を Git に記録する（間違えても戻せるようにするため）
//   3. プッシュ      GitHub に送る
//   4. 自動デプロイ  Cloudflare Pages が push を検知して公開する（1〜2分）
//
// このファイルは 1〜3 までを担当します。4はCloudflare側の仕事です。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.join(__dirname, '..');
const REPO = path.join(APP, '..');

// 送信時のオプション。
// 古いgitとHTTP/2の組み合わせで "RPC failed; HTTP 400" が出ることがあるため、
// HTTP/1.1 を明示し、送信バッファを大きくしています。
const HTTP_OPTS = [
  '-c', 'http.version=HTTP/1.1',
  '-c', 'http.postBuffer=524288000',
  '-c', 'http.lowSpeedLimit=0',
  '-c', 'http.lowSpeedTime=999',
];

function git(args, opts) {
  return execFileSync('git', args, {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: (opts && opts.timeout) || 120000,
  }).trim();
}

function tryGit(args, opts) {
  try { return { ok: true, out: git(args, opts) }; }
  catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString().trim();
    return { ok: false, out: msg };
  }
}

// いま公開できる状態かどうかを調べる
function state() {
  const isRepo = tryGit(['rev-parse', '--is-inside-work-tree']).ok;
  if (!isRepo) {
    return { isRepo: false, hasRemote: false, ready: false,
      reason: 'まだGitリポジトリになっていません。「公開の準備」から設定してください。' };
  }

  // 最初のコミット前は rev-parse HEAD が失敗するので、branch --show-current を使います
  const branch = tryGit(['branch', '--show-current']).out || 'main';
  const remote = tryGit(['remote', 'get-url', 'origin']);
  const status = tryGit(['status', '--porcelain']).out;
  const changed = status ? status.split('\n').filter(Boolean) : [];

  let ahead = 0;
  const cnt = tryGit(['rev-list', '--count', `origin/${branch}..HEAD`]);
  if (cnt.ok) ahead = Number(cnt.out) || 0;

  const last = tryGit(['log', '-1', '--format=%h|%ad|%s', '--date=format:%Y-%m-%d %H:%M']);
  let lastCommit = null;
  if (last.ok && last.out) {
    const [hash, date, subject] = last.out.split('|');
    lastCommit = { hash, date, subject };
  }

  const ignored = fs.existsSync(path.join(REPO, '.gitignore'))
    ? fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8') : '';
  const dataIgnored = /(^|\n)\s*toco-app\/data\/?\s*(\n|$)/.test(ignored)
    || /(^|\n)\s*data\/?\s*(\n|$)/.test(ignored);

  return {
    isRepo: true,
    hasRemote: remote.ok,
    remote: remote.ok ? remote.out : '',
    branch,
    changedCount: changed.length,
    changed: changed.slice(0, 40),
    ahead,
    lastCommit,
    dataIgnored,
    ready: remote.ok && dataIgnored,
    reason: !remote.ok ? 'GitHubのリポジトリ（origin）が設定されていません。'
      : !dataIgnored ? 'data/ が .gitignore に入っていません。APIの鍵が公開されるおそれがあります。'
      : '',
  };
}

const GITIGNORE = `# APIの鍵が入っているので、絶対に公開しないこと
toco-app/data/

# 作業用
toco-app/dist/.DS_Store
.DS_Store
node_modules/
articles/work/
`;

// リポジトリの下ごしらえ。.gitignore を置いて git init まで行います。
// GitHubへの接続（remote add）は、URLを受け取ってから行います。
function setup(remoteUrl) {
  const log = [];
  const gi = path.join(REPO, '.gitignore');
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, GITIGNORE);
    log.push('.gitignore を作成しました（data/ を除外）');
  } else if (!/toco-app\/data/.test(fs.readFileSync(gi, 'utf8'))) {
    fs.appendFileSync(gi, '\n' + GITIGNORE);
    log.push('.gitignore に data/ の除外を追記しました');
  } else {
    log.push('.gitignore は設定済みです');
  }

  if (!tryGit(['rev-parse', '--is-inside-work-tree']).ok) {
    const r = tryGit(['init', '-b', 'main']);
    if (!r.ok) throw new Error('git init に失敗しました：' + r.out);
    log.push('Gitリポジトリを作成しました（ブランチ main）');
  } else {
    log.push('Gitリポジトリは作成済みです');
  }

  if (remoteUrl) {
    const cur = tryGit(['remote', 'get-url', 'origin']);
    if (cur.ok && cur.out !== remoteUrl) {
      tryGit(['remote', 'set-url', 'origin', remoteUrl]);
      log.push('GitHubの接続先を更新しました');
    } else if (!cur.ok) {
      const r = tryGit(['remote', 'add', 'origin', remoteUrl]);
      if (!r.ok) throw new Error('remote add に失敗しました：' + r.out);
      log.push('GitHubに接続しました：' + remoteUrl);
    } else {
      log.push('GitHubの接続は設定済みです');
    }
  }

  return { log, state: state() };
}

// 変更を記録して GitHub に送る
function push(message) {
  const s = state();
  if (!s.isRepo) throw new Error('Gitリポジトリになっていません');
  if (!s.dataIgnored) throw new Error('data/ が .gitignore に入っていません。鍵が公開されるおそれがあるため中止しました');

  const log = [];
  const add = tryGit(['add', '-A']);
  if (!add.ok) throw new Error('git add に失敗しました：' + add.out);

  const staged = tryGit(['diff', '--cached', '--name-only']).out;
  if (staged) {
    const c = tryGit(['commit', '-m', message || '記事を更新']);
    if (!c.ok) throw new Error('コミットに失敗しました：' + c.out);
    log.push(`${staged.split('\n').filter(Boolean).length}件の変更を記録しました`);
  } else {
    log.push('新しい変更はありませんでした');
  }

  if (!s.hasRemote) {
    log.push('GitHubが未設定のため、送信は行いませんでした（手元には記録済みです）');
    return { log, pushed: false, state: state() };
  }

  const branch = tryGit(['branch', '--show-current']).out || 'main';
  let r = tryGit(HTTP_OPTS.concat(['push', '-u', 'origin', branch]), { timeout: 600000 });

  // 一度で送れないときは、コミットを1つずつ送り直します。
  // 大きなpushが途中で切れる回線でも、小分けなら通ることがあります。
  if (!r.ok && /HTTP 400|RPC failed|hung up|early EOF/i.test(r.out)) {
    log.push('一度で送れなかったため、小分けにして送り直します…');
    const commits = tryGit(['rev-list', '--reverse', branch]).out.split('\n').filter(Boolean);
    let sent = false;
    for (const c of commits) {
      const ref = c + ':refs/heads/' + branch;
      const step = tryGit(HTTP_OPTS.concat(['push', '-u', 'origin', ref]), { timeout: 600000 });
      if (!step.ok) { r = step; sent = false; break; }
      sent = true;
    }
    if (sent) r = { ok: true, out: '' };
  }
  if (!r.ok) throw new Error(explainPushError(r.out));

  log.push('GitHubに送信しました');
  log.push('Cloudflare Pages が自動でデプロイします（1〜2分で反映）');
  return { log, pushed: true, state: state() };
}

// git のエラーを、何をすればいいか分かる日本語にする
function explainPushError(raw) {
  const t = String(raw);
  if (/Authentication failed|could not read Username|Permission denied|403/i.test(t)) {
    return 'GitHubの認証に失敗しました。ターミナルで一度 `git push` を実行して、'
      + 'ログイン（GitHub CLI か個人アクセストークン）を済ませてください。\n\n' + t;
  }
  if (/Could not resolve host|network|timed out/i.test(t)) {
    return 'GitHubに接続できませんでした。ネットワークを確認して、もう一度お試しください。\n\n' + t;
  }
  if (/HTTP 400|RPC failed|hung up|early EOF/i.test(t)) {
    return 'GitHubへの送信が途中で切れました。一度に送る量が多いときや、回線が不安定なときに起こります。\n'
      + 'もう一度「サイトに反映する」を押すと、続きから送れることがあります。\n'
      + '繰り返し失敗する場合は、SSH接続に切り替えると安定します。\n\n' + t;
  }
  if (/rejected|non-fast-forward|fetch first/i.test(t)) {
    return 'GitHub側に、手元にない変更があります。ターミナルで `git pull --rebase` を実行してから、'
      + 'もう一度公開してください。\n\n' + t;
  }
  return '送信に失敗しました。\n\n' + t;
}

function history(n) {
  const r = tryGit(['log', `-${n || 10}`, '--format=%h|%ad|%s', '--date=format:%Y-%m-%d %H:%M']);
  if (!r.ok || !r.out) return [];
  return r.out.split('\n').map((line) => {
    const [hash, date, subject] = line.split('|');
    return { hash, date, subject };
  });
}

module.exports = { state, setup, push, history, REPO };
