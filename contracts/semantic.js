"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");

function validateSemantics(schemaName, document) {
  const errors = [];

  if (
    schemaName === "release.schema.json" &&
    document?.state === "published" &&
    document.package
  ) {
    const expected =
      `https://github.com/${document.releaseRepository}/releases/download/` +
      `${document.tag}/${document.package.name}`;
    if (document.immutableUrl !== expected) {
      errors.push(`immutableUrl must exactly match the release repository, tag, and package: ${expected}`);
    }
    const expectedStable =
      `https://github.com/${document.releaseRepository}/releases/latest/download/` +
      document.package.name;
    if (document.stableUrl !== expectedStable) {
      errors.push(`stableUrl must exactly match the release repository and package: ${expectedStable}`);
    }
  }

  if (
    schemaName === "handoff.schema.json" &&
    document?.state === "accepted" &&
    document.source &&
    document.source.baselineCommit === document.source.headCommit
  ) {
    errors.push("accepted handoff headCommit must differ from baselineCommit");
  }

  return errors;
}

function validateRunDirectory(directory, documents) {
  const errors = [];
  const run = documents["run.json"];
  const handoff = documents["handoff.json"];
  const analysis = documents["analysis.json"];
  const plan = documents["plan.json"];
  const build = documents["build.json"];
  const runtime = documents["runtime.json"];
  const purity = documents["purity.json"];
  const review = documents["review.json"];
  const release = documents["release.json"];

  if (run?.status === "passed") {
    for (const required of ["build.json", "runtime.json", "purity.json", "review.json"]) {
      if (!documents[required]) errors.push(`passed run requires ${required}`);
    }
    if (review?.verdict !== "PASS") {
      errors.push("passed run requires review.json verdict PASS");
    }
    if (build?.arm64Execution?.executed !== true) {
      errors.push("passed run requires build.json arm64Execution.executed true");
    }
    if (
      !Array.isArray(build?.after) ||
      build.after.some(
        (step) =>
          !step ||
          (step.mode !== "skipped" &&
            (step.exitCode !== 0 ||
              typeof step.command !== "string" ||
              step.command.trim().length === 0))
      )
    ) {
      errors.push("passed run requires every executed final build step to have a command and exit 0");
    }
    if (
      !build?.after?.some(
        (step) =>
          step &&
          typeof step.target === "string" &&
          /arm64|aarch64/i.test(step.target) &&
          step.mode !== "skipped" &&
          step.exitCode === 0
      )
    ) {
      errors.push("passed run requires a successful final Arm64 build step");
    }
    if (!Array.isArray(runtime?.arm64) || runtime.arm64.length === 0) {
      errors.push("passed run requires executed Arm64 checks in runtime.json");
    } else if (
      runtime.arm64.some(
        (check) =>
          !check ||
          check.exitCode !== 0 ||
          typeof check.command !== "string" ||
          check.command.trim().length === 0
      )
    ) {
      errors.push("passed run requires every Arm64 runtime check to have a command and exit 0");
    }
    if (!build?.testSummary || build.testSummary.afterFailed !== 0) {
      errors.push("passed run requires build.json testSummary.afterFailed 0");
    }
    if (
      !Array.isArray(build?.testSuites) ||
      build.testSuites.length === 0 ||
      build.testSuites.some(
        (suite) =>
          !suite ||
          suite.exitCode !== 0 ||
          suite.failed !== 0 ||
          suite.ran <= 0 ||
          suite.ran !== suite.passed ||
          typeof suite.evidence !== "string" ||
          suite.evidence.length === 0
      )
    ) {
      errors.push(
        "passed run requires every recorded test suite to exit 0 with zero failures and passed equal to ran"
      );
    }
    const requiredSuites = Array.isArray(build?.requiredTestSuites)
      ? build.requiredTestSuites
      : [];
    const recordedSuites = Array.isArray(build?.testSuites)
      ? build.testSuites.map((suite) => suite?.name).filter(Boolean)
      : [];
    if (
      requiredSuites.length === 0 ||
      new Set(requiredSuites).size !== requiredSuites.length ||
      requiredSuites.length !== recordedSuites.length ||
      requiredSuites.some((name) => !recordedSuites.includes(name))
    ) {
      errors.push("passed run requires testSuites to exactly match requiredTestSuites");
    }
    for (const [index, suite] of (
      Array.isArray(build?.testSuites) ? build.testSuites : []
    ).entries()) {
      validateNonEmptyRunFile(
        directory,
        suite?.evidence,
        `build.json testSuites[${index}].evidence`,
        errors
      );
    }
    const analyzedSuites = Array.isArray(analysis?.structure?.requiredTestSuites)
      ? analysis.structure.requiredTestSuites
      : [];
    const plannedSuites = Array.isArray(plan?.requiredTestSuites)
      ? plan.requiredTestSuites
      : [];
    if (
      analyzedSuites.length === 0 ||
      analyzedSuites.length !== plannedSuites.length ||
      plannedSuites.length !== requiredSuites.length ||
      analyzedSuites.some((name) => !plannedSuites.includes(name)) ||
      plannedSuites.some((name) => !requiredSuites.includes(name))
    ) {
      errors.push(
        "passed run requires requiredTestSuites to match analysis, plan, and build evidence"
      );
    }
    const toolchain = build?.toolchain;
    if (!toolchain || typeof toolchain !== "object" || Array.isArray(toolchain)) {
      errors.push("passed run requires build.json toolchain identity evidence");
    } else {
      const declaredVersion =
        typeof toolchain.vcToolsVersion === "string"
          ? toolchain.vcToolsVersion.toLowerCase()
          : null;
      const dependencyVersion = toolchain.dependencyCompiler?.version;
      const buildVersion = toolchain.buildCompiler?.version;
      const linkerVersion = toolchain.linker?.version;
      if (
        typeof dependencyVersion !== "string" ||
        dependencyVersion.length === 0 ||
        dependencyVersion !== buildVersion ||
        dependencyVersion !== linkerVersion ||
        typeof toolchain.vcToolsVersion !== "string" ||
        dependencyVersion !== toolchain.vcToolsVersion
      ) {
        errors.push(
          "passed run requires dependency compiler, build compiler, linker, and VCToolsVersion to match"
        );
      }
      const resolvedPaths = [
        [toolchain.dependencyCompiler?.path, "cl.exe"],
        [toolchain.buildCompiler?.path, "cl.exe"],
        [toolchain.linker?.path, "link.exe"]
      ];
      if (
        !declaredVersion ||
        resolvedPaths.some(([resolvedPath, executable]) => {
          const roots = extractMsvcVersions(resolvedPath);
          return (
            roots.length !== 1 ||
            roots[0].toLowerCase() !== declaredVersion ||
            !isArm64ToolPath(resolvedPath, executable)
          );
        })
      ) {
        errors.push(
          "passed run requires ARM64 cl.exe/link.exe paths under the declared VCToolsVersion"
        );
      }
      for (const [label, value] of [
        ["LIB", toolchain.lib],
        ["INCLUDE", toolchain.include]
      ]) {
        const roots = extractMsvcVersions(value);
        if (
          !declaredVersion ||
          roots.length === 0 ||
          roots.some((version) => version.toLowerCase() !== declaredVersion)
        ) {
          errors.push(
            `passed run requires ${label} to use only the declared VCToolsVersion`
          );
        }
      }
      if (!hasOnlyArm64MsvcLibs(toolchain.lib, declaredVersion)) {
        errors.push("passed run requires every MSVC LIB root to target declared-version ARM64");
      }
      validateNonEmptyRunFile(
        directory,
        toolchain.evidence,
        "build.json toolchain.evidence",
        errors
      );
      if (
        /^v142$/i.test(toolchain.platformToolset) &&
        typeof toolchain.legacyCompatibilityEvidence !== "string"
      ) {
        errors.push(
          "passed run using legacy v142 requires explicit legacyCompatibilityEvidence"
        );
      } else if (/^v142$/i.test(toolchain.platformToolset)) {
        validateNonEmptyRunFile(
          directory,
          toolchain.legacyCompatibilityEvidence,
          "build.json toolchain.legacyCompatibilityEvidence",
          errors
        );
      }
    }
    const plannedScenarios = Array.isArray(plan?.acceptanceScenarios)
      ? plan.acceptanceScenarios
      : [];
    const analyzedScenarios = Array.isArray(analysis?.structure?.acceptanceScenarios)
      ? analysis.structure.acceptanceScenarios
      : [];
    const runtimeScenarios = Array.isArray(runtime?.scenarios) ? runtime.scenarios : [];
    if (
      analyzedScenarios.length === 0 ||
      plannedScenarios.length === 0 ||
      analyzedScenarios.length !== plannedScenarios.length ||
      plannedScenarios.length !== runtimeScenarios.length ||
      analyzedScenarios.some((scenario) => {
        const planned = plannedScenarios.find((candidate) => candidate?.id === scenario?.id);
        return (
          !scenario ||
          !planned ||
          planned.command !== scenario.command ||
          planned.expectedResult !== scenario.expectedResult ||
          JSON.stringify(planned.requiredProjects) !== JSON.stringify(scenario.requiredProjects)
        );
      }) ||
      plannedScenarios.some(
        (scenario) => {
          if (!scenario) return true;
          const result = runtimeScenarios.find((candidate) => candidate?.id === scenario.id);
          return (
            !result ||
            result.command !== scenario.command ||
            result.expectedResult !== scenario.expectedResult
          );
        }
      ) ||
      runtimeScenarios.some(
        (result) =>
          !result ||
          result.exitCode !== 0 ||
          result.expectedResult !== result.observedResult ||
          typeof result.evidence !== "string" ||
          result.evidence.length === 0
      )
    ) {
      errors.push(
        "passed run requires every planned acceptance scenario to pass with matching observed output"
      );
    }
    for (const [index, scenario] of runtimeScenarios.entries()) {
      validateNonEmptyRunFile(
        directory,
        scenario?.evidence,
        `runtime.json scenarios[${index}].evidence`,
        errors
      );
    }
    if (!Array.isArray(purity?.findings) || purity.findings.length !== 0) {
      errors.push("passed run requires purity.json with zero findings");
    }
    for (const [name, gate] of Object.entries(review?.gates ?? {})) {
      if (gate?.status !== "pass") continue;
      if (typeof gate.evidence !== "string" || gate.evidence.trim().length === 0) {
        errors.push(`review.json gates.${name}.evidence is required for a passed gate`);
        continue;
      }
      const resolved = resolveRunPath(
        directory,
        gate.evidence,
        `review.json gates.${name}.evidence`,
        errors
      );
      if (resolved && !fs.existsSync(resolved)) {
        errors.push(
          `review.json gates.${name}.evidence does not exist in the run directory: ${gate.evidence}`
        );
      }
    }
    for (const [filename, document] of Object.entries({
      "analysis.json": analysis,
      "plan.json": plan,
      "build.json": build,
      "runtime.json": runtime,
      "purity.json": purity,
      "review.json": review
    })) {
      if (document?.target?.commit !== run.target?.commit) {
        errors.push(`${filename} target.commit must match run.json target.commit`);
      }
    }
  }

  if (handoff?.state === "accepted") {
    if (!handoff.source || !handoff.changes || !Array.isArray(handoff.artifacts) || !Array.isArray(handoff.evidence)) {
      errors.push("accepted handoff requires source, changes, artifacts, and evidence");
    } else {
    const expectedUrl = `https://${handoff.source.repo}/commit/${handoff.source.headCommit}`;
    if (handoff.source.immutableUrl !== expectedUrl) {
      errors.push(`accepted handoff immutableUrl must be ${expectedUrl}`);
    }

    validateRecordedFile(directory, handoff.changes, "changes", errors);
    }
  }
  if (Array.isArray(handoff?.artifacts)) {
    for (const [index, artifact] of handoff.artifacts.entries()) {
      validateRecordedFile(directory, artifact, `artifacts[${index}]`, errors);
      if (
        artifact?.sourceCommit !== undefined &&
        !handoffDeclaredCommits(handoff).has(artifact.sourceCommit)
      ) {
        errors.push(`artifacts[${index}].sourceCommit is not declared by the handoff`);
      }
    }
  }
  if (Array.isArray(handoff?.evidence)) {
    for (const [index, evidence] of handoff.evidence.entries()) {
      validateHandoffEvidence(directory, handoff, evidence, index, errors);
    }
  }
  if (Array.isArray(handoff?.priorEvidence)) {
    for (const [index, evidence] of handoff.priorEvidence.entries()) {
      validateHandoffEvidence(directory, handoff, evidence, index, errors, "priorEvidence");
    }
  }

  if (release?.state === "ready" || release?.state === "published") {
    if (!release.package || !release.gates) {
      errors.push(`${release.state} release requires package and gates`);
      return errors;
    }
    const packagePath = resolveRunPath(directory, release.package.path, "package.path", errors);
    const manifestPath = resolveRunPath(
      directory,
      release.package.manifestPath,
      "package.manifestPath",
      errors
    );
    const checksumPath = resolveRunPath(
      directory,
      release.package.checksumFile,
      "package.checksumFile",
      errors
    );

    const evidencePaths = Object.entries(release.gates).map(([name, gate]) => {
      if (!gate || typeof gate.evidence !== "string") {
        errors.push(`gates.${name}.evidence is required`);
        return [name, null];
      }
      return [
        name,
        resolveRunPath(directory, gate.evidence, `gates.${name}.evidence`, errors)
      ];
    });

    for (const [label, file] of [
      ["package.path", packagePath],
      ["package.manifestPath", manifestPath],
      ["package.checksumFile", checksumPath],
      ...evidencePaths.map(([name, file]) => [`gates.${name}.evidence`, file])
    ]) {
      if (file && !fs.existsSync(file)) {
        errors.push(`${label} does not exist: ${file}`);
      } else if (file && !fs.statSync(file).isFile()) {
        errors.push(`${label} must be a file`);
      } else if (file && label.startsWith("gates.") && fs.statSync(file).size === 0) {
        errors.push(`${label} is empty`);
      }
    }

    const packageSha256 =
      typeof release.package.sha256 === "string" &&
      /^[0-9a-fA-F]{64}$/.test(release.package.sha256)
        ? release.package.sha256.toLowerCase()
        : null;
    if (!packageSha256) errors.push("package.sha256 must be SHA-256");

    if (packagePath && fs.existsSync(packagePath) && fs.statSync(packagePath).isFile()) {
      const actualSize = fs.statSync(packagePath).size;
      if (actualSize !== release.package.size) {
        errors.push(`package.size ${release.package.size} does not match actual size ${actualSize}`);
      }
      const actualHash = sha256File(packagePath);
      if (packageSha256 && actualHash !== packageSha256) {
        errors.push(`package.sha256 does not match ${release.package.path}`);
      }
    }

    if (
      checksumPath &&
      fs.existsSync(checksumPath) &&
      fs.statSync(checksumPath).isFile() &&
      packageSha256
    ) {
      const checksum = fs.readFileSync(checksumPath, "utf8");
      const expectedLine = `${packageSha256}  ${release.package.name}`;
      const normalizedLines = checksum
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase());
      if (!normalizedLines.includes(expectedLine.toLowerCase())) {
        errors.push(`package.checksumFile does not contain '${expectedLine}'`);
      }
    }

    if (manifestPath && fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const manifestErrors = validateManifest(manifest);
        for (const error of manifestErrors) errors.push(`package.manifestPath ${error}`);
        if (manifestErrors.length === 0 && packagePath && fs.existsSync(packagePath)) {
          for (const error of compareManifestToArchive(packagePath, manifest)) {
            errors.push(`package.manifestPath ${error}`);
          }
        }
      } catch (error) {
        errors.push(`package.manifestPath is not valid JSON: ${error.message}`);
      }
    }
  }

  return errors;
}

