'use strict';
/* =====================================================================
 * Perlin 噪声纹理工坊 —— headless 自动化自测（不依赖浏览器）
 * 做法：从 index.html 抽出内联 <script>，
 *       1) node --check 语法检查；2) HTML 结构检查；
 *       3) 在 Node vm 中载入纯逻辑核心复算：确定性 / 周期无缝 /
 *          边缘连续 / 开关生效 / 边界健壮 / 灰度 / 配色 / 性能。
 * 运行：node test\test.js   （全绿退出码 0）
 * ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
const info = {};            // 供报告摘录的关键数字

function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  [PASS] ' + msg + (detail ? '  {' + detail + '}' : '')); }
  else { fail++; fails.push(msg + (detail ? '  {' + detail + '}' : '')); console.log('  [FAIL] ' + msg + (detail ? '  {' + detail + '}' : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------- 1. 脚本抽取与语法检查 ---------- */
section('1. 脚本抽取与语法检查');
const m = HTML.match(/<script>([\s\S]*)<\/script>/);
ok(!!m && m[1].length > 5000, '抽得内联脚本', (m ? m[1].length : 0) + ' 字符');
const tmp = path.join(__dirname, '.extracted-core.js');
fs.writeFileSync(tmp, m[1], 'utf8');
const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
ok(chk.status === 0, 'node --check 语法通过', chk.status === 0 ? 'exit 0' : String(chk.stderr).trim().split('\n')[0]);

