#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("../contracts/node_modules/ajv/dist/2020");

const root = path.resolve(__dirname, "..");
const skillsRoot = path.join(root, ".github", "skills");
const fixturesRoot = path.join(__dirname, "fixtures");
const goldenRoot = path.join(__dirname, "golden");
const minimumRecall = 0.8;
const maximumFalsePositiveRate = 0.2;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function parseFrontmatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end < 0) return {};

  return Object.fromEntries(
    lines
      .slice(1, end)
      .map((line) => line.match(/^([a-z-]+):\s*"?(.+?)"?$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
}

function validateSkillShape(skill) {
  const skillDirectory = path.join(skillsRoot, skill);
  const skillPath = path.join(skillDirectory, "SKILL.md");
  const markdown = fs.readFileSync(skillPath, "utf8");
  const frontmatter = parseFrontmatter(markdown);
  const failures = [];

  if (frontmatter.name !== skill) failures.push(`frontmatter name must be '${skill}'`);
  // The description is the routing signal: an agent picks the skill from this
  // text alone, so it must state an explicit trigger. Accept stage-qualified
  // forms ("Use at S5 when ...", "Use in S7 when ...") as well as a bare
  // "Use when ..." — naming the stage is strictly more useful, not less.
  if (!/\bUse\b[^.]*\bwhen\b/i.test(frontmatter.description ?? "")) {
    failures.push("description must include an explicit 'Use ... when' routing clause");
  }

  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|#)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(skillDirectory, target))) {
      failures.push(`broken local link: ${target}`);
    }
  }

  return failures;
}

function scanFixture(skill, fixtureName, rules) {
  const fixtureDirectory = path.join(fixturesRoot, skill, fixtureName);
  const observed = [];

  for (const file of walk(fixtureDirectory)) {
    const relative = path.relative(fixtureDirectory, file).replaceAll("\\", "/");
    const extension = path.extname(file).toLowerCase();
    const contents = fs.readFileSync(file, "utf8");
    const lines = contents.split(/\r?\n/);

    for (const rule of rules) {
      if (rule.extensions.length > 0 && !rule.extensions.includes(extension)) continue;
      if (rule.detector) {
        for (const finding of scanStructuredRule(contents, lines, rule, file)) {
          observed.push({ ...finding, ruleId: rule.id, file: relative, rule });
        }
        continue;
      }
      const expression = new RegExp(rule.pattern, rule.flags ?? "");
      lines.forEach((line, index) => {
        expression.lastIndex = 0;
        if (expression.test(line)) {
          observed.push({
            ruleId: rule.id,
            file: relative,
            line: index + 1,
            evidence: line.trim(),
            rule
          });
        }
      });
    }
  }

  return observed;
}

function scanStructuredRule(contents, lines, rule, filePath) {
  const identities = [];
  let pattern;
  if (rule.detector === "vctools-version-mismatch") {
    pattern = /(?:vcpkg|MSBuild)\s+VCToolsVersion\s*=\s*([^;\s]+)/giu;
  } else if (rule.detector === "msvc-root-mismatch") {
    pattern =
      /resolved\s+(?:cl|link|LIB path|INCLUDE path)\s*=\s*[^\r\n;]*?[\\/]VC[\\/]Tools[\\/]MSVC[\\/]([^\\/\s;]+)/giu;
  } else if (rule.detector === "utf8-source-without-bom") {
    return scanUtf8WithoutBom(lines, filePath);
  } else if (rule.detector === "mixed-host-toolchain") {
    return scanMixedHostToolchain(contents, lines);
  } else if (rule.detector === "unasserted-host-toolchain-pin") {
    return scanUnassertedHostPin(contents, lines);
  } else if (rule.detector === "package-e2e-missing") {
    return scanPackageE2eMissing(contents, lines);
  } else if (rule.detector === "empty-required-directory") {
    return scanEmptyRequiredDirectory(contents, lines);
  } else if (rule.detector === "x86-token-without-arm64-companion") {
    return scanX86TokenWithoutArm64Companion(contents, lines, rule);
  } else if (rule.detector === "arch-payload-write") {
    return scanArchPayloadWrite(contents, lines);
  } else if (rule.detector === "undocumented-platform-exclusion") {
    return scanUndocumentedPlatformExclusion(lines);
  } else if (rule.detector === "arch-guarded-stub") {
    return scanArchGuardedStub(lines);
  } else if (rule.detector === "vacuous-test-success") {
    return scanVacuousTestSuccess(contents, lines);
  } else {
    throw new Error(`Unsupported structured detector '${rule.detector}'`);
  }

  for (const match of contents.matchAll(pattern)) {
    identities.push({
      value: match[1].toLowerCase(),
      offset: match.index,
      line: contents.slice(0, match.index).split(/\r?\n/).length
    });
  }
  if (identities.length < 2) return [];
  const expected = identities[0].value;
  const mismatch = identities.find((identity) => identity.value !== expected);
  if (!mismatch) return [];
  return [{ line: mismatch.line, evidence: lines[mismatch.line - 1].trim() }];
}