function validateRecordedFile(directory, record, label, errors) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    errors.push(`${label} must be a file record`);
    return;
  }
  const file = resolveRunPath(directory, record.path, `${label}.path`, errors);
  if (!file || !fs.existsSync(file)) {
    if (file) errors.push(`${label}.path does not exist: ${file}`);
    return;
  }
  if (!fs.statSync(file).isFile()) {
    errors.push(`${label}.path must be a file`);
    return;
  }

  const size = fs.statSync(file).size;
  if (record.size !== undefined && record.size !== size) {
    errors.push(`${label}.size ${record.size} does not match actual size ${size}`);
  }
  if (typeof record.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(record.sha256)) {
    errors.push(`${label}.sha256 must be SHA-256`);
  } else if (sha256File(file) !== record.sha256.toLowerCase()) {
    errors.push(`${label}.sha256 does not match ${record.path}`);
  }
}

function validateNonEmptyRunFile(directory, relativePath, label, errors) {
  const file = resolveRunPath(directory, relativePath, label, errors);
  if (!file) return;
  if (!fs.existsSync(file)) {
    errors.push(`${label} does not exist: ${file}`);
  } else if (!fs.statSync(file).isFile()) {
    errors.push(`${label} must be a file`);
  } else if (fs.statSync(file).size === 0) {
    errors.push(`${label} is empty`);
  }
}

