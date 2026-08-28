const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");
const Ajv = require("ajv/dist/2020");
const {
  validateSemantics,
  validateRunDirectory,
  validateManifest,
  compareManifestToArchive
} = require("../semantic");

const contracts = path.resolve(__dirname, "..");
const ajv = new Ajv({ strict: false, allErrors: true });

for (const file of fs.readdirSync(contracts).filter((name) => name.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(fs.readFileSync(path.join(contracts, file), "utf8")), file);
}

const commit = "3e518697ea761935574af486bacd5fcc1aeab363";
const sha256 = "a".repeat(64);

function validGate(status = "pass") {
  return {
    status,
    evidence: "runs/opencppcoverage/evidence.log",
    command: "tool --verify",
    exitCode: status === "pass" ? 0 : 1,
    runner: "windows-11-arm"
  };
}

function validCandidateRelease() {
  return {
    schemaVersion: "1.0",
    state: "candidate",
    target: { repo: "github.com/OpenCppCoverage/OpenCppCoverage", commit },
    package: {
      name: "OpenCppCoverage-win-arm64.zip",
      path: "artifacts/OpenCppCoverage-win-arm64.zip",
      size: 42,
      sha256,
      manifestPath: "artifacts/MANIFEST.json",
      checksumFile: "artifacts/SHA256SUMS.txt"
    },
    gates: {
      build: validGate(),
      tests: validGate(),
      arm64Runtime: validGate("not-run"),
      purity: validGate(),
      packageContents: validGate(),
      sourceAvailable: validGate(),
      checksum: validGate(),
      redownload: validGate("not-run")
    }
  };
}

function validPassedDocuments(directory) {
      for (const name of ["suite.log", "toolchain.log", "scenario.log"]) {
        fs.writeFileSync(path.join(directory, name), `${name} evidence`);
      }
      const scenario = {
        id: "SCN-001",
        name: "Capture coverage",
        command: "OpenCppCoverage.exe --sources fixture.exe",
        expectedResult: "fixture.cpp:10 covered",
        requiredProjects: ["OpenCppCoverage", "CppCoverageTest"]
      };
      const vcToolsVersion = "14.44.35207";
      const msvcRoot = `C:\\VS\\VC\\Tools\\MSVC\\${vcToolsVersion}`;
      return {
        "run.json": { status: "passed", target: { commit } },
        "analysis.json": {
          target: { commit },
          structure: {
            acceptanceScenarios: [scenario],
            requiredTestSuites: ["CppCoverageTest"]
          }
        },
        "plan.json": {
          target: { commit },
          acceptanceScenarios: [scenario],
          requiredTestSuites: ["CppCoverageTest"]
        },
        "build.json": {
          target: { commit },
          arm64Execution: { executed: true },
          after: [
            {
              target: "ARM64",
              command: "msbuild CppCoverage.sln",
              mode: "executed",
              exitCode: 0
            }
          ],
          testSummary: { afterFailed: 0 },
          requiredTestSuites: ["CppCoverageTest"],
          testSuites: [
            {
              name: "CppCoverageTest",
              command: "CppCoverageTest.exe",
              exitCode: 0,
              ran: 116,
              passed: 116,
              failed: 0,
              evidence: "suite.log"
            }
          ],
          toolchain: {
            dependencyCompiler: {
              path: `${msvcRoot}\\bin\\Hostarm64\\arm64\\cl.exe`,
              version: vcToolsVersion
            },
            buildCompiler: {
              path: `${msvcRoot}\\bin\\Hostarm64\\arm64\\cl.exe`,
              version: vcToolsVersion
            },
            linker: {
              path: `${msvcRoot}\\bin\\Hostarm64\\arm64\\link.exe`,
              version: vcToolsVersion
            },
            vcToolsVersion,
            windowsSdkVersion: "10.0.26100.0",
            platformToolset: "v143",
            lib: `${msvcRoot}\\lib\\arm64`,
            include: `${msvcRoot}\\include`,
            evidence: "toolchain.log"
          }
        },
        "runtime.json": {
          target: { commit },
          arm64: [{ command: scenario.command, exitCode: 0 }],
          scenarios: [
            {
              id: scenario.id,
              command: scenario.command,
              exitCode: 0,
              expectedResult: scenario.expectedResult,
              observedResult: scenario.expectedResult,
              evidence: "scenario.log"
            }
          ]
        },
        "purity.json": { target: { commit }, findings: [] },
        "review.json": { target: { commit }, verdict: "PASS" }
      };
}

test("pending handoff records missing evidence honestly", () => {
  const validate = ajv.getSchema("handoff.schema.json");
  const document = {
    schemaVersion: "1.0",
    state: "pending",
    source: { repo: "github.com/OpenCppCoverage/OpenCppCoverage", baselineCommit: commit },
    session: {
      projectSessionId: "04911afc-02d8-4a30-b574-11ac0031e777",
      branch: "t-lsingoei-microsoft-port-windows-arm64",
      reportedAt: "2026-08-19T15:48:43.000+03:00"
    },
    missingEvidence: ["implementation commit", "native ARM64 runtime"]
  };

  assert.equal(validate(document), true, JSON.stringify(validate.errors));
});

test("accepted handoff cannot omit immutable changes and evidence", () => {
  const validate = ajv.getSchema("handoff.schema.json");
  const document = {
    schemaVersion: "1.0",
    state: "accepted",
    source: { repo: "github.com/OpenCppCoverage/OpenCppCoverage", baselineCommit: commit },
    session: {
      projectSessionId: "04911afc-02d8-4a30-b574-11ac0031e777",
      reportedAt: "2026-08-19T15:48:43.000+03:00"
    },
    missingEvidence: []
  };

  assert.equal(validate(document), false);
});