// MSVC decodes a source as UTF-8 only when it starts with a UTF-8 BOM, so a
// BOM-less file whose bytes are valid UTF-8 is read with the active code page.
// Files that are not valid UTF-8 are genuine ANSI sources and decode correctly.
function scanUtf8WithoutBom(lines, filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return [];
  }
  const index = bytes.findIndex((byte) => byte > 0x7f);
  if (index === -1) return [];
  if (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) return [];

  const line = bytes.subarray(0, index).toString("utf8").split(/\r?\n/).length;
  return [{ line, evidence: (lines[line - 1] ?? "").trim() }];
}

// A PreferredToolArchitecture pin is a request, not a guarantee.
// Microsoft.Cpp.ToolsetLocation.props declares the property TreatAsLocalProperty,
// so imported props may reassign a value supplied on the command line, and a
// preflight probe reports the compiler that resolves rather than the one that
// runs. Only the invoked command lines in the build log settle it.
function scanUnassertedHostPin(contents, lines) {
  const pin = /PreferredToolArchitecture/iu;
  if (!pin.test(contents)) return [];
  if (/Assert-[A-Za-z]*Toolchain|was invoked \d+ time/iu.test(contents)) return [];

  const index = lines.findIndex((line) => pin.test(line));
  if (index === -1) return [];
  return [{ line: index + 1, evidence: lines[index].trim() }];
}

// MSBuild may satisfy one target architecture from either the native or the
// cross host toolchain. Sources whose behaviour depends on the ambient code
// page compile under one flavour and fail under the other, so a build that
// mixes flavours is green by accident rather than by construction.
function scanMixedHostToolchain(contents, lines) {
  const byTarget = new Map();

  for (const match of contents.matchAll(/bin[\\/]Host([A-Za-z0-9]+)[\\/]([A-Za-z0-9]+)[\\/]/giu)) {
    const target = match[2].toLowerCase();
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push({
      host: match[1].toLowerCase(),
      line: contents.slice(0, match.index).split(/\r?\n/).length
    });
  }

  const findings = [];
  for (const entries of byTarget.values()) {
    const counts = new Map();
    for (const entry of entries) counts.set(entry.host, (counts.get(entry.host) ?? 0) + 1);
    if (counts.size < 2) continue;

    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const minority = entries.find((entry) => entry.host !== majority);
    findings.push({ line: minority.line, evidence: lines[minority.line - 1].trim() });
  }

  return findings;
}

// Re-expanding and scanning an archive proves architecture purity only. A
// missing runtime dependency or a required directory that compression dropped
// is invisible until a binary from the expanded tree is actually executed. A
// script that surfaces the expanded root to its caller is exempt, because the
// runnability gate can legitimately live in the calling workflow.
function scanPackageE2eMissing(contents, lines) {
  const index = lines.findIndex((line) => /Expand-Archive/iu.test(line));
  if (index === -1) return [];

  const destination = lines[index].match(
    /-DestinationPath\s+"?\$([A-Za-z_][A-Za-z0-9_]*)/iu
  );
  if (!destination) return [];

  const variable = destination[1];
  const executes = new RegExp(
    `(?:^|[\\s|(])&\\s*"?\\$${variable}\\b|Start-Process[^\\r\\n]*\\$${variable}\\b`,
    "imu"
  );
  if (executes.test(contents)) return [];

  const surfacedToCaller = new RegExp(
    `^\\s*[A-Za-z][A-Za-z0-9_]*\\s*=\\s*\\$${variable}\\s*$|return\\s+[^\\r\\n]*\\$${variable}\\b`,
    "imu"
  );
  if (surfacedToCaller.test(contents)) return [];

  return [{ line: index + 1, evidence: lines[index].trim() }];
}