function extractMsvcVersions(value) {
  if (typeof value !== "string") return [];
  const versions = [];
  const pattern = /[\\/]VC[\\/]Tools[\\/]MSVC[\\/]([^\\/;]+)/giu;
  for (const match of value.matchAll(pattern)) versions.push(match[1]);
  return versions;
}

function isArm64ToolPath(value, executable) {
  if (typeof value !== "string") return false;
  const normalized = value.replaceAll("/", "\\");
  const escapedExecutable = executable.replace(".", "\\.");
  return new RegExp(
    `\\\\bin\\\\Host(?:x64|ARM64)\\\\arm64\\\\${escapedExecutable}$`,
    "iu"
  ).test(normalized);
}

function hasOnlyArm64MsvcLibs(value, declaredVersion) {
  if (typeof value !== "string" || !declaredVersion) return false;
  const msvcEntries = value.split(";").filter((entry) => extractMsvcVersions(entry).length > 0);
  const prefix = `\\vc\\tools\\msvc\\${declaredVersion.toLowerCase()}\\`;
  return msvcEntries.length > 0 && msvcEntries.every((entry) => {
    const normalized = entry
      .trim()
      .replaceAll("/", "\\")
      .toLowerCase()
      .replace(/\\+$/u, "");
    const index = normalized.indexOf(prefix);
    if (index < 0) return false;
    // A real ARM64 LibraryPath also carries atlmfc and spectre variants of the
    // same toolset. Rejecting those flagged a correct ARM64 build as impure.
    return /^(?:atlmfc\\)?lib\\(?:spectre\\)?arm64$/u.test(normalized.slice(index + prefix.length));
  });
}

