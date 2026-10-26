/* 部署官网到 GitHub Pages: 把 docs/ 原样推到远端的 gh-pages 分支。
   Pages 源配成 gh-pages/(根), 与账号里其他站点一致(osome.work/<仓库名>/ 可达)。
   用法: node tools/pages.js            (推送后 GitHub 自动构建, 约 30 秒上线) */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const 根 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 跑 = (cmd, cwd) => execSync(cmd, { cwd: cwd || 根, stdio: 'inherit' });
const 暂 = join(根, '.pages-tmp');

try {
  rmSync(暂, { recursive: true, force: true });
  // 1. 开一个临时工作区(挂在 main 上), 在里面切一个孤儿分支
  try { 跑('git branch -D pages-deploy'); } catch (_) { }   // 上次失败可能留了本地分支
  跑(`git worktree add --detach ${暂}`);
  跑('git checkout --orphan pages-deploy', 暂);
  跑('git rm -rf . --quiet', 暂);
  // 2. docs/ 的内容原样进根(一个字节不改)
  cpSync(join(根, 'docs'), 暂, { recursive: true });
  const 文 = readdirSync(暂).filter(f => !f.startsWith('.git'));
  console.log('· 部署:', 文.join(', '));
  // 3. 提交并强推到远端的 gh-pages(本地不保留这个分支名, 免得和已存在的冲突)
  跑('git add -A', 暂);
  跑('git -c user.name=pages -c user.email=pages@local commit -q -m "官网: docs/ 同步到 gh-pages"', 暂);
  const 令 = process.env.GITHUB_TOKEN ? `GITHUB_TOKEN=${process.env.GITHUB_TOKEN} ` : '';
  if (process.env.GITHUB_TOKEN) {
    // 有 token: 临时用它推, 不写进任何配置文件
    const 原 = execSync('git remote get-url origin', { cwd: 根 }).toString().trim();
    const 带 = 原.replace(/^https:\/\//, `https://x-access-token:${process.env.GITHUB_TOKEN}@`);
    跑(`git push ${带} HEAD:gh-pages --force`, 暂);
    console.log('(用了 GITHUB_TOKEN, 没有写进 remote)');
  } else {
    跑('git push origin HEAD:gh-pages --force', 暂);
  }
  console.log('✓ 已推送 gh-pages — GitHub 约 30 秒后上线: https://osome.work/mycelium/');
} catch (e) {
  console.log('✗ 部署失败:', e.message);
  process.exitCode = 1;
} finally {
  try { 跑('git worktree remove --force ' + 暂); } catch (_) { rmSync(暂, { recursive: true, force: true }); }
  try { 跑('git branch -D pages-deploy'); } catch (_) { }   // 本地不留部署用的孤儿分支
}