test("accepted handoff cannot use only not-run evidence", () => {
  const validate = ajv.getSchema("handoff.schema.json");
  const document = {
    schemaVersion: "1.0",
    state: "accepted",
    source: {
      repo: "github.com/OpenCppCoverage/OpenCppCoverage",
      baselineCommit: commit,
      headCommit: "b".repeat(40),
      immutableUrl:
        "https://github.com/lynnsingoei/OpenCppCoverage-ARM64/commit/" + "b".repeat(40)
    },
    session: {
      projectSessionId: "04911afc-02d8-4a30-b574-11ac0031e777",
      reportedAt: "2026-08-19T15:48:43.000+03:00"
    },
    changes: {
      kind: "format-patch",
      path: "runs/opencppcoverage/port.patch",
      sha256
    },
    artifacts: [
      {
        name: "candidate.zip",
        path: "artifacts/candidate.zip",
        size: 42,
        sha256
      }
    ],
    evidence: [
      {
        kind: "runtime",
        status: "not-run",
        path: "runs/opencppcoverage/runtime.json"
      }
    ],
    missingEvidence: [],
    acceptedAt: "2026-08-19T16:00:00Z"
  };

  assert.equal(validate(document), false);
});

test("candidate release may disclose incomplete hard gates", () => {
  const validate = ajv.getSchema("release.schema.json");
  const document = validCandidateRelease();

  assert.equal(validate(document), true, JSON.stringify(validate.errors));
});

test("ready release rejects a configured-but-unrun ARM64 gate", () => {
  const validate = ajv.getSchema("release.schema.json");
  const document = validCandidateRelease();
  document.state = "ready";

  assert.equal(validate(document), false);
});

test("ready release rejects passing labels with failing exit codes", () => {
  const validate = ajv.getSchema("release.schema.json");
  const document = validCandidateRelease();
  document.state = "ready";
  document.gates.redownload = validGate("not-run");
  document.gates.build.exitCode = 1;

  assert.equal(validate(document), false);
});

test("ready release accepts measured gates while redownload remains not-run", () => {
  const validate = ajv.getSchema("release.schema.json");
  const document = validCandidateRelease();
  document.state = "ready";
  document.gates.arm64Runtime = validGate();

  assert.equal(validate(document), true, JSON.stringify(validate.errors));
});

test("published release requires URLs and publication metadata", () => {
  const validate = ajv.getSchema("release.schema.json");
  const document = validCandidateRelease();
  document.state = "published";
  document.gates.arm64Runtime = validGate();
  document.gates.redownload = validGate();

  assert.equal(validate(document), false);
});

test("published release accepts complete post-download evidence", () => {
  const validate = ajv.getSchema("release.schema.json");
  const document = validCandidateRelease();
  document.state = "published";
  document.gates.arm64Runtime = validGate();
  document.gates.redownload = validGate();
  document.version = "fixture-version";
  document.tag = "fixture-tag";
  document.releaseRepository = "lynnsingoei/OpenCppCoverage-ARM64";
  document.immutableUrl =
    "https://github.com/lynnsingoei/OpenCppCoverage-ARM64/releases/download/fixture-tag/OpenCppCoverage-win-arm64.zip";
  document.stableUrl =
    "https://github.com/lynnsingoei/OpenCppCoverage-ARM64/releases/latest/download/OpenCppCoverage-win-arm64.zip";
  document.publishedAt = "2026-08-19T12:00:00Z";

  assert.equal(validate(document), true, JSON.stringify(validate.errors));
});

test("published release rejects unrelated immutable URL", () => {
  const validate = ajv.getSchema("release.schema.json");
  const document = validCandidateRelease();
  document.state = "published";
  document.gates.arm64Runtime = validGate();
  document.gates.redownload = validGate();
  document.version = "fixture-version";
  document.tag = "fixture-tag";
  document.releaseRepository = "lynnsingoei/OpenCppCoverage-ARM64";
  document.immutableUrl = "https://example.com/unrelated.zip";
  document.stableUrl =
    "https://github.com/lynnsingoei/OpenCppCoverage-ARM64/releases/latest/download/OpenCppCoverage-win-arm64.zip";
  document.publishedAt = "2026-08-19T12:00:00Z";

  assert.equal(validate(document), false);
});

test("published release URL must match its tag semantically", () => {
  const document = {
    releaseRepository: "lynnsingoei/OpenCppCoverage-ARM64",
    tag: "v1.0.0",
    package: { name: "OpenCppCoverage-win-arm64.zip" },
    immutableUrl:
      "https://github.com/lynnsingoei/OpenCppCoverage-ARM64/releases/download/v2.0.0/OpenCppCoverage-win-arm64.zip",
    stableUrl:
      "https://github.com/lynnsingoei/OpenCppCoverage-ARM64/releases/latest/download/OpenCppCoverage-win-arm64.zip",
    state: "published"
  };

  assert.equal(validateSemantics("release.schema.json", document).length, 1);
});

test("published stable URL must match repository and package semantically", () => {
  const document = {
    releaseRepository: "lynnsingoei/OpenCppCoverage-ARM64",
    tag: "v1.0.0",
    package: { name: "OpenCppCoverage-win-arm64.zip" },
    immutableUrl:
      "https://github.com/lynnsingoei/OpenCppCoverage-ARM64/releases/download/v1.0.0/OpenCppCoverage-win-arm64.zip",
    stableUrl: "https://github.com/other/repo/releases/latest/download/other.zip",
    state: "published"
  };

  assert.equal(validateSemantics("release.schema.json", document).length, 1);
});

