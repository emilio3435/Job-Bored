import assert from "node:assert/strict";
import { builtinModules, createRequire, stripTypeScriptTypes } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as acorn from "acorn";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = join(root, "integrations/browser-use-discovery/src");
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if ([".ts", ".js", ".mjs"].includes(extname(path))) yield path;
  }
}

function runtimeImports(path) {
  const source = acorn.parse(stripTypeScriptTypes(readFileSync(path, "utf8")), {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const imports = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") && node.source) {
      imports.push(node.source.value);
    } else if (node.type === "ImportExpression" && node.source.type === "Literal") {
      imports.push(node.source.value);
    } else if (node.type === "CallExpression" && node.callee.type === "Identifier" &&
      node.callee.name === "require" && node.arguments[0]?.type === "Literal") {
      imports.push(node.arguments[0].value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(source);
  return imports;
}

test("GFX-SOL-15 every external worker runtime import is an installed production dependency", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const missing = [];
  for (const path of sourceFiles(workerSource)) {
    for (const specifier of runtimeImports(path)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (builtins.has(name)) continue;
      const installed = lock.packages[`node_modules/${name}`];
      if (!manifest.dependencies?.[name] || !lock.packages[""].dependencies?.[name] ||
          !installed || installed.dev) {
        missing.push(`${path.slice(root.length + 1)}: ${specifier}`);
        continue;
      }
      assert.doesNotThrow(() => createRequire(path).resolve(specifier),
        `${path.slice(root.length + 1)}: ${specifier} must resolve`);
    }
  }
  assert.deepEqual(missing, []);
});
