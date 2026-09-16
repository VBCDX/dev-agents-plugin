// Skills catalogue (issue #6).
//
// A read-only catalogue of skill documents, organised into a fixed set of
// category folders and served over HTTP by the same server as the A2A cards.
// Repo layout, mirrored one-to-one by the URL:
//
//   skills/<category-slug>/<NAME>.MD   ->   /skills/<category-slug>/<NAME>.MD
//   skills/<document>.md               ->   /skills/<document>.md   (e.g. CONTEXT.example.md)
//
// SECURITY — the highest-risk property of this feature. The endpoint is public
// and both path segments are attacker-controlled. They are NEVER joined onto a
// filesystem path at request time. At load time we walk ONLY the committed tree
// (category folders gated by the fixed CATEGORIES allowlist, filenames gated by
// strict regexes) and build an in-memory manifest whose absolute paths were
// computed from trusted directory entries. A request resolves a document by
// looking its exact segments up as KEYS in that manifest — a traversal,
// encoded, over-long, null-byte, absolute, or wrong-case segment simply misses
// the map and 404s, exactly as the /agents/ canonical-id allowlist does.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// The committed catalogue root. Shipped in the npm package (package.json files).
export const SKILLS_DIR = join(here, "..", "..", "skills");

// Media type for a served skill document.
export const MARKDOWN_MEDIA_TYPE = "text/markdown";

// The eight categories are a FIXED set, confirmed with the user (issue #6). No
// other category exists; a folder whose slug is not one of these is ignored, so
// dropping a stray directory into skills/ can never publish a new category. The
// slug is the URL-safe path segment; the name is the display label.
export const CATEGORIES = Object.freeze([
  Object.freeze({ slug: "development", name: "Development" }),
  Object.freeze({ slug: "productivity", name: "Productivity" }),
  Object.freeze({ slug: "learning", name: "Learning" }),
  Object.freeze({ slug: "security", name: "Security" }),
  Object.freeze({ slug: "data-analytics", name: "Data & Analytics" }),
  Object.freeze({ slug: "integration", name: "Integration" }),
  Object.freeze({ slug: "testing", name: "Testing" }),
  Object.freeze({ slug: "documentation", name: "Documentation" }),
]);

// A skill filename is the uppercased skill name plus an uppercase `.MD`, e.g.
// VBCDX-ISSUES.MD. This is the canonical form the user specified; the router is
// case-sensitive, so no other casing resolves.
const SKILL_FILE_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*\.MD$/;

// A top-level catalogue document (directly under skills/, not in a category)
// is a markdown file, e.g. CONTEXT.example.md. Kept deliberately permissive on
// the stem so shared templates can carry a natural name, but still no path
// separators and a markdown extension only.
const TOPLEVEL_DOC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

let manifest = null;

/**
 * Build the manifest by walking the committed tree once. Structure:
 *   bySlug:    Map<slug, { slug, name, skills: Map<file, { name, file, content }> }>
 *   documents: Map<file, { file, content }>
 * The category order follows CATEGORIES; skills and documents are sorted by name
 * so every index is deterministic.
 */
function build() {
  const bySlug = new Map();
  for (const { slug, name } of CATEGORIES) {
    const skills = new Map();
    const dir = join(SKILLS_DIR, slug);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      for (const entry of readdirSync(dir).sort()) {
        if (!SKILL_FILE_RE.test(entry)) continue;
        const full = join(dir, entry);
        if (!statSync(full).isFile()) continue;
        const nm = entry.slice(0, -3); // strip ".MD"
        skills.set(entry, Object.freeze({ name: nm, file: entry, content: readFileSync(full, "utf8") }));
      }
    }
    bySlug.set(slug, { slug, name, skills });
  }

  const documents = new Map();
  if (existsSync(SKILLS_DIR)) {
    for (const entry of readdirSync(SKILLS_DIR).sort()) {
      if (!TOPLEVEL_DOC_RE.test(entry)) continue;
      const full = join(SKILLS_DIR, entry);
      if (!existsSync(full) || !statSync(full).isFile()) continue;
      documents.set(entry, Object.freeze({ file: entry, content: readFileSync(full, "utf8") }));
    }
  }

  return { bySlug, documents };
}

function catalogue() {
  if (!manifest) manifest = build();
  return manifest;
}

/** Reset the cached manifest. Test-only; the tree is immutable at runtime. */
export function _resetCatalogue() {
  manifest = null;
}

function trimTrailingSlash(url) {
  return String(url).replace(/\/+$/, "");
}

/**
 * The document for an exact (category-slug, filename) pair, or undefined. Both
 * arguments are looked up as manifest keys — never used as a path.
 */
export function getSkillDoc(categorySlug, filename) {
  const cat = catalogue().bySlug.get(categorySlug);
  if (!cat) return undefined;
  return cat.skills.get(filename);
}

/** A top-level catalogue document by exact filename, or undefined. */
export function getTopLevelDoc(filename) {
  return catalogue().documents.get(filename);
}

/**
 * The index for one category (the listing served at /skills/<slug>/), or
 * undefined for an unknown slug. Lists that category's skills with resolvable
 * URLs so a consumer can enumerate without guessing names.
 */
export function getCategoryIndex(categorySlug, baseUrl) {
  const cat = catalogue().bySlug.get(categorySlug);
  if (!cat) return undefined;
  const base = trimTrailingSlash(baseUrl);
  return {
    category: { slug: cat.slug, name: cat.name },
    skills: [...cat.skills.values()].map((s) => ({
      name: s.name,
      file: s.file,
      url: `${base}/skills/${cat.slug}/${s.file}`,
    })),
  };
}

/**
 * The catalogue index served at /skills/ — all eight categories (with a skill
 * count, listed even when empty so the catalogue is discoverable) plus the
 * top-level documents (e.g. the context template).
 */
export function buildCatalogueIndex(baseUrl) {
  const base = trimTrailingSlash(baseUrl);
  const cat = catalogue();
  return {
    categories: CATEGORIES.map(({ slug, name }) => ({
      slug,
      name,
      url: `${base}/skills/${slug}/`,
      count: cat.bySlug.get(slug).skills.size,
    })),
    documents: [...cat.documents.values()].map((d) => ({
      file: d.file,
      url: `${base}/skills/${d.file}`,
    })),
  };
}

/**
 * Every shipped document (skills + top-level), as { relPath, content }. Used by
 * the secret-scan test to assert no served file leaks internal detail.
 */
export function allDocuments() {
  const out = [];
  const cat = catalogue();
  for (const { slug } of CATEGORIES) {
    for (const s of cat.bySlug.get(slug).skills.values()) {
      out.push({ relPath: `${slug}/${s.file}`, content: s.content });
    }
  }
  for (const d of cat.documents.values()) {
    out.push({ relPath: d.file, content: d.content });
  }
  return out;
}