test("PASS review requires measured hard gates", () => {
  const validate = ajv.getSchema("review.schema.json");
  const document = {
    schemaVersion: "1.0",
    target: { repo: "fixture/repo", commit },
    round: 1,
    verdict: "PASS",
    verdictReason: "All configured jobs exist.",
    gates: {
      arm64Purity: { status: "not-run" },
      buildGreen: { status: "not-run" },
      runtimeValidated: { status: "not-run" },
      planCompleteness: { status: "not-run" }
    },
    findings: [],
    summary: { blockers: 0, high: 0, medium: 0, low: 0 }
  };

  assert.equal(validate(document), false);
});

test("PASS review accepts complete measured hard gates", () => {
  const validate = ajv.getSchema("review.schema.json");
  const passedGate = {
    status: "pass",
    tool: "fixture-tool",
    exitCode: 0,
    evidence: "runs/fixture/evidence.log"
  };
  const document = {
    schemaVersion: "1.0",
    target: { repo: "fixture/repo", commit },
    round: 1,
    verdict: "PASS",
    verdictReason: "Every hard gate passed with retained evidence.",
    gates: {
      arm64Purity: passedGate,
      buildGreen: passedGate,
      runtimeValidated: passedGate,
      planCompleteness: passedGate,
      projectGraphComplete: passedGate,
      scenarioValidated: passedGate,
      testFailurePropagation: passedGate,
      foreignArchRefusal: passedGate,
      hostToolchainSingle: passedGate
    },
    findings: [],
    unresolvedFindings: [],
    regressions: [],
    summary: { blockers: 0, high: 0, medium: 0, low: 0 }
  };

  assert.equal(validate(document), true, JSON.stringify(validate.errors));
});

test("PASS review rejects a missing foreign-architecture negative control", () => {
  const validate = ajv.getSchema("review.schema.json");
  const passedGate = {
    status: "pass",
    tool: "fixture-tool",
    exitCode: 0,
    evidence: "runs/fixture/evidence.log"
  };
  const gates = {
    arm64Purity: passedGate,
    buildGreen: passedGate,
    runtimeValidated: passedGate,
    planCompleteness: passedGate,
    projectGraphComplete: passedGate,
    scenarioValidated: passedGate,
    testFailurePropagation: passedGate,
    foreignArchRefusal: passedGate,
    hostToolchainSingle: passedGate
  };
  const document = {
    schemaVersion: "1.0",
    target: { repo: "fixture/repo", commit },
    round: 1,
    verdict: "PASS",
    verdictReason: "A pass on ARM64 alone cannot prove the binary is not emulated x64.",
    gates,
    findings: [],
    unresolvedFindings: [],
    regressions: [],
    summary: { blockers: 0, high: 0, medium: 0, low: 0 }
  };

  delete document.gates.foreignArchRefusal;
  assert.equal(validate(document), false);

  document.gates.foreignArchRefusal = { ...passedGate, status: "not-run" };
  assert.equal(validate(document), false, "a not-run negative control cannot produce a PASS");
});

test("PASS review requires explicit empty unresolved and regression arrays", () => {
  const validate = ajv.getSchema("review.schema.json");
  const passedGate = {
    status: "pass",
    tool: "fixture-tool",
    exitCode: 0,
    evidence: "runs/fixture/evidence.log"
  };
  const document = {
    schemaVersion: "1.0",
    target: { repo: "fixture/repo", commit },
    round: 1,
    verdict: "PASS",
    verdictReason: "Every hard gate passed with retained evidence.",
    gates: {
      arm64Purity: passedGate,
      buildGreen: passedGate,
      runtimeValidated: passedGate,
      planCompleteness: passedGate,
      projectGraphComplete: passedGate,
      scenarioValidated: passedGate,
      testFailurePropagation: passedGate
    },
    findings: [],
    summary: { blockers: 0, high: 0, medium: 0, low: 0 }
  };

  assert.equal(validate(document), false);
});

test("PASS review rejects empty evidence and blocker findings", () => {
  const validate = ajv.getSchema("review.schema.json");
  const emptyGate = { status: "pass", tool: "", exitCode: 0, evidence: "" };
  const finding = {
    id: "ARM-0001",
    file: "src/file.cpp",
    line: 1,
    evidence: "0xCC",
    category: "arch-lock",
    severity: "blocker",
    explanation: "Architecture-locked behavior.",
    recommendation: "Implement ARM64 behavior.",
    arm64Impact: "blocker",
    effort: "M",
    confidence: "high"
  };
  const document = {
    schemaVersion: "1.0",
    target: { repo: "fixture/repo", commit },
    round: 1,
    verdict: "PASS",
    verdictReason: "Passed despite a blocker.",
    gates: {
      arm64Purity: emptyGate,
      buildGreen: emptyGate,
      runtimeValidated: emptyGate,
      planCompleteness: emptyGate
    },
    findings: [finding],
    summary: { blockers: 1, high: 0, medium: 0, low: 0 }
  };

  assert.equal(validate(document), false);
});

test("blocked-external run requires blockedBy at the root", () => {
  const validate = ajv.getSchema("run.schema.json");
  const document = {
    target: { repo: "fixture/repo", commit },
    analysisRound: 1,
    reviewRound: 1,
    maxReviewRounds: 3,
    status: "blocked-external",
    history: [
      { stage: "setup", result: "created", timestamp: "2026-08-19T12:00:00Z" }
    ]
  };

  assert.equal(validate(document), false);
});

