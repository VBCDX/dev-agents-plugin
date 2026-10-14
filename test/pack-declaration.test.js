// This repo is the dev agent pack that the vbcdx installer (VBCDX/vbcdx) loads. vbcdx reads vbcdx-pack.json at the package root, then every
// role's role.json and prompt.md under roles_dir, and validates each role.json against
// its role schema, which allows no unknown keys. These checks keep the declaration and
// the files it names in step, so vbcdx can load this pack while the old installer in
// this repo keeps rendering the same roles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = JSON.parse(readFileSync(join(ROOT, "vbcdx-pack.json"), "utf8"));
const rolesDir = join(ROOT, pack.roles_dir);

// The keys vbcdx's role schema (schema/vbcdx-role.schema.json in VBCDX/vbcdx) allows.
const ROLE_KEYS = new Set([
  "schema_version", "id", "credential_suffix", "name", "description", "policy", "local_capabilities",
  "web_search", "remote_capabilities", "opencode_mode", "dependencies", "external_dependencies",
]);
const ROLE_REQUIRED = [
  "schema_version", "id", "credential_suffix", "name", "description", "policy", "local_capabilities",
  "web_search", "remote_capabilities", "opencode_mode",
];
const PACK_KEYS = new Set(["$schema", "schema_version", "name", "description", "roles_dir", "roles", "skills_dir", "contracts", "vars"]);

test("vbcdx-pack.json has only the keys the pack schema allows, and its required ones", () => {
  for (const k of Object.keys(pack)) assert.ok(PACK_KEYS.has(k), `unknown key ${k}`);
  for (const k of ["schema_version", "name", "roles_dir", "roles"]) assert.ok(k in pack, `missing ${k}`);
  assert.equal(pack.schema_version, 1);
});

test("the pack lists exactly the role directories it ships, each with role.json and prompt.md", () => {
  const dirs = readdirSync(rolesDir).filter((d) => statSync(join(rolesDir, d)).isDirectory()).sort();
  assert.deepEqual([...pack.roles].sort(), dirs);
  assert.equal(new Set(pack.roles).size, pack.roles.length, "no role is listed twice");
  for (const id of pack.roles) {
    assert.ok(existsSync(join(rolesDir, id, "role.json")), `${id}: role.json`);
    assert.ok(existsSync(join(rolesDir, id, "prompt.md")), `${id}: prompt.md`);
  }
});

test("every role.json fits vbcdx's role schema: known keys only, required keys present, id matches its directory", () => {
  for (const id of pack.roles) {
    const role = JSON.parse(readFileSync(join(rolesDir, id, "role.json"), "utf8"));
    for (const k of Object.keys(role)) assert.ok(ROLE_KEYS.has(k), `${id}: unknown key ${k}`);
    for (const k of ROLE_REQUIRED) assert.ok(k in role, `${id}: missing ${k}`);
    assert.equal(role.id, id);
    assert.equal(role.credential_suffix, id.toUpperCase().replace(/-/g, "_"), `${id}: credential_suffix`);
  }
});

// A prompt marks the regions a team's overlay may replace as slots, and
// names team-specific phrases as variables the pack declares with a neutral default. These
// are vbcdx's rules (src/overlays/overlay.js in VBCDX/vbcdx); a prompt that breaks one would
// fail to load there, so they are checked here, where the prompt is written.
const SLOT = /<!-- vbcdx:slot ([a-z0-9]+(?:-[a-z0-9]+)*) -->([\s\S]*?)<!-- \/vbcdx:slot -->/g;
const VAR = /\{\{vars\.([a-z][a-z0-9_]{0,63})\}\}/g;
const ONE_LINE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]{1,200}$/;