function handoffEvidenceCommits(handoff) {
  const alternate =
    handoff?.state === "pending" && Array.isArray(handoff?.source?.evidenceCommits)
      ? handoff.source.evidenceCommits
      : [];
  return new Set([handoff?.source?.headCommit, ...alternate].filter(Boolean));
}

/**
 * Commits a handoff may legitimately reference from non-gating records. Unlike
 * {@link handoffEvidenceCommits} this always includes the declared alternate commits,
 * because retained artifacts and prior failures describe history rather than acceptance.
 */
function handoffDeclaredCommits(handoff) {
  const alternate = Array.isArray(handoff?.source?.evidenceCommits)
    ? handoff.source.evidenceCommits
    : [];
  return new Set([handoff?.source?.headCommit, ...alternate].filter(Boolean));
}

function validateHandoffEvidence(directory, handoff, evidence, index, errors, field = "evidence") {
  const label = `${field}[${index}]`;
  const isPrior = field === "priorEvidence";
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    errors.push(`${label} must be an evidence record`);
    return;
  }
  validateRecordedFile(directory, evidence, label, errors);
  const commits = isPrior ? handoffDeclaredCommits(handoff) : handoffEvidenceCommits(handoff);
  if (!commits.has(evidence.sourceCommit)) {
    errors.push(`${label}.sourceCommit is not declared by the handoff`);
  } else if (isPrior) {
    if (evidence.status === "pass") {
      errors.push(`${label} retained prior evidence must not claim pass`);
    }
  } else if (
    evidence.sourceCommit !== handoff?.source?.headCommit &&
    evidence.status !== "fail"
  ) {
    errors.push(`${label} alternate-commit evidence must have status fail`);
  }
  if (evidence.runnerType === "github-actions" && typeof evidence.workflowUrl !== "string") {
    errors.push(`${label}.workflowUrl is required for GitHub-hosted evidence`);
  } else if (evidence.runnerType === "github-actions") {
    const repository = String(handoff?.source?.repo ?? "")
      .replace(/^github\.com\//iu, "")
      .replace(/\/$/u, "");
    const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(
      `^https://github\\.com/${escapedRepository}/actions/runs/[1-9][0-9]*$`,
      "iu"
    );
    if (!pattern.test(evidence.workflowUrl)) {
      errors.push(`${label}.workflowUrl must identify a run in source.repo`);
    }
  }

  const hardKinds = ["build", "test", "runtime", "purity", "package", "checksum"];
  if (!hardKinds.includes(evidence.kind) || evidence.status === "not-run") return;
  if (typeof evidence.command !== "string" || evidence.command.length === 0) {
    errors.push(`${label} ${evidence.kind} ${evidence.status} requires command`);
  }
  if (evidence.status === "pass" && evidence.exitCode !== 0) {
    errors.push(`${label} ${evidence.kind} pass requires exitCode 0`);
  }
  if (evidence.status === "fail" && (!Number.isInteger(evidence.exitCode) || evidence.exitCode === 0)) {
    errors.push(`${label} ${evidence.kind} fail requires a nonzero exitCode`);
  }
}

