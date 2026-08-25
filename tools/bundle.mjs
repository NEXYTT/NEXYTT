/**
 * Single-file bundler.
 *
 * Inlines a page's stylesheets and resolves its ES module graph into one
 * self-contained HTML document, so a page that normally needs a web server can
 * be opened from anywhere — including inside a sandbox that cannot fetch
 * sibling files.
 *
 * This is deliberately not a general-purpose bundler. It handles exactly the
 * syntax this project uses, which a survey of the source confirms is narrow:
 * named imports only, and top-level `export` declarations. Anything outside
 * that throws rather than emitting something subtly wrong.
 *
 *   node tools/bundle.mjs casino/dice.html > out.html
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

/** Named-import statement, possibly spanning several lines. */
const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?\s*$/gm;
/** Anything else that starts a line with `import` — unsupported, and worth failing on. */
const OTHER_IMPORT_RE = /^import\s+(?!\{)/gm;

/** `export { a, b };` */
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;
/** `export const x`, `export function f`, `export class C`, `export async function f` */
const EXPORT_DECL_RE = /^export\s+(async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
/** `export const { a, b } = ...` — destructured, which this bundler does not support. */
const EXPORT_DESTRUCTURE_RE = /^export\s+(const|let|var)\s*[[{]/m;

/** Module id used in the emitted registry: the path relative to the repo root. */
const idOf = (absolutePath) => relative(ROOT, absolutePath);

/**
 * Read a module, rewrite its imports and exports, and report its dependencies.
 * @returns {{code: string, deps: string[], exports: string[]}}
 */
async function transform(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  const here = dirname(absolutePath);
  const deps = [];

  if (EXPORT_DESTRUCTURE_RE.test(source)) {
    throw new Error(`${idOf(absolutePath)}: destructured export is not supported`);
  }

  let code = source.replace(IMPORT_RE, (_match, names, specifier) => {
    const target = resolve(here, specifier);
    deps.push(idOf(target));
    // `a, b as c` becomes `a, b: c` — the object-destructuring equivalent.
    const bindings = names
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/\s+as\s+/, ": "))
      .join(", ");
    return `const { ${bindings} } = __req(${JSON.stringify(idOf(target))});`;
  });

  const unsupported = code.match(OTHER_IMPORT_RE);
  if (unsupported) {
    throw new Error(`${idOf(absolutePath)}: only named imports are supported, found ${unsupported[0].trim()}`);
  }

  const exported = new Set();

  code = code.replace(EXPORT_LIST_RE, (_match, names) => {
    for (const entry of names.split(",").map((s) => s.trim()).filter(Boolean)) {
      // `a as b` re-exports under the new name.
      const [local, exposed = local] = entry.split(/\s+as\s+/).map((s) => s.trim());
      exported.add(`${JSON.stringify(exposed)}: ${local}`);
    }
    return "";
  });

  code = code.replace(EXPORT_DECL_RE, (_match, kind, name) => {
    exported.add(`${JSON.stringify(name)}: ${name}`);
    return `${kind} ${name}`;
  });

  if (/^export\s/m.test(code)) {
    throw new Error(`${idOf(absolutePath)}: unhandled export form near "${code.match(/^export\s.*/m)[0]}"`);
  }

  return { code, deps, exports: [...exported] };
}

/** Depth-first walk producing dependencies before the modules that need them. */
async function collect(entryPath) {
  const modules = new Map();
  const visiting = new Set();

  async function walk(absolutePath) {
    const id = idOf(absolutePath);
    if (modules.has(id)) return;
    if (visiting.has(id)) {
      // Nothing in this project imports in a cycle; if that changes, the
      // dependency-first emission below would no longer be valid.
      throw new Error(`circular import involving ${id}`);
    }
    visiting.add(id);

    const module = await transform(absolutePath);
    for (const dep of module.deps) await walk(resolve(ROOT, dep));

    visiting.delete(id);
    modules.set(id, module);
  }

  await walk(entryPath);
  return modules;
}

/** Inline every stylesheet the page links, in order. */
async function inlineStyles(html, pageDir) {
  const links = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g)];
  let out = html;
  for (const [tag, href] of links) {
    const css = await readFile(resolve(pageDir, href), "utf8");
    const style = `<style data-from="${href}">\n${css}\n</style>`;
    // Function replacement, not string: in a replacement string `$&`, `$\``,
    // `$'` and `$$` are substitution patterns, and CSS and JavaScript are both
    // full of `$`. A string replacement here silently corrupts the output.
    out = out.replace(tag, () => style);
  }
  return out;
}

export async function bundlePage(pagePath) {
  const absolutePage = resolve(ROOT, pagePath);
  const pageDir = dirname(absolutePage);
  let html = await readFile(absolutePage, "utf8");

  html = await inlineStyles(html, pageDir);

  const scriptTag = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/);
  if (!scriptTag) throw new Error(`${pagePath}: no module script to bundle`);

  const entryPath = resolve(pageDir, scriptTag[1]);
  const modules = await collect(entryPath);

  const body = [...modules.entries()]
    .map(([id, module]) => {
      const exportsObject = module.exports.length ? `{ ${module.exports.join(", ")} }` : "{}";
      return `__def(${JSON.stringify(id)}, function (__req) {\n${module.code}\nreturn ${exportsObject};\n});`;
    })
    .join("\n\n");

  const runtime = `
// --- Bundled by tools/bundle.mjs. Modules are emitted dependency-first, so a
// --- module's requirements are always already evaluated when it runs.
const __registry = Object.create(null);
function __req(id) {
  if (!(id in __registry)) throw new Error("module not bundled: " + id);
  return __registry[id];
}
function __def(id, factory) { __registry[id] = factory(__req); }
`;

  const inlineScript = `<script type="module">\n${runtime}\n${body}\n</script>`;
  // Function replacement for the same reason as above — the bundled source is
  // dense with `$`, and `$'` alone would splice the rest of the document into
  // the middle of the script.
  return html.replace(scriptTag[0], () => inlineScript);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error("uso: node tools/bundle.mjs <pagina.html>");
    process.exit(1);
  }
  process.stdout.write(await bundlePage(target));
}
