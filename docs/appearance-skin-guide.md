# MSF 外观与皮肤系统完全指南

> 适用版本：feature/appearance 分支（commit 513c62c 之后）。
> 本文面向三类读者：想用「自定义 CSS」微调面板的用户、想新增整套皮肤的 Agent / 开发者、以及想理解整条外观链路的维护者。

---

## 目录

1. [一分钟总览](#1-一分钟总览)
2. [五个正交维度](#2-五个正交维度)
3. [层级结构：文件与加载顺序](#3-层级结构文件与加载顺序)
4. [CSS 变量瀑布与优先级](#4-css-变量瀑布与优先级)
5. [变量字典（完整对照表）](#5-变量字典完整对照表)
6. [特效能力清单](#6-特效能力清单)
7. [数据链路：存储、同步与 401 豁免](#7-数据链路存储同步与-401-豁免)
8. [新增一套皮肤：Agent 操作手册](#8-新增一套皮肤agent-操作手册)
9. [皮肤设计建议（五个方向）](#9-皮肤设计建议五个方向)
10. [自定义 CSS 实战案例](#10-自定义-css-实战案例)
11. [调试与排障](#11-调试与排障)

---

## 1. 一分钟总览

- **外观重启丢失的问题已修复**：偏好（主题/皮肤/场景/质量/透明度）不再被 401 登出清理连带删除，且全部同步到后端 SQLite（`settings` 表，`appearance.*` 键），重启、换浏览器、换设备都不丢。
- **皮肤（skin）= 一套 CSS 变量覆盖**：`<html data-skin="amber|classic">` 一个属性切换整套配色与材质，与明暗模式（light/dark/system）完全正交。经典皮肤 = 变量缺省态，零风险。
- **新增一套皮肤只需要**：1 个 CSS 文件 + 前端枚举 3 行 + 后端枚举 2 处（详见第 8 节 checklist）。
- **自定义 CSS**：设置页 → 外观设置 → 自定义 CSS，最多 64KB，保存即生效、全设备同步，可覆盖本字典里的任何变量。

## 2. 五个正交维度

| 维度 | 取值 | 存储键 / API 字段 | 控制什么 |
|---|---|---|---|
| 主题 theme | `light` / `dark` / `system` | `msf-theme` / `theme` | 明暗。切 `<html>` 的 `dark`/`light` class |
| 皮肤 skin | `amber` / `classic`（可扩展） | `msf-skin` / `skin` | 配色与材质。切 `<html data-skin>` |
| 品牌主色 accent | 任意 `#rrggbb` 或空 | `msf-accent-color` / `accent_color` | 覆盖 `--primary/--ring/--accent/--sidebar-primary` + **图表五色派生 + 氛围光 A + 选中色**；空 = 跟随皮肤 |
| 氛围色相 tint | `0`–`360`（度）或空 | `msf-skin-tint` / `skin_tint` | 背景舞台整体 `hue-rotate`：氛围光/波浪色感旋转，不动文字 |
| 场景 scene | `dynamic` / `static` / `neutral` | `msf-glass-scene` / `scene` | 背景层：动态 WebGL 波浪 / 静态渐变 / 纯净（无特效） |
| 质量 quality | `full` / `balanced` / `reduced` | `msf-glass-quality` / `quality` | 像素预算、模糊开关、波浪精度 |
| 底板透明度 | 三档 20–96% | `msf-content-plate-settings` / `content_plate_opacity_*` | 内容底板（表格/卡片内衬）不透明度 |

外加一个兜底维度：**自定义 CSS**（`msf-custom-css` / `custom_css`），优先级最高，可覆盖上述一切变量。

## 3. 层级结构：文件与加载顺序

```
web/src/app/globals.css            入口。@import 顺序即优先级基础（后者可覆盖前者）
├─ tailwindcss / tw-animate-css / shadcn/tailwind.css
├─ styles/liquid-glass-tokens.css      变量定义层：:root（亮）与 .dark（暗）的全部 --gary-* 与图表色
├─ styles/liquid-glass-scenes.css      场景层：.gary-scene 背景与渐变/丝绸层
├─ styles/liquid-glass-materials.css   材质层：.gary-glass / .gary-solid-plate 等类消费变量
├─ styles/liquid-glass-controls.css    控件层：按钮、分段控件等
├─ styles/liquid-glass-motion.css      动效层
├─ styles/liquid-glass-pages.css       页面层
└─ styles/skin-amber.css               皮肤覆盖层（新增皮肤在此追加 import）
```

运行时的 DOM 结构（自底向上）：

```
<html class="dark|light" data-skin="amber" data-gary-scene="dynamic" data-gary-quality="balanced">
└─ .gary-app-shell                        应用外壳（侧栏 + 主区）
   └─ .gary-scene          z-index:-2     背景舞台（fixed 全屏）
      ├─ .gary-scene__legacy-gradient     静态径向渐变层（吃 --gary-scene-a/b/c）
      │  └─ .gary-scene__legacy-silk      丝绸质感层
      └─ .gary-scene__gradient-waves      动态 WebGL 波浪（ogl 着色器，颜色吃 --gary-scene-wave-*）
└─ 内容区（z-index:1+）
   ├─ .gary-glass  /  .gary-glass--ultrathin|regular|thick|strong   玻璃容器（顶栏/侧栏/卡片）
   ├─ .gary-solid-plate(--subtle|regular|strong)                    内容底板（表格、数据行）
   └─ Tailwind 语义类（bg-primary、text-muted-foreground、border-border…）  组件着色
└─ <style id="msf-custom-css">            自定义 CSS，挂在 <head> 末尾，优先级最高
```

图表颜色不走 CSS 类，由 `charts.tsx` 的 `resolveChartColors()` 在渲染时用 `getComputedStyle` 读取 `--msf-chart-*` 变量；`useChartTheme()` 监听 `<html>` 的 `class` 与 `data-skin` 变化触发重算，图例（Legend）与曲线永远同色。

## 4. CSS 变量瀑布与优先级

同一元素的变量按「选择器特异性 + 源码顺序」决胜：

| 优先级（低→高） | 选择器 | 特异性 | 用途 |
|---|---|---|---|
| 1 | `:root` | (0,1,0) | 经典亮色默认值 |
| 2 | `.dark` | (0,1,0)，源码在后 | 经典暗色默认值 |
| 3 | `html[data-skin="x"]` | (0,1,1) | 皮肤亮色覆盖 |
| 4 | `html[data-skin="x"].dark` | (0,2,1) | 皮肤暗色覆盖 |
| 5 | `html[data-gary-quality="balanced\|reduced"]` | (0,1,1) | 性能档位削减（与皮肤平级，靠源码顺序） |
| 6 | `@media (max-width:767px)` 内的上述规则 | 同上 | 移动端缩减 |
| 7 | 元素内联 `style="--gary-plate-opacity-regular:.7"` | (1,0,0) | 透明度滑条实时预览 |
| 8 | `<style id="msf-custom-css">`（head 末尾注入） | 按所写选择器 | 自定义 CSS（同特异性下后注入者胜） |

**两个必知的陷阱**：

1. **皮肤亮色规则会压过 `.dark`**：`html[data-skin="x"]`(0,1,1) > `.dark`(0,1,0)。所以皮肤文件里**亮/暗必须成对出现**——每个在亮色块里写过的变量，暗色块（`html[data-skin="x"].dark`）里也要给出对应值，否则暗色模式下会错误继承皮肤的亮色值。
2. **两种 RGB 书写格式不能混**：`--gary-plate-rgb` 用**空格分隔**（`252 250 248`，供 `rgb(var(--gary-plate-rgb) / 0.7)` 斜杠语法用）；`--msf-chart-*` 用**逗号分隔**（`249, 115, 22`，供 JS 拼接 `rgba(249, 115, 22, .3)` 用）。

## 5. 变量字典（完整对照表）

### 5.1 语义 token（Tailwind 类直接消费）

| 变量 | classic 亮 | classic 暗 | amber 亮 | amber 暗 | 消费者 / 效果 |
|---|---|---|---|---|---|
| `--background` | `oklch(98% .002 240)` | `oklch(18% .005 240)` | `#f2f2f4` | `#1c1917` | `bg-background`；页面基底 |
| `--foreground` | `oklch(25% .01 240)` | `oklch(95% …)` | `#292524` | `#e7e5e4` | `text-foreground`；正文 |
| `--card` / `--card-foreground` | 纯白 / 深灰 | 深灰 / 浅灰 | `#fcfaf8` | `#292524` | 卡片底/字 |
| `--popover(-foreground)` | 同 card | 同 card | `#fcfaf8` | `#292524` | 弹层、下拉 |
| `--primary` | `oklch(60% .21 235)` 蓝 | 同左 | `#f97316` 橙 | `#f97316` | `bg-primary`；主按钮、激活态、焦点环 |
| `--primary-foreground` | 近白 | 近白 | `#fff` | `#fff` | 主按钮文字 |
| `--secondary(-foreground)` | 浅灰 | 深灰 | `#f5f5f4` | `#44403c` | 次级按钮 |
| `--muted` / `--muted-foreground` | 浅灰 / 中灰 | 深灰 / 浅灰 | `#f5f5f4` / `#78716c` | `#38332f` / `#a8a29e` | 弱化底/辅助文字 |
| `--accent(-foreground)` | 淡青 | 深青 | `#fff7ed` | `rgba(249,115,22,.16)` | 悬停高亮、选中行 |
| `--destructive(-foreground)` | 红 | 红 | `#ef4444` | `#ef4444` | 危险操作 |
| `--border` / `--input` | 中灰 | 深灰 | `#f0ebe1` 米色 | `#3f3936` | 全部边框、输入框描边、**滚动条 thumb** |
| `--ring` | 蓝 | 蓝 | `#f97316` / 暗 `#fb923c` | | 焦点环 |
| `--sidebar*`（6 个） | 白/蓝系 | 深灰系 | 暖白/橙系 | stone 系 | 侧栏专属配色 |
| `--radius` | `0.625rem` | 同 | `0.75rem` | 同 | Tailwind 圆角基准，派生 sm(×.6)/md(×.8)/lg(×1)/xl(×1.4)/2xl(×1.8) |

### 5.2 场景组（背景舞台）

| 变量 | 含义 | classic 亮 | amber 亮 | 效果 |
|---|---|---|---|---|
| `--gary-scene-base` | 场景基底色 | `#eef0f2` | `#f2f2f4` | 丝绸层/网格底色 |
| `--gary-scene-a/b/c` | 三束氛围光颜色 | 蓝灰/暖沙/灰蓝 | 橙 22% / 翠绿 16% / 蓝 13% | 静态层的三团径向渐变光晕；**皮肤辨识度最大来源** |
| `--gary-scene-ink` / `-muted` | 场景上的主/次文字 | 深灰/中灰 | stone 系 | 登录页大字等直接写在场景上的文字 |
| `--gary-scene-mask` | 边缘暗角遮罩 | 淡白 | 淡暖白 | 四角渐隐 |
| `--gary-scene-wave-horizon` | WebGL 波浪地平线色 | `#f3fbff` | `#f2f2f4` | 动态波浪的底色（应与场景基底同色系） |
| `--gary-scene-wave` | 波浪主体色 | `#00366f` 深海军蓝 | `#7a4a24` 深琥珀棕 | 波浪深色部分 |
| `--gary-scene-wave-crest` | 波浪波峰色 | `#24d7ee` 青 | `#fb923c` 橙 | 波浪亮色描边 |
| （类内硬编码） | `.gary-scene` 自身 background | `#f3fbff` / 暗 `#0d0f11` | 需在皮肤里用 `html[data-skin=x] .gary-scene` 覆盖 | 场景最底层实色 |

### 5.3 玻璃材质组（`.gary-glass` 系列消费）

| 变量 | 含义 | classic 亮 | amber 亮 | 效果 |
|---|---|---|---|---|
| `--gary-glass-fill-ultrathin` | 超薄玻璃（顶栏） | 白 12% | 白 34% | 顶栏/浮动条的底色 |
| `--gary-glass-fill-regular` | 常规玻璃 | 白 18% | 白 50% | 侧栏、普通面板 |
| `--gary-glass-fill-thick` | 厚玻璃 | 白 24% | 白 60% | 大卡片 |
| `--gary-glass-fill-strong` | 强玻璃 | 白 34% | 白 72% | 弹窗、降级 fallback |
| `--gary-blur-ultrathin/regular/thick` | 模糊半径 | 20/22/28px | 30/40/48px（**仅 full 档**） | 磨砂强度；balanced/reduced 档自动回落 16-22px |
| `--gary-saturate` | 背景饱和度 | 108% | 180% | 玻璃后面的颜色更鲜艳（Amber 标志性 `saturate(1.8)`） |
| `--gary-contrast` | 背景对比度 | 1.03 | 1 | 轻微提对比 |

### 5.4 内容底板组（`.gary-solid-plate` 消费，即表格/数据区内衬）

| 变量 | 含义 | 备注 |
|---|---|---|
| `--gary-plate-rgb` | 底板基色（空格分隔 RGB） | classic `248 249 250`，amber `252 250 248` |
| `--gary-plate-opacity-subtle/regular/strong` | 三档不透明度 0–1 | 默认 0.56/0.70/0.84；**由设置页滑条以内联 style 实时写入**，皮肤文件一般不动 |
| `--gary-plate-display-fill-*` | 实际渲染值 | quality=reduced / 系统减少透明度时自动抬高最小值，勿手动改 |

### 5.5 边框 / 阴影 / 雾霜组

| 变量 | 含义 | amber 亮取值 | 效果 |
|---|---|---|---|
| `--gary-edge-highlight` / `-soft` | 顶边高光 | 白 85% / 38% | 玻璃 `::before` 渐变描边的亮部 |
| `--gary-edge-dim` / `-shadow` | 底边暗边 | `rgba(240,235,225,.95)` / 暖黑 8% | 描边暗部；edge-dim 同时是 `.gary-glass` 的 1px 边框色 |
| `--gary-contact-shadow` | 贴地影 | `0 1px 2px 5%` | 控件级 |
| `--gary-environment-shadow` | 环境影 | `0 8px 32px 6%` | 容器级（Amber 面板阴影原值） |
| `--gary-floating-shadow` | 悬浮影 | `0 8px 30px 4%` | 浮层/卡片（Amber 卡片阴影原值） |
| `--gary-frost-light` / `-dark` | 霜噪点亮/暗色 | 白 24% / 暖棕 6% | 玻璃 `::after` 的重复径向渐变微噪点 |

### 5.6 形状与动效组

| 变量 | classic | amber | 效果 |
|---|---|---|---|
| `--gary-radius-card` | 28px | 32px（移动端 28px） | 大容器圆角 |
| `--gary-radius-regular` | 19.2px | 16px | 常规面板圆角 |
| `--gary-radius-compact` | 14px | 12px | 小件圆角 |
| `--gary-ease` / `-soft` | `cubic-bezier(.16,1,.3,1)` 等 | 同 | 全站缓动 |
| `--gary-motion-fast/-slow` | 150/250/350ms | 同 | 过渡时长 |
| `--gary-z-scene/-content/-nav/-header/-overlay` | -2/1/40/50/70 | 同 | 层叠顺序，一般不动 |

### 5.7 图表色（逗号分隔 RGB，JS 读取）

| 变量 | classic | amber 亮 | amber 暗 | 用途 |
|---|---|---|---|---|
| `--msf-chart-cpu` | 37,99,235 | 249,115,22 | 251,146,60 | CPU 曲线+图例 |
| `--msf-chart-memory` | 147,51,234 | 16,185,129 | 52,211,153 | 内存曲线 |
| `--msf-chart-download` | 96,165,250 | 251,146,60 | 251,146,60 | 下载速率 |
| `--msf-chart-upload` | 74,222,128 | 96,165,250 | 96,165,250 | 上传速率 |
| `--msf-chart-connections` | 139,92,246 | 52,211,153 | 52,211,153 | 连接数 |

### 5.8 品牌主色（accent）覆盖层与氛围色相（tint）

设置页「皮肤调色」卡片 = 品牌主色调色盘（预设 + 取色器实时预览）+ 氛围色相滑条 + 迷你预览条。实现（`web/src/lib/accent.ts`、`web/src/lib/skinTint.ts`）：

- **主色取值**：`#rrggbb` 或空串（空 = 跟随当前皮肤的 primary）。
- **主色影响面**（为「调了就要看得见」而全局化）：生成 CSS 写入 `<style id="msf-accent-css">`，四档选择器（`:root / html[data-skin] / html.dark / html[data-skin].dark`）覆盖：
  - 品牌七变量：`--primary`、`--ring`、`--primary-foreground`（按亮度自动黑白字）、`--sidebar-primary/-ring`、`--accent`（14% 悬停高亮）、`--accent-foreground`；
  - **图表五色** `--msf-chart-*`：从主色 HSL 派生五个分离色相（download=主色、upload=+45°、cpu=−140°、memory=+140°、connections=+95°）——仪表盘立即跟随；
  - **氛围光 A** `--gary-scene-a`：主色 22% 透明度——背景光晕变色；
  - `::selection` 文字选中色。
- **常驻界面主色化**（默认即生效，无需选主色）：侧栏激活行 `.gary-nav-row--active` 带主色左指示条与 12% 主色底；分段控件激活态主色文字；顶栏下拉选中项主色。
- **氛围色相（tint）**：`<style id="msf-skin-tint-css">` 输出 `html .gary-scene { filter: hue-rotate(Ndeg) }`——只作用于背景舞台（氛围光、WebGL 波浪、透过玻璃的色感整体旋转），内容文字与图表不受影响；亮暗通用。
- **层级**：accent / tint 两个 style 元素恒插在自定义 CSS 之前，自定义 CSS 仍是最终话语权。
- **存储**：`msf-accent-color` / `msf-skin-tint`（白名单豁免、启动早期恢复）+ 后端 `appearance.accent_color`（`^#rrggbb$` 或空）/ `appearance.skin_tint`（0-360 整数或空）。

### 5.9 自定义 CSS：模板与实时预览

- **「填入当前皮肤模板」**（`web/src/lib/skinTemplate.ts`）：用 `getComputedStyle` 读取当前皮肤 + 明暗 + 主色覆盖下**实际生效**的变量值，生成带中文注释的分组速查表（主色/底色/圆角/玻璃/氛围光/波浪/图表五色）——不确定写什么时一键获得可改的参考底稿。
- **实时预览**：输入防抖 300ms 即时应用（仅本机，不落库）；「保存」才 PUT 持久化全设备同步；「撤销预览」回到已保存版本；有未保存修改时关闭页面会提示。

## 6. 特效能力清单

| 特效 | 原理 | 开关 / 载体 | 降级行为 |
|---|---|---|---|
| 玻璃拟态 | 半透明 fill + `backdrop-filter: blur() saturate() contrast()` | `.gary-glass` 系列；blur 半径按质量档 | quality=reduced 或系统「减少透明度」→ 实心底板、无模糊 |
| 边框高光 | `::before` 渐变描边（亮顶→暗底，mask 镂空） | 自动 | — |
| 霜面噪点 | `::after` 重复径向渐变 + soft-light 混合 | 自动（透明度 0.12） | — |
| 三束氛围光 | 静态层三团径向渐变（`--gary-scene-a/b/c`） | scene=static/dynamic | neutral 关闭 |
| 动态波浪 | WebGL(ogl) 着色器，全屏 canvas | scene=dynamic；颜色吃 `--gary-scene-wave-*` | reduced-motion 时静止；neutral 隐藏 |
| 像素预算 | 波浪 canvas 分辨率 230 万/120 万/65 万 | quality 三档 | — |
| 内容底板三档透明 | `rgb(var(--gary-plate-rgb)/α)` | 设置页滑条（内联变量） | — |
| 图表换肤 | JS 读 `--msf-chart-*` + MutationObserver | 自动 | — |
| 文字选中色 | `::selection` | 皮肤文件指定 | — |
| 滚动条 | 6px，thumb 用 `--border` | `.scrollbar-thin` | — |

## 7. 数据链路：存储、同步与 401 豁免

```
任一入口切换（顶栏下拉 / 设置页 / Setup 页）
  → 本地立即生效：localStorage + <html> 属性（防闪变）
  → 异步持久化：PUT /api/v1/settings/appearance {"theme":"dark","skin":"amber",...}
      → SQLite settings 表 appearance.* 键（重启不丢；出厂复位会清空=回到默认皮肤）

启动时序：
  1. main.tsx（React 挂载前）读 localStorage → 设 class / data-skin / data-gary-* / 注入自定义 CSS
  2. AppHeader 挂载 → GET /api/v1/settings/appearance（登录用户可读，guest 除外）
     → reconcileTheme()：后端非 system 以后端为准（多设备一致）；
       本地非 system 且后端仍是默认 → 本地赢并回写（老用户一次性迁移）
     → 皮肤/自定义 CSS 同样后端为准
```

**401 豁免白名单**（`web/src/lib/api.ts` 的 `clearSession()`）：`msf-theme`、`msf-language`、`msf-skin`、`msf-custom-css`、`msf-glass-scene`、`msf-glass-quality`、`msf-content-plate-settings`、`msf-content-plate-opacity`，以及 `msf-login-announcement:*:hidden`。token 过期（24h）触发的清理**不会**再碰它们。

后端校验（`internal/server/handlers_system.go`）：`skin` 必须 `amber|classic`（新皮肤要加进枚举）；`custom_css` ≤ 64KB。结构化端点 `PUT /api/v1/settings/structured` 的 `appearance` 节同样生效。

## 8. 新增一套皮肤：Agent 操作手册

以新增皮肤 `jade`（示例名）为例，共 5 处改动：

1. **前端类型与选项** `web/src/lib/skin.ts`
   - `SkinId` 联合类型加 `"jade"`；`isSkinId()` 加判断；
   - `skinOptions` 数组加 `{ id: "jade", label: "黛青", description: "……" }`（设置页选择卡片自动渲染，含色板小圆点可选做）。

2. **皮肤 CSS** 新建 `web/src/styles/skin-jade.css`，并在 `web/src/app/globals.css` 末尾追加 `@import "../styles/skin-jade.css";`（放在 skin-amber.css 之后）。模板：

   ```css
   html[data-skin="jade"] {
     color-scheme: light;
     /* 5.1 语义 token 全量给出（亮色值） */
     --background: …; --foreground: …; --card: …; --primary: …; --border: …; --ring: …;
     /* sidebar 6 件套 */
     /* 5.2 场景组：base + a/b/c + ink/muted/mask + wave 三色 */
     /* 5.3 玻璃组：4 个 fill + saturate/contrast */
     /* 5.4：--gary-plate-rgb（空格分隔！） */
     /* 5.5 边框/阴影/霜 8 个 */
     /* 5.6 radius 三档 + --radius */
     /* 5.7 图表 5 色（逗号分隔！） */
   }
   html[data-skin="jade"] .gary-scene { background: …; }        /* 场景底色，必须覆盖 */
   html[data-skin="jade"] ::selection { background: …; }

   /* 模糊放大只在 full 档生效（性能红线） */
   html[data-skin="jade"][data-gary-quality="full"] { --gary-blur-ultrathin: …; --gary-blur-regular: …; --gary-blur-thick: …; }
   @media (max-width: 767px) {
     html[data-skin="jade"] { --gary-radius-card: …; }
     html[data-skin="jade"][data-gary-quality="full"] { /* 模糊缩小 */ }
   }

   html[data-skin="jade"].dark { color-scheme: dark; /* 与亮色块逐一成对的全量暗色值 */ }
   html[data-skin="jade"].dark .gary-scene { background: …; }
   html[data-skin="jade"].dark ::selection { background: …; }
   ```

3. **后端枚举（两处）**
   - `internal/server/handlers_system.go` → `validateAppearanceSkinAndCustomCSS`：`oneOf(skin, "amber", "classic")` 加 `"jade"`；
   - `internal/server/handlers_settings_structured.go` → `applyStructuredAppearance` 的 `case "skin"`：同步加 `"jade"`。

4. **测试** `internal/server/handlers_system_test.go` 的 `TestAppearanceSkinAndCustomCSSValidation`：可把非法值断言扩为覆盖新枚举（`"neon"` 仍应 400）。

5. **验证**
   ```
   cd web && pnpm test && pnpm build
   GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go test -c -o /tmp/s.test ./internal/server/
   # 复制进 WSL 执行（Windows 原生跑不了 Go 测试，见仓库已知问题）
   ```

**Agent 必读的坑**：
- 亮/暗**必须成对全量**覆盖（见第 4 节陷阱 1），漏一个变量暗色就会漏出亮色值。
- blur 只在 `[data-gary-quality="full"]` 里放大；balanced/reduced 的性能预算不可侵占。
- `.gary-scene` 的 background 是类内硬编码，皮肤必须用 `html[data-skin=x] .gary-scene`（亮暗各一条）覆盖，光改 `--gary-scene-base` 不够。
- 文字对比度 ≥ 4.5:1（`--foreground` 对 `--background`、`--muted-foreground` 对 `--card`）。
- 图表 5 色之间要能区分（同屏最多 3 色共存：CPU/内存 与 下载/上传/连接数）。
- `web/src/app/settings/SettingsClient.tsx` 里皮肤卡片的色板小圆点是按 id 硬编码的 `style={{ background: id === "amber" ? … : … }}`，新增皮肤时顺手加一个分支（或改成读 CSS 变量）。

## 9. 皮肤设计建议（五个方向）

> 通用心法：先定「场景底色 + 三束氛围光」（辨识度），再定「primary + border」（操作感），最后微调玻璃 fill 与阴影（质感）。亮色皮肤背景避免高饱和；暗色皮肤避免纯黑配纯白（刺眼），用 stone/zinc 系暖灰或冷灰。

| 方向 | 明暗 | 背景 / 卡片 | 描边 | Primary | 氛围光 a/b/c | 图表主色 | 一句话定位 |
|---|---|---|---|---|---|---|---|
| **OLED 纯黑** `midnight` | 暗（可无亮色，亮色给深灰） | `#000000` / `#0d0d0d` | `#1f1f1f` | `#e5e5e5`（银白操作色） | 深紫 12% / 深蓝 10% / 灰 6% | 白 / 灰蓝 / 灰绿 | 夜间省电、对比最大化 |
| **黛青** `jade` | 亮+暗 | `#eef2f1` / `#fbfdfc` | `#dde5e2` | `#2f6f6a` 青玉 | 青 20% / 竹绿 14% / 天青 10% | 青 / 竹绿 / 天青 | 中式沉静，护眼 |
| **薄暮宇宙** `dusk` | 暗 | `#131019` / `#1b1725` | `#2c2438` | `#a78bfa` 紫 | 紫 18% / 品红 12% / 靛蓝 10% | 紫 / 品红 / 靛蓝 | 深夜氛围感 |
| **纸墨** `paper` | 亮 | `#f7f4ed` 宣纸 / `#fcfaf3` | `#e8e2d4` | `#c23e33` 朱砂 | 赭石 18% / 黛 12% / 竹 8% | 朱砂 / 黛 / 赭 | 文人书卷气 |
| **终端绿** `phosphor` | 暗 | `#0a0f0a` / `#0e140e` | `#1d291d` | `#4ade80` 荧光绿 | 绿 16% / 青 8% / 灰绿 6% | 荧光绿系三档 | 极客 CRT 风 |

（图表主色需展开成 5 个 `--msf-chart-*`，同色系拉开明度即可。）

## 10. 自定义 CSS 实战案例

> 写在「设置 → 外观设置 → 自定义 CSS」，保存即生效。以下例子对所有皮肤通用；要「只影响某皮肤」就加前缀 `html[data-skin="amber"]`。涉及明暗差异的变量记得亮/暗各写一份。

**案例 1：换品牌主色（全站按钮/焦点环/激活态）**

> 最方便的路径是设置页的「品牌主色」调色盘（实时预览、自动处理按钮文字对比度），以下 CSS 写法效果等同、适合脚本化或需要更精细控制的场景。

```css
:root { --primary: #0ea5e9; --ring: #0ea5e9; }
.dark { --primary: #38bdf8; --ring: #38bdf8; --primary-foreground: #06283a; }
```

**案例 2：一键去模糊（低配设备提速）**

```css
.gary-glass, .glass-effect, .glass-effect-strong {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  background: var(--gary-glass-fill-strong) !important;
}
```

**案例 3：改氛围光（把三束光换成玫瑰/金/雾蓝）**

```css
:root {
  --gary-scene-a: rgba(244, 114, 182, 0.20);  /* 玫瑰 */
  --gary-scene-b: rgba(251, 191, 36, 0.16);   /* 金 */
  --gary-scene-c: rgba(147, 197, 253, 0.12);  /* 雾蓝 */
}
```

**案例 4：改动态波浪配色（霓虹青浪）**

```css
:root {
  --gary-scene-wave-horizon: #0b1020;
  --gary-scene-wave: #123a5c;
  --gary-scene-wave-crest: #22d3ee;
}
```

**案例 5：全局圆角调小（硬朗风） / 调大（更圆润）**

```css
:root {
  --radius: 0.5rem;            /* Tailwind 侧：按钮、输入框等 */
  --gary-radius-card: 20px;    /* 容器 */
  --gary-radius-regular: 12px;
  --gary-radius-compact: 8px;
}
```

**案例 6：卡片阴影加深（更「浮」）**

```css
:root {
  --gary-environment-shadow: 0 14px 44px rgba(0, 0, 0, 0.14);
  --gary-floating-shadow: 0 12px 36px rgba(0, 0, 0, 0.12);
}
```

**案例 7：数据表格斑马纹 + 行悬停**

```css
.gary-solid-plate tbody tr:nth-child(even) { background: color-mix(in srgb, var(--muted) 45%, transparent); }
.gary-solid-plate tbody tr:hover { background: color-mix(in srgb, var(--accent) 60%, transparent); }
```

**案例 8：只给琥珀皮肤加一个顶部品牌光带**

```css
html[data-skin="amber"] .gary-app-shell::before {
  content: "";
  position: fixed;
  inset: 0 0 auto 0;
  height: 3px;
  z-index: 60;
  background: linear-gradient(90deg, #fb923c, #f97316, #fbbf24);
  opacity: 0.8;
}
```

**案例 9：换全局字体**

```css
:root { --font-app-sans: "HarmonyOS Sans SC", "MiSans", -apple-system, sans-serif; }
```

**案例 10：修复性微调——把辅助文字调亮一档**

```css
.dark { --muted-foreground: #b8b2ad; }
```

## 11. 调试与排障

**DevTools 实时预览三板斧**（改完不用重启，去设置页保存即可固化）：
1. Elements → 选中 `<html>` → 双击 class / `data-skin` 属性直接改，全站即时换肤；
2. Console 里改变量即时预览：`document.documentElement.style.setProperty('--primary', '#e11d48')`；
3. Computed 面板查任意变量最终生效值（可看出被哪条规则覆盖）。

**症状速查**：

| 症状 | 原因 | 处理 |
|---|---|---|
| 换皮肤后某些面板颜色没变 | 皮肤文件漏了该变量（暗色块没成对写） | 按第 4 节陷阱 1 检查成对覆盖 |
| 背景仍是旧色 | `.gary-scene` background 未覆盖 | 加 `html[data-skin=x] .gary-scene` 亮/暗两条 |
| 波浪颜色没跟着换 | 波浪色变量没写 / 旧版本 | 确认写了 `--gary-scene-wave-*`；513c62c 之前波浪是 JS 硬编码 |
| 保存自定义 CSS 没生效 | 后端 4xx（超 64KB 或非字符串） | 看网络面板响应；拆分精简 |
| 主题隔天又丢了 | 运行的是旧版本二进制 | 确认部署了 feature/appearance 之后的构建 |
| 图表与图例不同色 | 手改了曲线色但没改 `--msf-chart-*` | 统一走变量，别在组件里写死 |

**已知限制**：`index.html` 的 `<meta name="theme-color">` 是静态 `#2563eb`，不随皮肤变（浏览器地址栏染色）；出厂复位会清空所有外观偏好回到默认（amber 亮色）。

---

*文档随皮肤系统演进，改动架构（变量命名/新增维度）时请同步更新本文。*
