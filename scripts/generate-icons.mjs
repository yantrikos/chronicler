// Generate PNG fallbacks for legacy clients that don't render SVG icons
// (older Android, some Windows shell contexts, GitHub social-preview upload).
//
// Run: npm run build:icons
//
// Outputs:
//   public/favicon-32.png
//   public/favicon-16.png
//   public/apple-touch-icon.png (180×180)
//   public/icon-192.png
//   public/icon-512.png
//   public/social-preview.png (1280×640 from docs/social-preview.svg)
//
// sharp is installed as a devDependency. If you're on a platform where its
// native install fails, remove the `build:icons` step from your workflow —
// SVGs alone cover 99% of modern clients.

import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

async function png(svgPath, outPath, size) {
  const svg = readFileSync(svgPath);
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(svg)
    .resize(size.width, size.height ?? size.width, { fit: "contain" })
    .png()
    .toFile(outPath);
  console.log(`  ✓ ${outPath}  (${size.width}×${size.height ?? size.width})`);
}

async function main() {
  const icon = resolve(ROOT, "public/icon.svg");
  const apple = resolve(ROOT, "public/apple-touch-icon.svg");
  const social = resolve(ROOT, "docs/social-preview.svg");

  console.log("Generating PNG icon fallbacks…");
  await png(icon, resolve(ROOT, "public/favicon-16.png"), { width: 16 });
  await png(icon, resolve(ROOT, "public/favicon-32.png"), { width: 32 });
  await png(apple, resolve(ROOT, "public/apple-touch-icon.png"), { width: 180 });
  await png(icon, resolve(ROOT, "public/icon-192.png"), { width: 192 });
  await png(icon, resolve(ROOT, "public/icon-512.png"), { width: 512 });
  await png(social, resolve(ROOT, "public/social-preview.png"), {
    width: 1280,
    height: 640,
  });
  console.log("done.");
}

main().catch((err) => {
  console.error("icon generation failed:", err);
  process.exit(1);
});