// A ZIP archive cannot store an empty directory, so a staged directory that
// never receives a file is silently absent from the shipped package.
function scanEmptyRequiredDirectory(contents, lines) {
  if (!/Compress-Archive/iu.test(contents)) return [];

  const findings = [];
  lines.forEach((line, index) => {
    const created = line.match(/New-Item\s+[^\r\n]*-ItemType\s+Directory[^\r\n]*?["']([^"']+)["']/iu);
    if (!created) return;

    const escaped = created[1].replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
    const writesAFile = new RegExp(
      `(?:Copy-Item|Set-Content|Out-File|New-Item\\s+[^\\r\\n]*-ItemType\\s+File)[^\\r\\n]*${escaped}[\\\\/]`,
      "iu"
    );
    if (!writesAFile.test(contents)) findings.push({ line: index + 1, evidence: line.trim() });
  });

  return findings;
}

// A branch on an x86 architecture macro is only a defect when nothing answers
// it. `_M_X64` beside an `_M_ARM64` arm is a correctly ported file, and the
// same reasoning applies to a dependency manifest that already names an arm64
// payload. The rule supplies both the token it looks for and the companion
// that exonerates the file, so it reports the file rather than every line.
function scanX86TokenWithoutArm64Companion(contents, lines, rule) {
  if (new RegExp(rule.companion, "iu").test(contents)) return [];

  const token = new RegExp(rule.pattern, "iu");
  const index = lines.findIndex((line) => token.test(line));
  if (index === -1) return [];
  return [{ line: index + 1, evidence: lines[index].trim() }];
}

