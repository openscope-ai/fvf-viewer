import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { renderStaticLayout } from "../src/static-pages/layout";
import { staticPages } from "../src/static-pages/registry";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const publicDir = path.join(webRoot, "public");
const distDir = path.join(webRoot, "dist");

console.log(`Building ${staticPages.length} static page(s)...`);

for (const page of staticPages) {
  const rawHtml = renderStaticLayout({
    meta: page.meta,
    contentHtml: page.renderContent(),
  });
  const html = await prettier.format(rawHtml, { parser: "html" });

  // 1. Output to public/<slug>/index.html
  const publicTargetDir = path.join(publicDir, page.meta.slug);
  mkdirSync(publicTargetDir, { recursive: true });
  const publicTargetPath = path.join(publicTargetDir, "index.html");
  writeFileSync(publicTargetPath, html, "utf8");
  console.log(`  -> Wrote ${publicTargetPath}`);

  // 2. Output to dist/<slug>/index.html if dist exists
  if (existsSync(distDir)) {
    const distTargetDir = path.join(distDir, page.meta.slug);
    mkdirSync(distTargetDir, { recursive: true });
    const distTargetPath = path.join(distTargetDir, "index.html");
    writeFileSync(distTargetPath, html, "utf8");
    console.log(`  -> Wrote ${distTargetPath}`);
  }
}

// 3. Copy discovery assets (robots.txt, sitemap.xml, llms.txt) to dist if dist exists
if (existsSync(distDir)) {
  const discoveryFiles = ["robots.txt", "sitemap.xml", "llms.txt"];
  for (const file of discoveryFiles) {
    const src = path.join(publicDir, file);
    if (existsSync(src)) {
      const dest = path.join(distDir, file);
      writeFileSync(dest, readFileSync(src));
      console.log(`  -> Copied ${file} to ${dest}`);
    }
  }
}

console.log("Static pages build complete.");
