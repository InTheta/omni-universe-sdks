import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const markdownFiles = collectMarkdown(root);
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const failures: string[] = [];
let checked = 0;

for (const file of markdownFiles) {
  const markdown = readFileSync(file, "utf8");
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1]?.trim();
    if (!target || /^(?:https?:\/\/|mailto:|#)/.test(target)) continue;
    const relativePath = target.split("#", 1)[0];
    if (!relativePath) continue;
    checked += 1;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(relativePath)))) {
      failures.push(`${file.slice(root.length + 1)} -> ${target}`);
    }
  }
}

if (failures.length) {
  throw new Error(`Broken relative Markdown links:\n${failures.join("\n")}`);
}
console.log(`Documentation links passed: ${checked} relative targets across ${markdownFiles.length} files`);

function collectMarkdown(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdown(path));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
  }
  return files;
}
