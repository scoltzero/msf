#!/usr/bin/env node

const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "../..");
const sourceSvgPath = path.join(
  root,
  "logo_motion_mizar/source/msf-mizar.svg",
);
const motionSvgPath = path.join(root, "logo_motion_mizar/orbit_weave_v2/logo.svg");
const motionCssPath = path.join(root, "logo_motion_mizar/orbit_weave_v2/motion.css");
const brandRoot = path.join(root, "logo_motion_mizar/exports");

const transparentSizes = [16, 32, 64, 128, 256, 512, 1024, 2048];
const macIconFiles = new Map([
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
]);

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeFile(filePath, data) {
  await ensureParent(filePath);
  await fs.writeFile(filePath, data);
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.name !== "SHA256SUMS") {
      files.push(entryPath);
    }
  }
  return files;
}

async function writeChecksums() {
  const files = (await listFiles(brandRoot)).sort();
  const lines = [];
  for (const filePath of files) {
    const digest = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
    lines.push(`${digest}  ${path.relative(brandRoot, filePath).split(path.sep).join("/")}`);
  }
  await writeFile(path.join(brandRoot, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

function withViewBox(svg, viewBox, width, height) {
  return svg
    .replace(/width="1254"/, `width="${width}"`)
    .replace(/height="1254"/, `height="${height}"`)
    .replace(/viewBox="0 0 1254 1254"/, `viewBox="${viewBox}"`);
}

async function renderSvg(svg, size, outputPath) {
  await ensureParent(outputPath);
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);
}

async function renderTransparentMark(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({
      width: size,
      height: size,
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function appTileSvg(size) {
  const scale = size / 1024;
  const n = (value) => Math.round(value * scale * 1000) / 1000;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="0.58" stop-color="#fbfdff"/>
          <stop offset="1" stop-color="#f3f9ff"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="${n(14)}" stdDeviation="${n(18)}" flood-color="#002d66" flood-opacity="0.18"/>
        </filter>
      </defs>
      <rect x="${n(54)}" y="${n(42)}" width="${n(916)}" height="${n(916)}" rx="${n(205)}"
        fill="url(#tile)" stroke="#dbeeff" stroke-width="${Math.max(1, n(2))}" filter="url(#shadow)"/>
    </svg>`;
}

async function buildAppIcon(svg, size) {
  const tile = await sharp(Buffer.from(appTileSvg(size))).png().toBuffer();
  const mark = await renderTransparentMark(svg, Math.round(size * 0.61));
  const meta = await sharp(mark).metadata();
  return sharp(tile)
    .composite([
      {
        input: mark,
        left: Math.round((size - meta.width) / 2),
        top: Math.round((size - meta.height) / 2 - size * 0.005),
      },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function makeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(count * 16);
  let offset = 6 + entries.length;
  images.forEach(({ size, data }, index) => {
    const base = index * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, base);
    entries.writeUInt8(size >= 256 ? 0 : size, base + 1);
    entries.writeUInt8(0, base + 2);
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += data.length;
  });

  return Buffer.concat([header, entries, ...images.map(({ data }) => data)]);
}

function makeAnimatedSvg(svg, css) {
  const animationCss = `
    #motion-ribbons { opacity: 0; }
    @media (prefers-reduced-motion: no-preference) {
      ${css}
    }
  `;
  return svg.replace("<defs>", `<style><![CDATA[${animationCss}]]></style>\n<defs>`);
}

async function main() {
  const sourceSvg = await fs.readFile(sourceSvgPath, "utf8");
  const faviconSvg = withViewBox(sourceSvg, "170 150 910 910", 512, 512);
  const unraidSvg = withViewBox(sourceSvg, "135 115 984 984", 512, 512);

  await writeFile(path.join(brandRoot, "vector/msf-mizar.svg"), sourceSvg);
  await writeFile(path.join(brandRoot, "favicon/msf-mizar-favicon.svg"), faviconSvg);

  for (const size of transparentSizes) {
    await renderSvg(
      sourceSvg,
      size,
      path.join(brandRoot, `transparent/msf-mizar-${size}.png`),
    );
  }

  const faviconImages = [];
  for (const size of [16, 32, 48]) {
    const data = await sharp(Buffer.from(faviconSvg), { density: 384 })
      .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    faviconImages.push({ size, data });
    await writeFile(path.join(brandRoot, `favicon/msf-mizar-favicon-${size}.png`), data);
  }
  const ico = makeIco(faviconImages);
  await writeFile(path.join(brandRoot, "favicon/msf-mizar-favicon.ico"), ico);

  const appMaster = await buildAppIcon(sourceSvg, 1024);
  await writeFile(path.join(brandRoot, "app-icon/msf-mizar-app-icon-1024.png"), appMaster);
  for (const size of [16, 32, 64, 128, 180, 192, 256, 512]) {
    const data = await sharp(appMaster)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    await writeFile(path.join(brandRoot, `app-icon/msf-mizar-app-icon-${size}.png`), data);
  }

  await renderSvg(unraidSvg, 256, path.join(brandRoot, "unraid/msf-mizar-unraid-256.png"));
  await renderSvg(unraidSvg, 128, path.join(brandRoot, "unraid/msf-mizar-unraid-128.png"));

  await writeFile(path.join(root, "web/public/logo/logo-square.svg"), sourceSvg);
  await writeFile(path.join(root, "web/public/logo/favicon.svg"), faviconSvg);
  await renderSvg(sourceSvg, 1024, path.join(root, "web/public/logo/logo-square.png"));
  await writeFile(path.join(root, "web/src/app/favicon.ico"), ico);
  await writeFile(path.join(root, "web/public/logo/favicon.ico"), ico);
  await writeFile(
    path.join(root, "web/public/logo/apple-touch-icon.png"),
    await sharp(appMaster).resize(180, 180).png({ compressionLevel: 9 }).toBuffer(),
  );
  await writeFile(
    path.join(root, "web/public/logo/icon-192.png"),
    await sharp(appMaster).resize(192, 192).png({ compressionLevel: 9 }).toBuffer(),
  );
  await writeFile(
    path.join(root, "web/public/logo/icon-512.png"),
    await sharp(appMaster).resize(512, 512).png({ compressionLevel: 9 }).toBuffer(),
  );

  await writeFile(path.join(root, "logo.png"), appMaster);
  await writeFile(path.join(root, "macos/MSFMenuBar/Resources/AppIcon-master.png"), appMaster);
  for (const [filename, size] of macIconFiles) {
    await writeFile(
      path.join(root, "macos/MSFMenuBar/Resources/Assets.xcassets/AppIcon.appiconset", filename),
      await sharp(appMaster)
        .resize(size, size, { kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    );
  }

  await fs.copyFile(
    path.join(brandRoot, "unraid/msf-mizar-unraid-256.png"),
    path.join(root, "packaging/unraid/msf.png"),
  );
  await fs.copyFile(
    path.join(brandRoot, "unraid/msf-mizar-unraid-128.png"),
    path.join(root, "packaging/unraid/root/usr/local/emhttp/plugins/msf/msf.png"),
  );

  const motionSvg = await fs.readFile(motionSvgPath, "utf8");
  const motionCss = await fs.readFile(motionCssPath, "utf8");
  const animatedSvg = makeAnimatedSvg(motionSvg, motionCss);
  await writeFile(path.join(brandRoot, "motion/msf-mizar-orbit-weave.svg"), animatedSvg);
  await writeFile(
    path.join(root, "web/public/logo-motion/msf-mizar-orbit-weave.svg"),
    animatedSvg,
  );

  await fs.copyFile(
    path.join(root, "logo_motion_mizar/orbit_weave_v2/outputs/msf-mizar-orbit-weave-transparent.webp"),
    path.join(brandRoot, "motion/msf-mizar-orbit-weave-transparent.webp"),
  );
  await fs.copyFile(
    path.join(root, "logo_motion_mizar/orbit_weave_v2/outputs/msf-mizar-orbit-weave-preview.gif"),
    path.join(brandRoot, "motion/msf-mizar-orbit-weave-preview.gif"),
  );

  await writeChecksums();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
