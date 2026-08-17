#!/usr/bin/env node

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = ["index.html", "assets", "reference"];
const forbidden = ["sourse"];
const htmlExtensions = new Set([".html", ".htm"]);
const attributePattern = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/gi;
const failures = [];
let checkedLinks = 0;
let htmlFiles = 0;

for (const path of required) {
  if (!existsSync(join(root, path))) failures.push(`missing required path: ${path}`);
}
for (const path of forbidden) {
  if (existsSync(join(root, path))) failures.push(`forbidden legacy path still exists: ${path}`);
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "_vti_cnf") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function readHtml(path) {
  const bytes = readFileSync(path);
  const header = bytes.subarray(0, 4096).toString("latin1");
  const legacyEncoding = /charset\s*=\s*["']?(?:windows-1251|cp1251)/i.test(header);
  return new TextDecoder(legacyEncoding ? "windows-1251" : "utf-8").decode(bytes);
}

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function localTarget(source, raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;
  if (/^(?:[a-z][a-z\d+.-]*):/i.test(trimmed)) return null;

  const withoutFragment = trimmed.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) return null;

  const decoded = decodePath(withoutFragment.replace(/\\/g, "/"));
  return decoded.startsWith("/")
    ? resolve(root, "." + decoded)
    : resolve(dirname(source), decoded);
}

function existsAsWebTarget(path) {
  if (!path.startsWith(root + sep) && path !== root) return false;
  if (existsSync(path)) {
    if (!lstatSync(path).isDirectory()) return true;
    return existsSync(join(path, "index.html")) || existsSync(join(path, "index.htm"));
  }
  return !extname(path) && (existsSync(path + ".html") || existsSync(path + ".htm"));
}

if (required.every(path => existsSync(join(root, path)))) {
  for (const source of walk(root).filter(path => htmlExtensions.has(extname(path).toLowerCase()))) {
    htmlFiles++;
    const contents = readHtml(source);
    for (const match of contents.matchAll(attributePattern)) {
      const raw = match[1] ?? match[2] ?? match[3] ?? "";
      const target = localTarget(source, raw);
      if (!target) continue;
      checkedLinks++;
      if (!existsAsWebTarget(target)) {
        failures.push(`${relative(root, source)} -> ${raw}`);
      }
    }
  }
}

if (failures.length) {
  console.error(`Reference audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Reference audit passed: ${htmlFiles} HTML files, ${checkedLinks} local links checked.`);
}