// A tool that writes instructions into another process encodes them as data.
// 0xCC is a one-byte x86 int3; the ARM64 breakpoint is a four-byte BRK #0. The
// literal survives a clean ARM64 compile and corrupts the target at runtime,
// and these constants rarely name an architecture in their identifier. A file
// that already carries an ARM64 branch is exempt, because there the x86 value
// is one arm of a working abstraction rather than an assumption.
function scanArchPayloadWrite(contents, lines) {
  const writesRemotely = /\bWriteProcessMemory\s*\(|\bFlushInstructionCache\s*\(/u;
  if (!writesRemotely.test(contents)) return [];
  if (/\b_M_ARM64(?:EC)?\b|\b__aarch64__\b/u.test(contents)) return [];

  const opcode = /\b0x(?:CC|cc|CD|cd|90)\b/u;
  const index = lines.findIndex((line) => opcode.test(line));
  if (index === -1) return [];
  return [{ line: index + 1, evidence: lines[index].trim() }];
}

// Excluding the project that fails is the cheapest way to make a build green.
// It is legitimate exactly when it is a recorded decision, so an exclusion
// carrying an adjacent reason is exempt and a bare one is not.
function scanUndocumentedPlatformExclusion(lines) {
  const findings = [];

  lines.forEach((line, index) => {
    if (!/<ExcludedFromBuild[^>]*>\s*true/iu.test(line)) return;

    const preceding = lines.slice(Math.max(0, index - 3), index).join("\n");
    const documented =
      /<!--[\s\S]*?(?:unsupported|not supported|excluded because|reason\s*:)/iu;
    if (documented.test(preceding)) return;

    findings.push({ line: index + 1, evidence: line.trim() });
  });

  return findings;
}

// The most expensive silent loss compiles, links, ships, and passes every test
// that does not exercise the path: functionality replaced by a placeholder
// behind an architecture guard.
function scanArchGuardedStub(lines) {
  const marker = /TODO|FIXME|not\s+(?:yet\s+)?(?:implemented|supported)|NotImplemented|\bstubbed?\b/iu;
  const findings = [];

  lines.forEach((line, index) => {
    if (!/\b_M_ARM64(?:EC)?\b|\b__aarch64__\b/u.test(line)) return;
    if (!lines.slice(index + 1, index + 4).some((body) => marker.test(body))) return;
    findings.push({ line: index + 1, evidence: line.trim() });
  });

  return findings;
}

// A runner that executed nothing also exits zero, so an exit-code gate cannot
// distinguish a passing suite from a suite that never ran. Only a step that
// asserts the executed count, and that executed equals passed, can.
function scanVacuousTestSuccess(contents, lines) {
  // Test runners this detector understands. Originally MSVC/.NET only, which made the rule
  // structurally unable to fire on Rust, CMake, Python, Go or Node projects; lacy's cargo-based
  // workflow shipped two vacuous steps straight past it. See references/vacuous-green.md.
  const invokesTests =
    /vstest|gtest|dotnet\s+test|[A-Za-z0-9_.]*[Tt]ests?\.exe|--gtest_output|cargo\s+test|ctest\b|pytest\b|go\s+test\b|npm\s+(?:run\s+)?test\b|swift\s+test\b/u;
  if (!invokesTests.test(contents)) return [];

  const assertsCounts =
    /\b(?:ran|executed|total|testcount)\b[^\r\n]*-(?:eq|le|lt)\s*0|\b(?:ran|executed|total)\b[^\r\n]*-ne[^\r\n]*\b(?:passed|succeeded)\b|\b(?:passed|succeeded)\b[^\r\n]*-ne[^\r\n]*\b(?:ran|executed|total)\b|test\s+result:|--fail-on-empty|0\s+tests?\s+(?:run|executed)/iu;
  if (assertsCounts.test(contents)) return [];

  // A name filter that matches nothing still exits 0, so a filtered invocation with no count
  // assertion is vacuous whether or not an exit code is compared explicitly.
  const nameFilter =
    /--\s*ignored\s+\S|--gtest_filter=|--filter\s+\S|-k\s+\S|--exact\b|--run\s+\S/u;

  // Anchor on lines that actually invoke tests. Reporting the first exit-code check anywhere in
  // the file points at whatever unrelated assertion happens to come first — in this repo's own
  // CI that was a purity-gate check three steps below the test step.
  const testLines = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => invokesTests.test(entry.line));
  if (testLines.length === 0) return [];

  const filtered = testLines.find((entry) => nameFilter.test(entry.line));
  if (filtered) return [{ line: filtered.index + 1, evidence: filtered.line.trim() }];

  // An explicit gate counts only when it plausibly gates one of those invocations.
  const gate = /\$LASTEXITCODE\s*-(?:ne|eq)\s*0|\bExitCode\s*-(?:ne|eq)\s*0/iu;
  for (const entry of testLines) {
    const limit = Math.min(entry.index + 3, lines.length - 1);
    for (let cursor = entry.index + 1; cursor <= limit; cursor++) {
      if (gate.test(lines[cursor])) {
        return [{ line: cursor + 1, evidence: lines[cursor].trim() }];
      }
    }
  }

  // Implicit gate: a CI step that invokes tests and is graded solely on the step's exit status.
  // There is no exit-code text to match in that shape, which is precisely why it was invisible.
  const ciStep = testLines.find((entry) => /^\s*(?:-\s*)?run:\s*\S/u.test(entry.line));
  if (ciStep) return [{ line: ciStep.index + 1, evidence: ciStep.line.trim() }];

  return [];
}

function findingEnvelope(skill, observed) {
  const summary = { blockers: 0, high: 0, medium: 0, low: 0, info: 0 };
  const findings = observed.map(({ file, line, evidence, rule }) => {
    summary[rule.severity === "blocker" ? "blockers" : rule.severity] += 1;
    return {
      id: rule.id,
      file,
      line,
      evidence,
      category: rule.category,
      severity: rule.severity,
      explanation: rule.explanation,
      recommendation: rule.recommendation,
      arm64Impact: rule.arm64Impact,
      effort: rule.effort,
      confidence: rule.confidence
    };
  });

  return {
    skill,
    schemaVersion: "1.0",
    target: {
      repo: `fixture/${skill}`,
      commit: "0000000000000000000000000000000000000000"
    },
    findings,
    summary
  };
}

const ajv = new Ajv({ strict: false, allErrors: true });
const findingSchema = JSON.parse(
  fs.readFileSync(path.join(root, "contracts", "finding.schema.json"), "utf8")
);
const validateEnvelope = ajv.compile(findingSchema);

let failed = false;
const goldenFiles = fs.readdirSync(goldenRoot).filter((name) => name.endsWith(".json")).sort();
const skillDirectories = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const goldenSkills = new Set(
  goldenFiles.map((file) => JSON.parse(fs.readFileSync(path.join(goldenRoot, file), "utf8")).skill)
);

// A skill that ships machine-readable detection rules must prove they work: no
// patterns/rules.json may ship without a golden evaluation. Prose-only
// playbooks have nothing mechanical to score, so they are reported as
// unevaluated rather than failed.
const unevaluated = [];
for (const skill of skillDirectories) {
  if (goldenSkills.has(skill)) continue;
  if (fs.existsSync(path.join(skillsRoot, skill, "patterns", "rules.json"))) {
    console.log(`FAIL ${skill}: ships patterns/rules.json with no golden evaluation file`);
    failed = true;
  } else {
    unevaluated.push(skill);
  }
}
if (unevaluated.length > 0) {
  console.log(`INFO prose-only skills (no detection rules to score): ${unevaluated.join(", ")}`);
}

for (const goldenFile of goldenFiles) {
  const golden = JSON.parse(fs.readFileSync(path.join(goldenRoot, goldenFile), "utf8"));
  const skill = golden.skill;
  const rules = JSON.parse(
    fs.readFileSync(path.join(skillsRoot, skill, "patterns", "rules.json"), "utf8")
  ).rules;
  const shapeFailures = validateSkillShape(skill);
  if (!Array.isArray(rules) || rules.length === 0) shapeFailures.push("rules.json must contain rules");
  if (!Array.isArray(golden.fixtures) || golden.fixtures.length < 2) {
    shapeFailures.push("at least two fixtures are required");
  }
  const fixtureNames = golden.fixtures?.map((fixture) => fixture.name) ?? [];
  if (new Set(fixtureNames).size !== fixtureNames.length) {
    shapeFailures.push("fixture names must be unique");
  }
  for (const fixtureName of fixtureNames) {
    if (!fs.existsSync(path.join(fixturesRoot, skill, fixtureName))) {
      shapeFailures.push(`fixture directory does not exist: ${fixtureName}`);
    }
  }
  if (!golden.fixtures?.some((fixture) => fixture.expected.length > 0)) {
    shapeFailures.push("at least one positive fixture with expected findings is required");
  }
  if (!golden.fixtures?.some((fixture) => fixture.expected.length === 0)) {
    shapeFailures.push("at least one negative-control fixture is required");
  }
  let expectedCount = 0;
  let matchedCount = 0;
  let falsePositiveCount = 0;
  let observedCount = 0;

  for (const fixture of golden.fixtures) {
    const observed = scanFixture(skill, fixture.name, rules);
    const expected = fixture.expected;
    const observedKeys = new Set(
      observed.map((item) => `${item.ruleId}|${item.file}|${item.line}`)
    );
    const expectedKeys = new Set(
      expected.map((item) => `${item.ruleId}|${item.file}|${item.line}`)
    );

    expectedCount += expectedKeys.size;
    observedCount += observedKeys.size;
    matchedCount += [...expectedKeys].filter((key) => observedKeys.has(key)).length;
    falsePositiveCount += [...observedKeys].filter((key) => !expectedKeys.has(key)).length;

    // A fixture declared with no expected findings is a negative control, so
    // every observation in it is by definition a false positive. Aggregate
    // tolerance must not apply here: with a small corpus a rule that lost its
    // exemption logic produces one or two spurious findings and still lands
    // under the ceiling, which is how a gate stops being able to fail its
    // author. Mutation testing surfaced exactly that, so negative controls are
    // now absolute.
    if (expected.length === 0 && observedKeys.size > 0) {
      shapeFailures.push(
        `${fixture.name} is a negative control and must observe zero findings, saw ` +
          [...observedKeys].sort().join(", ")
      );
    }

    const envelope = findingEnvelope(skill, observed);
    if (!validateEnvelope(envelope)) {
      shapeFailures.push(
        `${fixture.name} emitted invalid finding JSON: ${JSON.stringify(validateEnvelope.errors)}`
      );
    }
  }

  const recall = expectedCount === 0 ? 0 : matchedCount / expectedCount;
  const falsePositiveRate = observedCount === 0 ? 0 : falsePositiveCount / observedCount;
  const passed =
    shapeFailures.length === 0 &&
    recall >= minimumRecall &&
    falsePositiveRate <= maximumFalsePositiveRate;
  failed ||= !passed;

  console.log(
    `${passed ? "PASS" : "FAIL"} ${skill}: recall=${(recall * 100).toFixed(0)}% ` +
      `false-positive-rate=${(falsePositiveRate * 100).toFixed(0)}%`
  );
  for (const failure of shapeFailures) console.log(`  ${failure}`);
}

process.exit(failed ? 1 : 0);