test("blocked-external run rejects empty resolution details", () => {
  const validate = ajv.getSchema("run.schema.json");
  const document = {
    target: { repo: "fixture/repo", commit },
    analysisRound: 1,
    reviewRound: 1,
    maxReviewRounds: 3,
    status: "blocked-external",
    blockedBy: { gate: "", reason: "", resolvedBy: "" },
    history: [
      { stage: "setup", result: "created", timestamp: "2026-08-19T12:00:00Z" }
    ]
  };

  assert.equal(validate(document), false);
});

test("passed run directory requires a PASS review and evidence artifacts", () => {
  const errors = validateRunDirectory("runs/fixture", {
    "run.json": { status: "passed" },
    "review.json": { verdict: "REVISE" }
  });

  assert.ok(errors.includes("passed run requires review.json verdict PASS"));
  assert.ok(errors.includes("passed run requires build.json"));
  assert.ok(errors.includes("passed run requires build.json arm64Execution.executed true"));
});

test("passed run directory rejects failed or content-free final evidence", () => {
  const errors = validateRunDirectory("runs/fixture", {
    "run.json": {
      status: "passed",
      target: { commit }
    },
    "build.json": {
      target: { commit },
      arm64Execution: { executed: true },
      after: [
        {
          target: "ARM64",
          command: "",
          mode: "executed",
          exitCode: 1
        }
      ],
      testSummary: { afterFailed: 1 }
    },
    "runtime.json": {
      target: { commit },
      arm64: [{ command: "", exitCode: 1 }]
    },
    "purity.json": {
      target: { commit },
      findings: []
    },
    "review.json": {
      target: { commit },
      verdict: "PASS"
    }
  });

  assert.ok(
    errors.includes("passed run requires every executed final build step to have a command and exit 0")
  );
  assert.ok(
    errors.includes("passed run requires every Arm64 runtime check to have a command and exit 0")
  );
  assert.ok(errors.includes("passed run requires build.json testSummary.afterFailed 0"));
  assert.ok(
    errors.includes(
      "passed run requires every recorded test suite to exit 0 with zero failures and passed equal to ran"
    )
  );
  assert.ok(errors.includes("passed run requires build.json toolchain identity evidence"));
});

test("passed run directory rejects fail-open native test summaries", () => {
  const errors = validateRunDirectory("runs/fixture", {
    "run.json": { status: "passed", target: { commit } },
    "build.json": {
      target: { commit },
      arm64Execution: { executed: true },
      after: [
        {
          target: "ARM64",
          command: "msbuild CppCoverage.sln",
          mode: "executed",
          exitCode: 0
        }
      ],
      testSummary: { afterFailed: 0 },
      testSuites: [
        {
          name: "CppCoverageTest",
          command: "CppCoverageTest.exe",
          exitCode: 1,
          ran: 116,
          passed: 114,
          failed: 2
        }
      ]
    },
    "runtime.json": {
      target: { commit },
      arm64: [{ command: "OpenCppCoverage.exe --sources test.exe", exitCode: 0 }]
    },
    "purity.json": { target: { commit }, findings: [] },
    "review.json": { target: { commit }, verdict: "PASS" }
  });

  assert.ok(
    errors.includes(
      "passed run requires every recorded test suite to exit 0 with zero failures and passed equal to ran"
    )
  );
});

test("passed run directory rejects mixed MSVC identities", () => {
  const errors = validateRunDirectory("runs/fixture", {
    "run.json": { status: "passed", target: { commit } },
    "build.json": {
      target: { commit },
      arm64Execution: { executed: true },
      after: [
        {
          target: "ARM64",
          command: "msbuild CppCoverage.sln",
          mode: "executed",
          exitCode: 0
        }
      ],
      testSummary: { afterFailed: 0 },
      toolchain: {
        dependencyCompiler: {
          path: "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostarm64\\arm64\\cl.exe",
          version: "14.44.35207"
        },
        buildCompiler: {
          path: "C:\\VS\\VC\\Tools\\MSVC\\14.29.30133\\bin\\Hostarm64\\arm64\\cl.exe",
          version: "14.29.30133"
        },
        linker: {
          path: "C:\\VS\\VC\\Tools\\MSVC\\14.29.30133\\bin\\Hostarm64\\arm64\\link.exe",
          version: "14.29.30133"
        },
        vcToolsVersion: "14.29.30133",
        windowsSdkVersion: "10.0.26100.0",
        platformToolset: "v142"
      }
    },
    "runtime.json": {
      target: { commit },
      arm64: [{ command: "OpenCppCoverage.exe --sources test.exe", exitCode: 0 }]
    },
    "purity.json": { target: { commit }, findings: [] },
    "review.json": { target: { commit }, verdict: "PASS" }
  });

  assert.ok(
    errors.includes(
      "passed run requires dependency compiler, build compiler, linker, and VCToolsVersion to match"
    )
  );
  assert.ok(
    errors.includes(
      "passed run requires ARM64 cl.exe/link.exe paths under the declared VCToolsVersion"
    )
  );
});

