// Explicit service bindings and portable manifest validation (spec 6.1).
//
// The optional VBCDX_AGENTS_INTEGRATIONS_FILE names one absolute, nonsecret
// JSON file describing which services are bound, where each service's exported
// manifest lives, and each role's explicit credential-file path. This module
// validates that file and the referenced manifests strictly and offline: it
// reads only these files, never interpolates, never runs a command supplied by
// configuration, and never reaches the network. Offline agreement proves
// interface compatibility only, not live registration.

import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseStrictJson } from "./json.js";
import { isCanonicalId, normalizeSuffix } from "../roles/registry.js";
import { configError, conflictError } from "../errors.js";

export const SERVICE_CONTRACT = Object.freeze({
  forgejo: "vbcdx.forgejo/1",
  coolify: "vbcdx.coolify/1",
});
const SUPPORTED_SERVICES = Object.keys(SERVICE_CONTRACT);
const VALID_EFFECTS = new Set(["read", "write", "destructive"]);

function assertAbsolute(label, value) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw configError(`${label} must be an absolute path.`);
  }
  return value;
}

function onlyKeys(obj, allowed, label) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw configError(`Unknown field ${JSON.stringify(k)} in ${label}.`);
  }
}

/**
 * Validate a service manifest object (as produced by `vbcdx-forgejo manifest`
 * or `vbcdx-coolify manifest`). Returns the sorted tool-name list.
 */
export function validateManifest(obj, service, source) {
  if (!obj || typeof obj !== "object") throw configError(`Manifest ${source} is not an object.`);
  onlyKeys(obj, ["schema_version", "service", "contract", "package_version", "tools"], `manifest ${source}`);
  if (obj.schema_version !== 1) throw conflictError(`Manifest ${source} has unsupported schema_version ${obj.schema_version}.`);
  if (obj.service !== service) throw conflictError(`Manifest ${source} declares service ${obj.service}, expected ${service}.`);
  if (obj.contract !== SERVICE_CONTRACT[service]) {
    throw conflictError(`Manifest ${source} declares contract ${obj.contract}, expected ${SERVICE_CONTRACT[service]}.`);
  }
  if (typeof obj.package_version !== "string" || obj.package_version === "") {
    throw configError(`Manifest ${source} is missing package_version.`);
  }
  if (!Array.isArray(obj.tools)) throw configError(`Manifest ${source} tools must be an array.`);
  const names = [];
  for (const tool of obj.tools) {
    if (!tool || typeof tool !== "object") throw configError(`Manifest ${source} has a non-object tool entry.`);
    for (const f of ["name", "description", "inputSchema", "outputSchema", "effect", "required_permissions"]) {
      if (!(f in tool)) throw configError(`Manifest ${source} tool is missing ${f}.`);
    }
    if (typeof tool.name !== "string" || tool.name === "") throw configError(`Manifest ${source} has a tool with no name.`);
    if (!VALID_EFFECTS.has(tool.effect)) throw configError(`Manifest ${source} tool ${tool.name} has invalid effect ${tool.effect}.`);
    if (!Array.isArray(tool.required_permissions)) throw configError(`Manifest ${source} tool ${tool.name} required_permissions must be an array.`);
    names.push(tool.name);
  }
  const sorted = [...names].sort();
  if (JSON.stringify(names) !== JSON.stringify(sorted)) {
    throw configError(`Manifest ${source} tools must be sorted by name.`);
  }
  if (new Set(names).size !== names.length) throw configError(`Manifest ${source} has duplicate tool names.`);
  return names;
}

function readJsonFile(absPath, label) {
  let raw;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (err) {
    throw configError(`Cannot read ${label}: ${absPath} (${err.code || "read error"}).`);
  }
  return parseStrictJson(raw, absPath);
}

/**
 * Load and validate the integrations file and every referenced manifest.
 * Validates structure and manifests globally; per-role credential-file access
 * is checked later against the selection.
 *
 * @returns {{services: Record<string, {serverName:string, manifestFile:string,
 *   contract:string, packageVersion:string, tools:string[],
 *   credentials: Record<string,string>}>}}
 */
export function loadIntegrations(absPath) {
  const root = readJsonFile(absPath, "integrations file");
  if (!root || typeof root !== "object") throw configError(`Integrations file ${absPath} is not an object.`);
  onlyKeys(root, ["schema_version", "services"], "integrations file");
  if (root.schema_version !== 1) throw conflictError(`Integrations file has unsupported schema_version ${root.schema_version}.`);
  if (!root.services || typeof root.services !== "object") throw configError("Integrations file has no services object.");

  const services = {};
  for (const [name, svc] of Object.entries(root.services)) {
    if (!SUPPORTED_SERVICES.includes(name)) throw configError(`Unknown service ${JSON.stringify(name)} in integrations file.`);
    if (!svc || typeof svc !== "object") throw configError(`Service ${name} must be an object.`);
    onlyKeys(svc, ["server_name", "manifest_file", "credentials"], `service ${name}`);
    if (svc.server_name !== name) {
      throw configError(`Service ${name} server_name must be exactly "${name}".`);
    }
    const manifestFile = assertAbsolute(`service ${name} manifest_file`, svc.manifest_file);
    const manifestObj = readJsonFile(manifestFile, `${name} manifest`);
    const tools = validateManifest(manifestObj, name, manifestFile);

    const credentials = {};
    const creds = svc.credentials || {};
    if (typeof creds !== "object") throw configError(`Service ${name} credentials must be an object.`);
    const normalizedSeen = new Map();
    for (const [roleId, credPath] of Object.entries(creds)) {
      if (!isCanonicalId(roleId)) throw configError(`Service ${name} credential role ${JSON.stringify(roleId)} is not a canonical agent ID.`);
      const norm = normalizeSuffix(roleId.toUpperCase().replace(/-/g, "_"));
      if (normalizedSeen.has(norm)) throw configError(`Service ${name} has ambiguous credential role keys for ${roleId}.`);
      normalizedSeen.set(norm, roleId);
      credentials[roleId] = assertAbsolute(`service ${name} credential path for ${roleId}`, credPath);
    }
    services[name] = {
      serverName: name,
      manifestFile,
      contract: manifestObj.contract,
      packageVersion: manifestObj.package_version,
      tools,
      credentials,
    };
  }
  return { services };
}
