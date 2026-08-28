#!/usr/bin/env node
// PortPilot contract validator.
//
// This is a HARNESS, not an agent: it decides pass/fail in code, so no agent can
// talk its way past a gate. The orchestrator and CI both call it.
//
//   node contracts/validate.js <file.json> [schema]
//   node contracts/validate.js runs/demo/plan.json
//   node contracts/validate.js runs/demo/          (validates every known artifact)
//
// Exit code 0 = valid, 1 = invalid, 2 = usage or internal error.

const fs = require("fs");
const path = require("path");
const { validateSemantics, validateRunDirectory } = require("./semantic");

let Ajv;
try {
  Ajv = require("ajv/dist/2020");
} catch {
  console.error("Missing dependency 'ajv'. Run: npm install --prefix contracts");
  process.exit(2);
}

const CONTRACTS = __dirname;
// Discovered from disk rather than hardcoded: build.json and runtime.json silently
// skipped validation for an entire run because a schema existed conceptually but was
// never added to a list like this one. Dropping a *.schema.json file in is now enough.
const SCHEMAS = fs
  .readdirSync(CONTRACTS)
  .filter((f) => f.endsWith(".schema.json"))
  .sort();

// Artifact filename -> schema, so a whole run directory can be validated at once.
const ARTIFACT_MAP = {
  "analysis.json": "analysis.schema.json",
  "plan.json": "plan.schema.json",
  "review.json": "review.schema.json",
  "purity.json": "finding.schema.json",
  "build.json": "build.schema.json",
  "runtime.json": "runtime.schema.json",
  "run.json": "run.schema.json",
  "handoff.json": "handoff.schema.json",
  "release.json": "release.schema.json",
  "candidates.json": null,
};

const ajv = new Ajv({ strict: false, allErrors: true });
for (const s of SCHEMAS) {
  ajv.addSchema(JSON.parse(fs.readFileSync(path.join(CONTRACTS, s), "utf8")), s);
}

function validateFile(file, schemaName, { explicit = false } = {}) {
  const base = path.basename(file);
  const schema = schemaName || ARTIFACT_MAP[base];

  if (!schema) {
    // Inside a run directory an unrecognised file is noise. But if a caller pointed
    // the harness at one file and we cannot tell what it should conform to, staying
    // silent would report VALID for something that was never checked.
    if (explicit) {
      console.error(
        `cannot infer a schema for '${base}'.\n` +
          `Pass one explicitly:  node contracts/validate.js ${file} <schema>\n` +
          `Known schemas: ${SCHEMAS.join(", ")}`
      );
      process.exit(2);
    }
    console.log(`  SKIP  ${base} (no schema registered)`);
    return true;
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`  FAIL  ${base} - not parseable JSON: ${e.message}`);
    return false;
  }

  const validate = ajv.getSchema(schema);
  if (!validate) {
    console.log(`  FAIL  ${base} - unknown schema '${schema}'`);
    return false;
  }

  if (validate(doc)) {
    const semanticErrors = validateSemantics(schema, doc);
    if (semanticErrors.length > 0) {
      console.log(`  FAIL  ${base} against semantic gates`);
      for (const error of semanticErrors) console.log(`          ${error}`);
      return false;
    }
    console.log(`  OK    ${base} against ${schema}`);
    return true;
  }

  console.log(`  FAIL  ${base} against ${schema}`);
  for (const e of validate.errors) {
    console.log(`          ${e.instancePath || "(root)"} ${e.message}`);
  }
  return false;
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node contracts/validate.js <file.json|directory> [schema]");
  process.exit(2);
}
if (!fs.existsSync(arg)) {
  console.error(`no such file or directory: ${arg}`);
  process.exit(2);
}

let ok = true;
if (fs.statSync(arg).isDirectory()) {
  const files = fs.readdirSync(arg).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`no .json artifacts in ${arg}`);
    process.exit(2);
  }
  const documents = {};
  for (const f of files) {
    ok = validateFile(path.join(arg, f), null) && ok;
    try {
      documents[f] = JSON.parse(fs.readFileSync(path.join(arg, f), "utf8"));
    } catch {
      // The schema pass already reports parse errors.
    }
  }
  const semanticErrors = validateRunDirectory(arg, documents);
  if (semanticErrors.length > 0) {
    ok = false;
    console.log("  FAIL  run directory against cross-artifact semantic gates");
    for (const error of semanticErrors) console.log(`          ${error}`);
  }
} else {
  ok = validateFile(arg, process.argv[3], { explicit: true });
}

console.log(ok ? "\nVALID" : "\nINVALID");
process.exit(ok ? 0 : 1);
