/* 部署官网到 GitHub Pages: 把 docs/ 的内容原样推到 gh-pages 分支根上。
   Pages 源已配成 gh-pages/(根), 与账号里其他站点一致(osome.work/<仓库名>/ 可达)。
   用法: node tools/pages.js            (推送后 GitHub 自动构建, 约 30 秒) */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const 根 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 跑 = cmd => execSync(cmd, { cwd: 根, stdio: 'inherit' });

function 拷入(源, 去) {
  mkdirSync(去, { recursive: true });
  for (const f of readdirSync(源)) {
    const s = join(源, f), d = join(去, f);
    statSync(s).isDirectory() ? 拷入(s, d) : writeFileSync(d, readFileSync(s));
  }
}

const 暂 = join(根, '.pages-tmp');
if (existsSync(暂)) rmSync(暂, { recursive: true, force: true });
mkdirSync(暂, { recursive: true });
// 孤儿分支: 只放站点文件(和 gh-pages 分支现状一致), 不带源码历史
跑('git worktree add --detach ' + 暂);
跑('git --git-dir=' + join(根, '.git') + ' --work-tree=' + 暂 + ' checkout --orphan gh-pages');
rmSync(join(暂, '.git'), { recursive: true, force: true });
readdirSync(暂).forEach(f => rmSync(join(暂, f), { recursive: true, force: true }));
拷入(join(根, 'docs'), 暂);
跑('git --git-dir=' + join(根, '.git') + ' --work-tree=' + 暂 + ' add -A');
const 有变 = execSync('git --git-dir=' + join(根, '.git') + ' --work-tree=' + 暂 + ' status --short',
  { cwd: 根 }).toString().trim();
if (有变) {
  跑('git --git-dir=' + join(根, '.git') + ' --work-tree=' + 暂 +
    ' -c user.name=pages -c user.email=pages@local commit -m "官网: docs/ 同步到 gh-pages"');
  跑('git push origin gh-pages --force');
  console.log('✓ 已推送 gh-pages, GitHub 约 30 秒后上线');
} else {
  console.log('· 站点无变化, 不用推');
}
跑('git worktree remove --force ' + 暂);
rmSync(暂, { recursive: true, force: true });
