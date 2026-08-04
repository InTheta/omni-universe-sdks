import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface BoundaryFinding {
  file: string;
  rule: string;
}

const excludedDirectories = new Set([".git", "node_modules"]);
const excludedExtensions = new Set([".gif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".tgz", ".webp", ".zip"]);
const secretPrefix = ["sk", "live", ""].join("_");

const rules: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "RFC1918 IPv4 address",
    pattern: /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/,
  },
  { name: "PEM private key", pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { name: "live Stripe secret", pattern: new RegExp(`${secretPrefix}[A-Za-z0-9]+`) },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub personal access token", pattern: /\bghp_[A-Za-z0-9]{36}\b/ },
];

export async function scanPublicBoundary(root: string): Promise<BoundaryFinding[]> {
  const absoluteRoot = resolve(root);
  const findings: BoundaryFinding[] = [];

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await walk(path);
        continue;
      }
      if (!entry.isFile() || excludedExtensions.has(extname(entry.name).toLowerCase())) continue;

      const content = await readFile(path, "utf8");
      if (content.includes("\u0000")) continue;
      for (const rule of rules) {
        if (rule.pattern.test(content)) findings.push({ file: relative(absoluteRoot, path), rule: rule.name });
      }
    }
  }

  await walk(absoluteRoot);
  return findings;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const root = process.argv[2] ?? ".";
  const findings = await scanPublicBoundary(root);
  if (findings.length > 0) {
    for (const finding of findings) console.error(`${finding.file}: ${finding.rule}`);
    process.exitCode = 1;
  } else {
    console.log("Public boundary scan passed.");
  }
}