function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== "1.0") errors.push("must have schemaVersion 1.0");
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    errors.push("must contain at least one file");
    return errors;
  }

  const paths = new Map();
  for (const [index, file] of manifest.files.entries()) {
    if (
      typeof file?.path !== "string" ||
      file.path.length === 0 ||
      path.isAbsolute(file.path) ||
      !isSafeWindowsRelativePath(file.path)
    ) {
      errors.push(`files[${index}].path must be a safe Windows relative path`);
    } else if (paths.has(canonicalWindowsPath(file.path))) {
      errors.push(
        `contains Windows-equivalent paths ${paths.get(canonicalWindowsPath(file.path))} and ${file.path}`
      );
    } else {
      paths.set(canonicalWindowsPath(file.path), file.path);
    }
    if (!Number.isInteger(file?.size) || file.size < 0) {
      errors.push(`files[${index}].size must be a non-negative integer`);
    }
    if (typeof file?.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(file.sha256)) {
      errors.push(`files[${index}].sha256 must be SHA-256`);
    }
  }
  return errors;
}

function compareManifestToArchive(packagePath, manifest) {
  const errors = [];
  let entries;
  try {
    entries = new AdmZip(packagePath).getEntries().filter((entry) => !entry.isDirectory);
  } catch (error) {
    return [`cannot read package archive: ${error.message}`];
  }

  const actual = new Map();
  for (const entry of entries) {
    const entryPath = entry.entryName.replaceAll("\\", "/");
    const canonicalPath = canonicalWindowsPath(entryPath);
    if (
      entryPath.length === 0 ||
      path.posix.isAbsolute(entryPath) ||
      !isSafeWindowsRelativePath(entryPath)
    ) {
      errors.push(`archive contains unsafe path ${entry.entryName}`);
      continue;
    }
    if (actual.has(canonicalPath)) {
      errors.push(
        `archive contains Windows-equivalent paths ${actual.get(canonicalPath).path} and ${entryPath}`
      );
      continue;
    }
    try {
      const contents = entry.getData();
      actual.set(canonicalPath, {
        path: entryPath,
        size: contents.length,
        sha256: crypto.createHash("sha256").update(contents).digest("hex")
      });
    } catch (error) {
      errors.push(`cannot read archive entry ${entryPath}: ${error.message}`);
    }
  }

  const expected = new Map(
    manifest.files.map((file) => [canonicalWindowsPath(file.path), file])
  );
  for (const [canonicalPath, entry] of actual) {
    const recorded = expected.get(canonicalPath);
    if (!recorded) {
      errors.push(`archive contains unmanifested file ${entry.path}`);
    } else if (
      recorded.size !== entry.size ||
      recorded.sha256.toLowerCase() !== entry.sha256
    ) {
      errors.push(`archive file does not match manifest: ${entry.path}`);
    }
  }
  for (const [canonicalPath, file] of expected) {
    if (!actual.has(canonicalPath)) {
      errors.push(`manifest file is missing from archive: ${file.path}`);
    }
  }
  return errors;
}

function canonicalWindowsPath(filePath) {
  return filePath
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => segment.replace(/[ .]+$/u, "").toLowerCase())
    .join("/");
}

function isSafeWindowsRelativePath(filePath) {
  if (typeof filePath !== "string" || path.isAbsolute(filePath)) return false;
  const segments = filePath.replaceAll("\\", "/").split("/");
  return segments.every((segment) => {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      /[ .]$/u.test(segment) ||
      /[<>:"|?*\u0000-\u001F]/u.test(segment)
    ) {
      return false;
    }
    const stem = segment.split(".", 1)[0].toUpperCase();
    return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem);
  });
}

function resolveRunPath(directory, relativePath, label, errors) {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;
  if (path.isAbsolute(relativePath)) {
    errors.push(`${label} must be relative to the run directory`);
    return null;
  }

  const root = path.resolve(directory);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label} escapes the run directory`);
    return null;
  }
  return resolved;
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

module.exports = {
  validateSemantics,
  validateRunDirectory,
  validateManifest,
  compareManifestToArchive
};