/* ---------- 2. HTML 结构检查 ---------- */
section('2. HTML 结构检查');
for (const tag of ['html', 'head', 'body', 'style', 'script', 'canvas', 'main', 'aside', 'header', 'footer', 'section']) {
  const open = (HTML.match(new RegExp('<' + tag + '(\\s|>)', 'g')) || []).length;
  const close = (HTML.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  ok(open === close && open > 0, '<' + tag + '> 配对', open + ' 开 / ' + close + ' 闭');
}
const divOpen = (HTML.match(/<div[\s>]/g) || []).length;
const divClose = (HTML.match(/<\/div>/g) || []).length;
ok(divOpen === divClose && divOpen > 0, '<div> 配对', divOpen + ' 开 / ' + divClose + ' 闭');
ok(/id="view"/.test(HTML) && /id="freq"/.test(HTML) && /id="octaves"/.test(HTML) && /id="contrast"/.test(HTML)
   && /id="seed"/.test(HTML) && /id="size"/.test(HTML) && /id="seamless"/.test(HTML)
   && /id="regen"/.test(HTML) && /id="exportPng"/.test(HTML) && /id="exportGray"/.test(HTML)
   && /id="palettes"/.test(HTML) && /id="summary"/.test(HTML), '12 个关键控件齐全');
ok(!/https?:\/\//.test(HTML), '零外部网络引用（无 CDN）');
const totalLines = HTML.split('\n').length;
info.totalLines = totalLines;
ok(totalLines >= 600 && totalLines <= 900, '体量在 600~900 行目标区间', totalLines + ' 行');

/* ---------- 3. 载入纯逻辑核心（vm，无 DOM 环境） ---------- */
section('3. 载入纯逻辑核心（vm，无 DOM 环境）');
const ctx = vm.createContext({ console: console });
vm.runInContext(m[1], ctx, { filename: 'extracted-core.js' });
const Lab = ctx.PerlinLab;
ok(!!Lab && typeof Lab.fbmField === 'function' && typeof Lab.makePerlin === 'function',
   'globalThis.PerlinLab 暴露成功（UI 块在无 DOM 下被正确跳过）');

/* ---------- 4. 确定性 ---------- */
section('4. 确定性（同种子同参数逐位一致）');
const base = { seed: 20260829, freq: 4, octaves: 5, width: 128, seamless: true };
const f1 = Lab.fbmField(base);
const f2 = Lab.fbmField(base);
let bitSame = true, detMax = 0;
for (let i = 0; i < f1.length; i++) {
  const d = Math.abs(f1[i] - f2[i]);
  if (d > detMax) detMax = d;
  if (f1[i] !== f2[i]) bitSame = false;
}
ok(bitSame, '同种子两次生成逐位一致', 'max diff ' + detMax);
const f3 = Lab.fbmField(Object.assign({}, base, { seed: 20260830 }));
let diffPix = 0;
for (let i = 0; i < f1.length; i++) if (f1[i] !== f3[i]) diffPix++;
ok(diffPix > f1.length * 0.5, '换种子结果明显不同', '差异像素 ' + (100 * diffPix / f1.length).toFixed(1) + '%');
const pA = Lab.makePerm(42), pB = Lab.makePerm(42);
let permSame = pA.length === pB.length;
for (let i = 0; i < pA.length && permSame; i++) if (pA[i] !== pB[i]) permSame = false;
ok(permSame, '置换表同种子完全一致', pA.length + ' 项');
const pC = Lab.makePerm(43);
let permDiff = 0;
for (let i = 0; i < pA.length; i++) if (pA[i] !== pC[i]) permDiff++;
ok(permDiff > pA.length * 0.9, '置换表换种子明显不同', '差异 ' + (100 * permDiff / pA.length).toFixed(1) + '%');

/* ---------- 5. 无缝拼接：函数级周期性 ---------- */
section('5. 无缝拼接：noise(u) ≡ noise(u+周期)');
const noise2 = Lab.makePerlin(999);
function periodicMaxDiff(P) {
  let md = 0;
  for (let i = 0; i < 48; i++) {
    for (let j = 0; j < 48; j++) {
      const u = i / 48 * P, v = j / 48 * P;
      const a = noise2(u, v, P);
      const b = noise2(u + P, v, P);
      const c = noise2(u, v + P, P);
      const d = noise2(u + P, v + P, P);
      md = Math.max(md, Math.abs(a - b), Math.abs(a - c), Math.abs(a - d));
    }
  }
  return md;
}
for (const P of [1, 3, 8, 64, 2047]) {
  const md = periodicMaxDiff(P);
  ok(md < 1e-6, '周期 ' + P + ' 四向平移相等（含非 2 的幂周期）', 'max diff ' + md.toExponential(2));
}

/* ---------- 6. 图像级边缘连续与开关生效 ---------- */
section('6. 图像级边缘连续 / 开关生效');
function edgeMaxDiff(freq, octaves, width, seamless, seed) {
  const f = Lab.fbmField({ seed: seed, freq: freq, octaves: octaves, width: width, seamless: seamless });
  let md = 0;
  for (let y = 0; y < width; y++) {
    md = Math.max(md, Math.abs(f[y * width] - f[y * width + width - 1]));   // 首列 vs 末列
    md = Math.max(md, Math.abs(f[y] - f[(width - 1) * width + y]));         // 首行 vs 末行
  }
  return md;
}
info.adjSeam = edgeMaxDiff(2, 4, 256, true, 20260829);
ok(info.adjSeam < 0.02, '无缝：首末列/首末行相邻差 < 0.02（freq=2 oct=4）', 'max diff ' + info.adjSeam.toFixed(4));
info.adjPlain = edgeMaxDiff(2, 4, 256, false, 20260829);
ok(info.adjPlain > info.adjSeam * 3 && info.adjPlain > 0.05, '关闭无缝：边缘差显著增大（开关生效）',
   'plain ' + info.adjPlain.toFixed(4) + ' vs seamless ' + info.adjSeam.toFixed(4));
const sA = Lab.fbmField({ seed: 20260829, freq: 4, octaves: 5, width: 128, seamless: true });
const sB = Lab.fbmField({ seed: 20260829, freq: 4, octaves: 5, width: 128, seamless: false });
info.toggleMax = 0;
for (let i = 0; i < sA.length; i++) info.toggleMax = Math.max(info.toggleMax, Math.abs(sA[i] - sB[i]));
ok(info.toggleMax > 0.05, '开/关无缝渲染场在边缘带明显不同', 'max diff ' + info.toggleMax.toFixed(3));
info.adjHi = edgeMaxDiff(8, 8, 256, true, 20260829);
console.log('  [INFO] 高频参考：freq=8 oct=8 无缝首末列差 ' + info.adjHi.toFixed(4) + '（相邻像素差随频率线性增大，无缝判据以第 5 节周期性为准）');

/* ---------- 7. 边界与健壮性 ---------- */
section('7. 边界与健壮性（无 NaN/Infinity）');
const combos = [
  { seed: 1, freq: 1, octaves: 1, seamless: true },
  { seed: 1, freq: 16, octaves: 8, seamless: true },
  { seed: 123, freq: 16, octaves: 1, seamless: false },
  { seed: 123, freq: 1, octaves: 8, seamless: false },
  { seed: 4294967295, freq: 7, octaves: 8, seamless: true }
];
let allFinite = true;
for (const c of combos) {
  const f = Lab.fbmField(Object.assign({ width: 96 }, c));
  for (let i = 0; i < f.length; i++) if (!isFinite(f[i])) { allFinite = false; break; }
}
ok(allFinite, combos.length + ' 组边界参数组合全部有限值');
const mc = Lab.mapContrast(Lab.fbmField({ seed: 5, freq: 3, octaves: 3, width: 64, seamless: true }), 3);
let mcOk = true;
for (let i = 0; i < mc.length; i++) if (!isFinite(mc[i]) || mc[i] < 0 || mc[i] > 1) { mcOk = false; break; }
ok(mcOk, '对比度=3 重映射后仍在 [0,1] 区间');
ok(Lab.contrastValue(0.5, 0.5) === 0.5 && Lab.contrastValue(0.5, 3) === 0.5, '对比度中点不动点');
ok(Lab.contrastValue(0, 3) === 0 && Lab.contrastValue(1, 3) === 1, '对比度端点钳制不越界');
let mono = true, prev = -1;
for (let i = 0; i <= 100; i++) {
  const v = Lab.contrastValue(i / 100, 2.5);
  if (v < prev) mono = false;
  prev = v;
}
ok(mono, '对比度映射单调');

/* ---------- 8. 场统计（防退化渲染） ---------- */
section('8. 场统计');
const st = Lab.stretch01(Lab.fbmField({ seed: 20260829, freq: 4, octaves: 5, width: 128, seamless: true }));
let mean = 0;
for (let i = 0; i < st.length; i++) mean += st[i];
mean /= st.length;
let varSum = 0;
for (let i = 0; i < st.length; i++) { const d = st[i] - mean; varSum += d * d; }
const std = Math.sqrt(varSum / st.length);
info.mean = mean; info.std = std;
ok(mean > 0.4 && mean < 0.6, '归一化后均值居中', mean.toFixed(3));
ok(std > 0.08, '动态量充足（防全灰退化）', 'std ' + std.toFixed(3));

/* ---------- 9. 灰度与配色停靠点 ---------- */
section('9. 灰度与配色');
let grayOk = true;
for (let v = -0.2; v <= 1.21; v += 0.01) {
  const rgb = Lab.samplePalette(Lab.PALETTES.gray.stops, v);
  if (!(rgb[0] === rgb[1] && rgb[1] === rgb[2])) { grayOk = false; break; }
}
ok(grayOk, '灰度模式 R=G=B（含越界钳制区）');
ok(Lab.samplePalette(Lab.PALETTES.gray.stops, 0).join(',') === '0,0,0'
   && Lab.samplePalette(Lab.PALETTES.gray.stops, 1).join(',') === '255,255,255', '灰度端点黑/白');
let stopsOk = true;
for (const key of Lab.PALETTE_ORDER) {
  const s = Lab.PALETTES[key].stops;
  if (s[0][0] !== 0 || s[s.length - 1][0] !== 1) stopsOk = false;
  for (let i = 1; i < s.length; i++) if (s[i][0] <= s[i - 1][0]) stopsOk = false;
}
ok(stopsOk, '五套配色停靠点有序且覆盖 [0,1]', Lab.PALETTE_ORDER.join('/'));
let rampOk = true;
const oceanStops = Lab.PALETTES.ocean.stops;
for (let i = 0; i <= 255; i++) {
  const rgb = Lab.samplePalette(oceanStops, i / 255);
  for (let k = 0; k < 3; k++) if (!(rgb[k] >= 0 && rgb[k] <= 255)) rampOk = false;
}
ok(rampOk, '配色插值输出始终为合法 RGB');

/* ---------- 10. 性能冒烟 ---------- */
section('10. 性能冒烟');
const t0 = Date.now();
Lab.fbmField({ seed: 20260829, freq: 4, octaves: 5, width: 512, seamless: true });
const dt512 = Date.now() - t0;
info.dt512 = dt512;
ok(dt512 < 5000, '512² × 5 层 < 5s', dt512 + ' ms');
const t1 = Date.now();
Lab.fbmField({ seed: 20260829, freq: 4, octaves: 5, width: 1024, seamless: true });
const dt1024 = Date.now() - t1;
info.dt1024 = dt1024;
ok(dt1024 < 10000, '1024² × 5 层 < 10s（秒级达标）', dt1024 + ' ms');

/* ---------- 汇总 ---------- */
fs.unlinkSync(tmp);
console.log('\n==============================');
console.log('结果：通过 ' + pass + ' 项 / 失败 ' + fail + ' 项  （总行数 ' + totalLines + '，512² ' + dt512 + 'ms，1024² ' + dt1024 + 'ms）');
if (fail > 0) {
  console.log('失败明细：');
  fails.forEach(function (s) { console.log('  [FAIL] ' + s); });
  process.exit(1);
}