test("passed run directory accepts complete suites, scenarios, and coherent toolchain evidence", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-pass-complete-"));
    try {
      assert.deepEqual(validateRunDirectory(directory, validPassedDocuments(directory)), []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory rejects a review gate citing evidence that does not exist", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-gate-evidence-"));
    try {
      const documents = validPassedDocuments(directory);
      documents["review.json"].gates = {
        hostToolchainSingle: {
          status: "pass",
          tool: "Assert-BuildToolchain.ps1",
          exitCode: 0,
          evidence: "evidence/assert-build-toolchain-arm64.txt"
        }
      };

      const errors = validateRunDirectory(directory, documents);
      assert.ok(
        errors.some((error) =>
          error.startsWith("review.json gates.hostToolchainSingle.evidence does not exist")
        ),
        "a gate may not cite an evidence file that was never written"
      );

      fs.mkdirSync(path.join(directory, "evidence"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "evidence", "assert-build-toolchain-arm64.txt"),
        "cl HostArm64\\arm64 toolset 14.44.35207 x32\n"
      );
      assert.deepEqual(validateRunDirectory(directory, documents), []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory rejects omitted and zero-test suites", () => {    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-suite-completeness-"));
    try {
      const documents = validPassedDocuments(directory);
      documents["build.json"].requiredTestSuites.push("TestCppCli");
      documents["build.json"].testSuites[0].ran = 0;
      documents["build.json"].testSuites[0].passed = 0;
      const errors = validateRunDirectory(directory, documents);
      assert.ok(errors.includes("passed run requires testSuites to exactly match requiredTestSuites"));
      assert.ok(
        errors.includes(
          "passed run requires every recorded test suite to exit 0 with zero failures and passed equal to ran"
        )
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory rejects suite manifests omitted from analysis and plan", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-suite-source-"));
    try {
      const documents = validPassedDocuments(directory);
      documents["analysis.json"].structure.requiredTestSuites = [];
      assert.ok(
        validateRunDirectory(directory, documents).includes(
          "passed run requires requiredTestSuites to match analysis, plan, and build evidence"
        )
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory rejects stale LIB roots and version-prefix mismatches", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-toolchain-roots-"));
    try {
      const documents = validPassedDocuments(directory);
      documents["build.json"].toolchain.buildCompiler.version = "14.44.35207.1";
      documents["build.json"].toolchain.buildCompiler.path =
        "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207.1\\bin\\Hostarm64\\arm64\\cl.exe";
      documents["build.json"].toolchain.lib =
        "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\lib\\arm64;" +
        "C:\\VS\\VC\\Tools\\MSVC\\14.29.30133\\lib\\arm64";
      const errors = validateRunDirectory(directory, documents);
      assert.ok(
        errors.includes(
          "passed run requires dependency compiler, build compiler, linker, and VCToolsVersion to match"
        )
      );
      assert.ok(errors.includes("passed run requires LIB to use only the declared VCToolsVersion"));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory accepts the atlmfc and spectre ARM64 LIB roots a real build emits", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-toolchain-atlmfc-"));
    const msvcRoot = "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207";
    try {
      const documents = validPassedDocuments(directory);
      // Observed verbatim in the ARM64 binlog of OpenCppCoverage-ARM64 run 32357865925.
      documents["build.json"].toolchain.lib =
        `${msvcRoot}\\lib\\ARM64;` +
        `${msvcRoot}\\atlmfc\\lib\\ARM64;` +
        `${msvcRoot}\\lib\\spectre\\arm64;` +
        "C:\\Program Files (x86)\\Windows Kits\\10\\lib\\10.0.26100.0\\ucrt\\arm64";
      assert.deepEqual(validateRunDirectory(directory, documents), []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory still rejects non-ARM64 MSVC LIB roots after the atlmfc allowance", () => {
    const msvcRoot = "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207";
    for (const badRoot of [
      `${msvcRoot}\\lib\\x64`,
      `${msvcRoot}\\lib\\ARM`,
      `${msvcRoot}\\atlmfc\\lib\\x86`,
      `${msvcRoot}\\lib\\arm64\\uwp`,
      `${msvcRoot}\\lib\\onecore\\x64`
    ]) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-toolchain-badlib-"));
      try {
        const documents = validPassedDocuments(directory);
        documents["build.json"].toolchain.lib = `${msvcRoot}\\lib\\ARM64;${badRoot}`;
        assert.ok(
          validateRunDirectory(directory, documents).includes(
            "passed run requires every MSVC LIB root to target declared-version ARM64"
          ),
          `expected ${badRoot} to be rejected`
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  test("passed run directory rejects x64 and swapped ARM64 tool paths", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-toolchain-target-"));
    try {
      const documents = validPassedDocuments(directory);
      const toolchain = documents["build.json"].toolchain;
      toolchain.dependencyCompiler.path =
        "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\link.exe";
      toolchain.linker.path =
        "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe";
      toolchain.lib = "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\lib\\x64";
      const errors = validateRunDirectory(directory, documents);
      assert.ok(
        errors.includes(
          "passed run requires ARM64 cl.exe/link.exe paths under the declared VCToolsVersion"
        )
      );
      assert.ok(
        errors.includes("passed run requires every MSVC LIB root to target declared-version ARM64")
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory rejects mixed same-version x64 and ARM64 LIB roots", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-toolchain-mixed-lib-"));
    try {
      const documents = validPassedDocuments(directory);
      documents["build.json"].toolchain.lib =
        "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\lib\\x64;" +
        "C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\lib\\arm64";
      assert.ok(
        validateRunDirectory(directory, documents).includes(
          "passed run requires every MSVC LIB root to target declared-version ARM64"
        )
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("passed run directory rejects omitted acceptance scenarios", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-scenario-completeness-"));
    try {
      const documents = validPassedDocuments(directory);
      documents["runtime.json"].scenarios = [];
      assert.ok(
        validateRunDirectory(directory, documents).includes(
          "passed run requires every planned acceptance scenario to pass with matching observed output"
        )
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("passed run directory binds runtime commands and expectations to the plan", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-scenario-binding-"));
  try {
    const documents = validPassedDocuments(directory);
    const result = documents["runtime.json"].scenarios[0];
    result.command = "different-command";
    result.expectedResult = "fabricated";
    result.observedResult = "fabricated";
    assert.ok(
      validateRunDirectory(directory, documents).includes(
        "passed run requires every planned acceptance scenario to pass with matching observed output"
      )
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ready release directory rejects missing package and evidence files", () => {
  const errors = validateRunDirectory("runs/fixture", {
    "release.json": {
      state: "ready",
      package: {
        path: "artifacts/package.zip",
        manifestPath: "artifacts/MANIFEST.json",
        checksumFile: "artifacts/SHA256SUMS.txt",
        name: "OpenCppCoverage-win-arm64.zip",
        size: 42,
        sha256
      },
      gates: {
        build: { evidence: "evidence/build.log" }
      }
    }
  });

  assert.ok(errors.some((error) => error.startsWith("package.path does not exist")));
  assert.ok(errors.some((error) => error.startsWith("gates.build.evidence does not exist")));
});

test("schema-invalid ready release reports missing package instead of throwing", () => {
  const errors = validateRunDirectory("runs/fixture", {
    "release.json": { state: "ready" }
  });

  assert.deepEqual(errors, ["ready release requires package and gates"]);
});

test("schema-invalid nested records report errors instead of throwing", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-invalid-nested-"));
    try {
      fs.writeFileSync(path.join(directory, "artifact.bin"), "x");
      const handoffErrors = validateRunDirectory(directory, {
        "handoff.json": {
          state: "accepted",
          source: {
            repo: "github.com/owner/repo",
            baselineCommit: "a".repeat(40),
            headCommit: "b".repeat(40),
            immutableUrl: `https://github.com/owner/repo/commit/${"b".repeat(40)}`
          },
          changes: null,
          artifacts: [null],
          evidence: [null]
        }
      });
      assert.ok(handoffErrors.includes("accepted handoff requires source, changes, artifacts, and evidence"));

      const nullEvidenceErrors = validateRunDirectory(directory, {
        "handoff.json": {
          state: "accepted",
          source: {
            repo: "github.com/owner/repo",
            baselineCommit: "a".repeat(40),
            headCommit: "b".repeat(40),
            immutableUrl: `https://github.com/owner/repo/commit/${"b".repeat(40)}`
          },
          changes: {
            path: "artifact.bin",
            sha256: require("node:crypto").createHash("sha256").update("x").digest("hex")
          },
          artifacts: [],
          evidence: [null]
        }
      });
      assert.ok(nullEvidenceErrors.includes("evidence[0] must be an evidence record"));

      const malformedSuiteErrors = validateRunDirectory(directory, {
        "run.json": { status: "passed" },
        "build.json": { testSuites: {} }
      });
      assert.ok(
        malformedSuiteErrors.includes(
          "passed run requires every recorded test suite to exit 0 with zero failures and passed equal to ran"
        )
      );

      const malformedToolchainDocuments = validPassedDocuments(directory);
      malformedToolchainDocuments["build.json"].toolchain = {};
      assert.ok(
        validateRunDirectory(directory, malformedToolchainDocuments).includes(
          "passed run requires ARM64 cl.exe/link.exe paths under the declared VCToolsVersion"
        )
      );

      const malformedScenarioDocuments = validPassedDocuments(directory);
      malformedScenarioDocuments["analysis.json"].structure.acceptanceScenarios = [null];
      assert.ok(
        validateRunDirectory(directory, malformedScenarioDocuments).includes(
          "passed run requires every planned acceptance scenario to pass with matching observed output"
        )
      );

      const malformedPlanDocuments = validPassedDocuments(directory);
      malformedPlanDocuments["plan.json"].acceptanceScenarios.push(null);
      assert.ok(
        validateRunDirectory(directory, malformedPlanDocuments).includes(
          "passed run requires every planned acceptance scenario to pass with matching observed output"
        )
      );

      const malformedCommitErrors = validateRunDirectory(directory, {
        "handoff.json": {
          state: "accepted",
          source: {
            repo: "github.com/owner/repo",
            headCommit: "b".repeat(40),
            immutableUrl: `https://github.com/owner/repo/commit/${"b".repeat(40)}`,
            evidenceCommits: {}
          },
          changes: {
            path: "artifact.bin",
            sha256: require("node:crypto").createHash("sha256").update("x").digest("hex")
          },
          artifacts: [
            {
              path: "artifact.bin",
              size: 1,
              sha256: require("node:crypto").createHash("sha256").update("x").digest("hex"),
              sourceCommit: "b".repeat(40)
            }
          ],
          evidence: []
        }
      });
      assert.deepEqual(malformedCommitErrors, []);

      const releaseErrors = validateRunDirectory(directory, {
        "release.json": {
          state: "ready",
          package: {
            path: "artifact.bin",
            manifestPath: "missing.json",
            checksumFile: "missing.txt"
          },
          gates: {}
        }
      });
      assert.ok(releaseErrors.includes("package.sha256 must be SHA-256"));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("manifest rejects Windows-equivalent paths", () => {
    const errors = validateManifest({
      schemaVersion: "1.0",
      files: [
        { path: "Dir\\Tool.exe", size: 1, sha256 },
        { path: "dir/tool.exe", size: 1, sha256 }
      ]
    });

    assert.ok(errors.some((error) => error.startsWith("contains Windows-equivalent paths")));
});

test("manifest rejects Win32-aliased and reserved path segments", () => {
  for (const unsafePath of ["tool.exe.", "tool.exe ", "NUL.txt", "dir/file:stream"]) {
    const errors = validateManifest({
      schemaVersion: "1.0",
      files: [{ path: unsafePath, size: 1, sha256 }]
    });
    assert.ok(
      errors.includes("files[0].path must be a safe Windows relative path"),
      unsafePath
    );
  }
});

test("archive rejects case-insensitive path collisions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-archive-collision-"));
  try {
    const packagePath = path.join(directory, "collision.zip");
    const archive = new AdmZip();
    archive.addFile("Tool.exe", Buffer.from("x"));
    archive.addFile("tool.exe", Buffer.from("x"));
    archive.writeZip(packagePath);
    const errors = compareManifestToArchive(packagePath, {
      schemaVersion: "1.0",
      files: [
        {
          path: "Tool.exe",
          size: 1,
          sha256: require("node:crypto").createHash("sha256").update("x").digest("hex")
        }
      ]
    });

    assert.ok(
      errors.some((error) => error.startsWith("archive contains Windows-equivalent paths"))
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("archive rejects Win32 trailing-dot aliases", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-archive-dot-alias-"));
  try {
    const packagePath = path.join(directory, "collision.zip");
    const archive = new AdmZip();
    archive.addFile("tool.exe", Buffer.from("x"));
    archive.addFile("tool.exe.", Buffer.from("x"));
    archive.writeZip(packagePath);
    const errors = compareManifestToArchive(packagePath, {
      schemaVersion: "1.0",
      files: [
        {
          path: "tool.exe",
          size: 1,
          sha256: require("node:crypto").createHash("sha256").update("x").digest("hex")
        }
      ]
    });

    assert.ok(errors.includes("archive contains unsafe path tool.exe."));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("accepted handoff directory verifies source URL, files, hashes, and measured evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-handoff-"));
  try {
    const errors = validateRunDirectory(directory, {
      "handoff.json": {
        state: "accepted",
        source: {
          repo: "github.com/owner/repo",
          headCommit: "b".repeat(40),
          immutableUrl: "https://example.com/not-the-commit"
        },
        changes: { path: "missing.patch", sha256 },
        artifacts: [{ path: "missing.zip", size: 42, sha256 }],
        evidence: [
          {
            kind: "runtime",
            status: "pass",
            path: "empty.log",
            size: 1,
            sha256,
            sourceCommit: "b".repeat(40),
            command: "",
            exitCode: 1,
            runnerType: "local",
            runner: "native ARM64 fixture"
          }
        ]
      }
    });

    assert.ok(errors.some((error) => error.startsWith("accepted handoff immutableUrl")));
    assert.ok(errors.some((error) => error.startsWith("changes.path does not exist")));
    assert.ok(errors.some((error) => error.includes("runtime pass requires command")));
    assert.ok(errors.some((error) => error.includes("runtime pass requires exitCode 0")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("accepted handoff directory accepts bound immutable evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-handoff-valid-"));
  try {
    fs.writeFileSync(path.join(directory, "port.patch"), "committed change");
    fs.writeFileSync(path.join(directory, "analysis.json"), "{}");
    const patch = fs.readFileSync(path.join(directory, "port.patch"));
    const patchHash = require("node:crypto").createHash("sha256").update(patch).digest("hex");
    const errors = validateRunDirectory(directory, {
      "handoff.json": {
        state: "accepted",
        source: {
          repo: "github.com/owner/repo",
          headCommit: "b".repeat(40),
          immutableUrl: `https://github.com/owner/repo/commit/${"b".repeat(40)}`
        },
        changes: { path: "port.patch", sha256: patchHash },
        artifacts: [{ path: "port.patch", size: patch.length, sha256: patchHash }],
        evidence: [
          {
            kind: "analysis",
            status: "pass",
            path: "analysis.json",
            size: 2,
            sha256: require("node:crypto").createHash("sha256").update("{}").digest("hex"),
            sourceCommit: "b".repeat(40),
            runnerType: "local",
            runner: "local analysis fixture"
          }
        ]
      }
    });

    assert.deepEqual(errors, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("accepted handoff rejects passing evidence from an alternate revision", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-handoff-alternate-"));
  try {
    fs.writeFileSync(path.join(directory, "analysis.json"), "{}");
    const contents = fs.readFileSync(path.join(directory, "analysis.json"));
    const hash = require("node:crypto").createHash("sha256").update(contents).digest("hex");
    const headCommit = "b".repeat(40);
    const alternateCommit = "c".repeat(40);
    const errors = validateRunDirectory(directory, {
      "handoff.json": {
        state: "accepted",
        source: {
          repo: "github.com/owner/repo",
          headCommit,
          evidenceCommits: [alternateCommit],
          immutableUrl: `https://github.com/owner/repo/commit/${headCommit}`
        },
        changes: { path: "analysis.json", sha256: hash },
        artifacts: [{ path: "analysis.json", size: contents.length, sha256: hash }],
        evidence: [
          {
            kind: "analysis",
            status: "pass",
            path: "analysis.json",
            size: contents.length,
            sha256: hash,
            sourceCommit: alternateCommit,
            runnerType: "local",
            runner: "local fixture"
          }
        ]
      }
    });

    assert.ok(errors.some((error) => error.includes("sourceCommit is not declared")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("pending handoff directory rejects unbound and unprovenanced failure evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-handoff-pending-"));
  try {
    fs.writeFileSync(path.join(directory, "native.log"), "native failure");
    const errors = validateRunDirectory(directory, {
      "handoff.json": {
        state: "pending",
        source: { headCommit: "b".repeat(40) },
        evidence: [
          {
            kind: "test",
            status: "fail",
            path: "native.log",
            size: 14,
            sha256: "0".repeat(64),
            sourceCommit: "c".repeat(40),
            command: "CppCoverageTest.exe",
            exitCode: 1,
            runnerType: "github-actions",
            runner: "GitHub windows-11-arm run 123"
          }
        ]
      }
    });

    assert.ok(errors.some((error) => error.includes("sha256 does not match")));
    assert.ok(errors.some((error) => error.includes("sourceCommit is not declared")));
    assert.ok(errors.some((error) => error.includes("workflowUrl is required")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("pending handoff permits alternate commits only for failure evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-handoff-alt-pass-"));
  try {
    fs.writeFileSync(path.join(directory, "analysis.json"), "{}");
    const contents = fs.readFileSync(path.join(directory, "analysis.json"));
    const alternateCommit = "c".repeat(40);
    const errors = validateRunDirectory(directory, {
      "handoff.json": {
        state: "pending",
        source: {
          headCommit: "b".repeat(40),
          evidenceCommits: [alternateCommit]
        },
        evidence: [
          {
            kind: "analysis",
            status: "pass",
            path: "analysis.json",
            size: contents.length,
            sha256: require("node:crypto").createHash("sha256").update(contents).digest("hex"),
            sourceCommit: alternateCommit,
            runnerType: "local",
            runner: "local fixture"
          }
        ]
      }
    });

    assert.ok(errors.some((error) => error.includes("alternate-commit evidence must have status fail")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("pending handoff rejects workflow provenance from another repository", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-handoff-workflow-"));
  try {
    fs.writeFileSync(path.join(directory, "native.log"), "native failure");
    const sourceCommit = "b".repeat(40);
    const contents = fs.readFileSync(path.join(directory, "native.log"));
    const errors = validateRunDirectory(directory, {
      "handoff.json": {
        state: "pending",
        source: {
          repo: "github.com/owner/repo",
          headCommit: sourceCommit
        },
        evidence: [
          {
            kind: "test",
            status: "fail",
            path: "native.log",
            size: contents.length,
            sha256: require("node:crypto").createHash("sha256").update(contents).digest("hex"),
            sourceCommit,
            command: "CppCoverageTest.exe",
            exitCode: 1,
            runnerType: "github-actions",
            runner: "windows-11-arm run 123",
            workflowUrl: "https://github.com/other/repo/actions/runs/123"
          }
        ]
      }
    });

    assert.ok(errors.some((error) => error.includes("workflowUrl must identify")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("release directory rejects malformed manifest and empty gate evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-release-"));
  try {
    fs.mkdirSync(path.join(directory, "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(directory, "evidence"), { recursive: true });
    const packagePath = path.join(directory, "artifacts", "OpenCppCoverage-win-arm64.zip");
    const archive = new AdmZip();
    archive.addFile("tool.exe", Buffer.from("x"));
    archive.writeZip(packagePath);
    const packageHash = require("node:crypto")
      .createHash("sha256")
      .update(fs.readFileSync(packagePath))
      .digest("hex");
    fs.writeFileSync(path.join(directory, "artifacts", "MANIFEST.json"), "{}");
    fs.writeFileSync(
      path.join(directory, "artifacts", "SHA256SUMS.txt"),
      `${packageHash}  OpenCppCoverage-win-arm64.zip\n`
    );
    fs.writeFileSync(path.join(directory, "evidence", "build.log"), "");

    const errors = validateRunDirectory(directory, {
      "release.json": {
        state: "ready",
        package: {
          path: "artifacts/OpenCppCoverage-win-arm64.zip",
          manifestPath: "artifacts/MANIFEST.json",
          checksumFile: "artifacts/SHA256SUMS.txt",
          name: "OpenCppCoverage-win-arm64.zip",
          size: fs.statSync(packagePath).size,
          sha256: packageHash
        },
        gates: { build: { evidence: "evidence/build.log" } }
      }
    });

    assert.ok(errors.some((error) => error === "gates.build.evidence is empty"));
    assert.ok(
      errors.some((error) => error === "package.manifestPath must have schemaVersion 1.0")
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ready release directory accepts bound package manifest checksum and evidence", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winport-release-valid-"));
      try {
        fs.mkdirSync(path.join(directory, "artifacts"), { recursive: true });
        fs.mkdirSync(path.join(directory, "evidence"), { recursive: true });
        const packagePath = path.join(directory, "artifacts", "tool-win-arm64.zip");
        const archive = new AdmZip();
        archive.addFile("tool.exe", Buffer.from("x"));
        archive.writeZip(packagePath);
        const packageHash = require("node:crypto")
          .createHash("sha256")
          .update(fs.readFileSync(packagePath))
          .digest("hex");
        fs.writeFileSync(
          path.join(directory, "artifacts", "MANIFEST.json"),
          JSON.stringify({
            schemaVersion: "1.0",
            files: [
              {
                path: "tool.exe",
                size: 1,
                sha256: require("node:crypto").createHash("sha256").update("x").digest("hex")
              }
            ]
          })
        );
        fs.writeFileSync(
          path.join(directory, "artifacts", "SHA256SUMS.txt"),
          `${packageHash}  tool-win-arm64.zip\n`
        );
        fs.writeFileSync(path.join(directory, "evidence", "gate.log"), "PASS\n");
        const gateNames = [
          "build",
          "tests",
          "arm64Runtime",
          "purity",
          "packageContents",
          "sourceAvailable",
          "checksum",
          "redownload"
        ];
        const gates = Object.fromEntries(
          gateNames.map((name) => [name, { evidence: "evidence/gate.log" }])
        );
        const errors = validateRunDirectory(directory, {
          "release.json": {
            state: "ready",
            package: {
              path: "artifacts/tool-win-arm64.zip",
              manifestPath: "artifacts/MANIFEST.json",
              checksumFile: "artifacts/SHA256SUMS.txt",
              name: "tool-win-arm64.zip",
              size: fs.statSync(packagePath).size,
              sha256: packageHash
            },
            gates
          }
        });

        assert.deepEqual(errors, []);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
});
