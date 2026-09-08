/**
 * Generates a commented CSS cheat-sheet from the variables actually in effect
 * right now (current skin + dark/light + any accent override), so users get a
 * ready-to-edit reference instead of a blank textarea.
 */
const TEMPLATE_SECTIONS: Array<{ title: string; note?: string; vars: Array<{ name: string; comment: string }> }> = [
  {
    title: "品牌主色：按钮、焦点环、侧栏激活项、图表主系列",
    vars: [
      { name: "--primary", comment: "主色" },
      { name: "--ring", comment: "焦点环" },
      { name: "--primary-foreground", comment: "主色上的文字（自动黑白）" },
    ],
  },
  {
    title: "页面底色与卡片",
    vars: [
      { name: "--background", comment: "页面底色" },
      { name: "--card", comment: "卡片底色" },
      { name: "--border", comment: "边框、输入框描边、滚动条" },
      { name: "--muted-foreground", comment: "辅助文字" },
    ],
  },
  {
    title: "圆角",
    vars: [
      { name: "--radius", comment: "Tailwind 圆角基准（按钮/输入框）" },
      { name: "--gary-radius-card", comment: "大容器圆角" },
      { name: "--gary-radius-regular", comment: "常规面板圆角" },
    ],
  },
  {
    title: "玻璃质感",
    vars: [
      { name: "--gary-saturate", comment: "玻璃背后饱和度（Amber 为 180%）" },
      { name: "--gary-contrast", comment: "玻璃背后对比度" },
    ],
  },
  {
    title: "氛围光三色（背景三团光晕）",
    vars: [
      { name: "--gary-scene-a", comment: "氛围光 A" },
      { name: "--gary-scene-b", comment: "氛围光 B" },
      { name: "--gary-scene-c", comment: "氛围光 C" },
    ],
  },
  {
    title: "动态波浪三色（地平线 / 主体 / 波峰）",
    vars: [
      { name: "--gary-scene-wave-horizon", comment: "波浪地平线（与底色同系）" },
      { name: "--gary-scene-wave", comment: "波浪主体色" },
      { name: "--gary-scene-wave-crest", comment: "波峰亮色" },
    ],
  },
  {
    title: "图表五色",
    note: "注意：逗号分隔的 RGB",
    vars: [
      { name: "--msf-chart-download", comment: "下载速率" },
      { name: "--msf-chart-upload", comment: "上传速率" },
      { name: "--msf-chart-cpu", comment: "CPU" },
      { name: "--msf-chart-memory", comment: "内存" },
      { name: "--msf-chart-connections", comment: "连接数" },
    ],
  },
];

export function buildSkinCSSTemplate(): string {
  const read = (name: string) => {
    if (typeof document === "undefined") return "未定义";
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || "未定义";
  };
  const blocks = TEMPLATE_SECTIONS.map((section) => {
    const lines = [
      `/* —— ${section.title}${section.note ? `（${section.note}）` : ""} —— */`,
      ":root {",
      ...section.vars.map((item) => `  ${item.name}: ${read(item.name)};${" ".repeat(2)}/* ${item.comment} */`),
      "}",
    ];
    return lines.join("\n");
  });
  return [
    "/* =========================================================",
    "   MSF 皮肤 CSS 速查 —— 按当前实际生效值生成（可改可删）",
    "   输入即时预览；「保存」后全设备同步；清空并保存即恢复默认",
    "   ========================================================= */",
    "",
    ...blocks,
    "",
    "/* 暗色模式需单独覆盖时，把 :root 换成 .dark 或 html.dark */",
  ].join("\n");
}