test("every slot in a prompt is well formed, named once and holds no other slot", () => {
  for (const id of pack.roles) {
    const prompt = readFileSync(join(rolesDir, id, "prompt.md"), "utf8");
    const names = [...prompt.matchAll(SLOT)].map((m) => m[1]);
    assert.equal(new Set(names).size, names.length, `${id}: a slot name repeats`);
    for (const m of prompt.matchAll(SLOT)) assert.doesNotMatch(m[2], /vbcdx:slot/, `${id}: slot ${m[1]} nests`);
    // Every marker belongs to a matched pair: none is left over once the pairs are removed.
    assert.doesNotMatch(prompt.replace(SLOT, ""), /vbcdx:slot/, `${id}: an unpaired or malformed slot marker`);
  }
});

test("every {{...}} in a prompt is a declared variable, and every declared variable is used", () => {
  const vars = pack.vars || {};
  for (const [name, v] of Object.entries(vars)) {
    assert.deepEqual(Object.keys(v).sort(), ["default", "description"], `vars.${name}: keys`);
    assert.match(v.default, ONE_LINE, `vars.${name}.default is one line of at most 200 characters`);
    assert.match(v.description, ONE_LINE, `vars.${name}.description is one line of at most 200 characters`);
  }
  const used = new Set();
  for (const id of pack.roles) {
    const prompt = readFileSync(join(rolesDir, id, "prompt.md"), "utf8");
    for (const m of prompt.matchAll(VAR)) {
      assert.ok(Object.hasOwn(vars, m[1]), `${id}: {{vars.${m[1]}}} is not declared in vbcdx-pack.json`);
      used.add(m[1]);
    }
    assert.doesNotMatch(prompt.replace(VAR, ""), /\{\{/, `${id}: a template placeholder that is not a declared variable`);
  }
  assert.deepEqual([...used].sort(), Object.keys(vars).sort(), "every declared variable is used by some prompt");
});

test("with no overlay a prompt reads as plain text: slots take their defaults, variables their values", () => {
  const vars = pack.vars || {};
  for (const id of pack.roles) {
    const prompt = readFileSync(join(rolesDir, id, "prompt.md"), "utf8");
    const plain = prompt.replace(SLOT, (_m, _name, def) => def).replace(VAR, (_m, name) => vars[name].default);
    assert.doesNotMatch(plain, /vbcdx:slot|\{\{/, id);
  }
});

test("the skills directory the pack names exists and holds skills", () => {
  const dir = join(ROOT, pack.skills_dir);
  assert.ok(existsSync(dir) && statSync(dir).isDirectory(), pack.skills_dir);
  assert.ok(readdirSync(dir, { recursive: true }).some((f) => /\.md$/i.test(String(f))), "at least one skill file");
});

// Two more rules the pack depends on.

test("every contract a role depends on, or keys remote_capabilities by, is listed in the pack's contracts", () => {
  const contracts = new Set(pack.contracts || []);
  const CONTRACT = /^[a-z0-9][a-z0-9.-]{0,62}\/[1-9][0-9]{0,3}$/; // vbcdx's contract shape
  for (const id of pack.roles) {
    const role = JSON.parse(readFileSync(join(rolesDir, id, "role.json"), "utf8"));
    for (const [service, contract] of Object.entries(role.dependencies || {})) {
      assert.ok(contracts.has(contract), `${id}: dependencies.${service} names ${contract}, which vbcdx-pack.json does not list`);
    }
    for (const key of Object.keys(role.remote_capabilities || {})) {
      if (CONTRACT.test(key)) assert.ok(contracts.has(key), `${id}: remote_capabilities names ${key}, which vbcdx-pack.json does not list`);
    }
  }
});

test("vbcdx loads the pack: its sixteen roles in order, each with a valid descriptor and a prompt", async () => {
  // vbcdx's own loader (vendored), which validates every role.json against its role schema.
  const { pack: loaded, CANONICAL_IDS } = await import("./pack.js");
  assert.equal(loaded.name, pack.name);
  assert.deepEqual([...CANONICAL_IDS], [...pack.roles]);
  assert.equal(CANONICAL_IDS.length, 16);
  for (const role of loaded.roles) assert.ok(role.prompt.length > 0 && role.descriptor.id === role.id, role.id);
});
