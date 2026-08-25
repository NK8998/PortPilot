from __future__ import annotations

import json
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from portpilot.analysis.common import load_manifest, read_json, utc_now, write_json
from portpilot.analysis.runner import analyze
from portpilot.contracts import validate_contract
from portpilot.planner import create_plan
from portpilot.reporting import create_report, load_tasks
from portpilot.state import RUN_ID_PATTERN, RunState


TASK_TRANSITIONS = {
    "pending": {"ready", "blocked"},
    "ready": {"in-progress", "blocked"},
    "in-progress": {"review", "failed", "blocked"},
    "review": {"done", "in-progress", "blocked"},
    "blocked": {"ready"},
    "failed": {"ready"},
    "done": set(),
}

FINDING_TRANSITIONS = {
    "open": {"in-progress", "accepted", "resolved", "wont-fix", "not-applicable"},
    "in-progress": {"open", "accepted", "resolved", "wont-fix", "not-applicable"},
    "accepted": {"in-progress"},
    "resolved": {"in-progress"},
    "wont-fix": {"in-progress"},
    "not-applicable": {"in-progress"},
}
TERMINAL_FINDING_STATUSES = {"accepted", "resolved", "wont-fix", "not-applicable"}


def default_run_id(manifest_path: Path) -> str:
    project_id = load_manifest(manifest_path)["project"]["id"]
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return f"{project_id}-{timestamp}"


def git_output(repository: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"git {' '.join(arguments)} failed: {message}")
    return result.stdout.strip()


def normalized_repository_url(value: str) -> str:
    return value.removesuffix(".git").rstrip("/").lower()


def verify_repository(state: RunState) -> None:
    project = state.load_project()
    repository = Path(project["source"]["workspace"])
    if not (repository / ".git").exists():
        raise ValueError(f"{repository} is not a Git checkout")
    revision = git_output(repository, "rev-parse", "HEAD")
    if revision != project["source"]["revision"]:
        raise ValueError(
            f"source revision is {revision}, expected {project['source']['revision']}"
        )
    changes = git_output(repository, "status", "--porcelain")
    if changes:
        raise ValueError("source checkout is not clean")
    origin = git_output(repository, "remote", "get-url", "origin")
    if normalized_repository_url(origin) != normalized_repository_url(
        project["source"]["repository"]
    ):
        raise ValueError(
            f"source origin is {origin}, expected {project['source']['repository']}"
        )


def run_analysis_stage(state: RunState) -> dict[str, Any]:
    state.transition("analysis", "in-progress", "analyzing")
    try:
        verify_repository(state)
        summary = analyze(
            state.manifest_path,
            Path(state.load_project()["source"]["workspace"]),
            state.root,
        )
        state.transition("analysis", "done", "analyzed")
        return summary
    except BaseException:
        state.transition("analysis", "failed", "failed")
        raise


def run_planning_stage(state: RunState) -> dict[str, Any]:
    project = state.load_project()
    if project["stages"]["analysis"] != "done":
        raise RuntimeError("analysis must complete before planning")
    state.transition("planning", "in-progress", "analyzed")
    try:
        graph = create_plan(state.root)
        state.transition("planning", "done", "planned")
        return graph
    except BaseException:
        state.transition("planning", "failed", "failed")
        raise


def run_reporting_stage(state: RunState) -> dict[str, Any]:
    project = state.load_project()
    if project["stages"]["planning"] != "done":
        raise RuntimeError("planning must complete before reporting")
    project_status = project["status"]
    state.transition("reporting", "in-progress", project_status)
    try:
        report = create_report(state.root)
        current = state.load_project()
        state.transition("reporting", "done", current["status"])
        return report
    except BaseException:
        state.transition("reporting", "failed", "failed")
        raise


def run_pipeline(state: RunState) -> dict[str, Any]:
    with state.lock():
        project = state.load_project()
        resumed = any(value == "done" for value in project["stages"].values())
        if project["stages"]["analysis"] != "done":
            run_analysis_stage(state)
        if state.load_project()["stages"]["planning"] != "done":
            run_planning_stage(state)
        run_reporting_stage(state)
        status = status_summary(state)
        status["resumed"] = resumed
        return status


def status_summary(state: RunState) -> dict[str, Any]:
    project = state.load_project()
    tasks = load_tasks(state.root)
    task_statuses: dict[str, int] = {}
    for task in tasks:
        validate_contract("task.schema.json", task)
        task_statuses[task["status"]] = task_statuses.get(task["status"], 0) + 1
    return {
        "runId": project["runId"],
        "runDirectory": str(state.root),
        "projectId": project["projectId"],
        "status": project["status"],
        "stages": project["stages"],
        "tasks": task_statuses,
        "readyTasks": [task["id"] for task in tasks if task["status"] == "ready"],
    }


def update_task_status(
    state: RunState,
    task_id: str,
    new_status: str,
) -> dict[str, Any]:
    if not RUN_ID_PATTERN.fullmatch(task_id):
        raise ValueError(f"invalid task ID: {task_id}")
    task_path = state.root / "tasks" / f"{task_id}.json"
    if not task_path.is_file():
        raise ValueError(f"unknown task: {task_id}")
    with state.lock():
        task = read_json(task_path)
        validate_contract("task.schema.json", task)
        if task["id"] != task_id:
            raise ValueError(
                f"task file identity mismatch: expected {task_id}, found {task['id']}"
            )
        current_status = task["status"]
        if new_status not in TASK_TRANSITIONS[current_status]:
            raise ValueError(
                f"invalid task transition: {current_status} -> {new_status}"
            )
        if new_status == "in-progress":
            dependency_statuses = {
                dependency: read_json(
                    state.root / "tasks" / f"{dependency}.json"
                )["status"]
                for dependency in task["dependsOn"]
            }
            incomplete = [
                dependency
                for dependency, status in dependency_statuses.items()
                if status != "done"
            ]
            if incomplete:
                raise ValueError(
                    f"task dependencies are incomplete: {', '.join(incomplete)}"
                )
            task["attempts"] += 1
        if new_status == "done" and task["findingIds"]:
            findings = {
                finding["id"]: finding
                for finding in read_json(state.root / "findings.json")
            }
            missing = [
                finding_id
                for finding_id in task["findingIds"]
                if finding_id not in findings
            ]
            if missing:
                raise ValueError(
                    f"task references unknown findings: {', '.join(missing)}"
                )
            unresolved = [
                finding_id
                for finding_id in task["findingIds"]
                if findings[finding_id]["status"] not in TERMINAL_FINDING_STATUSES
            ]
            if unresolved:
                raise ValueError(
                    "task findings require dispositions: "
                    + ", ".join(unresolved)
                )
        task["status"] = new_status
        validate_contract("task.schema.json", task)
        write_json(task_path, task)

        tasks = load_tasks(state.root)
        completed = {item["id"] for item in tasks if item["status"] == "done"}
        for candidate in tasks:
            if (
                candidate["status"] == "pending"
                and set(candidate["dependsOn"]) <= completed
            ):
                candidate["status"] = "ready"
                write_json(
                    state.root / "tasks" / f"{candidate['id']}.json",
                    candidate,
                )

        tasks = load_tasks(state.root)
        project = state.load_project()
        if all(item["status"] == "done" for item in tasks):
            project["stages"]["execution"] = "done"
            project["status"] = "validating"
        elif any(item["status"] in {"in-progress", "review"} for item in tasks):
            project["stages"]["execution"] = "in-progress"
            project["status"] = "running"
        elif any(item["status"] in {"blocked", "failed"} for item in tasks):
            project["stages"]["execution"] = "blocked"
            project["status"] = "blocked"
        else:
            project["stages"]["execution"] = "pending"
            project["status"] = "planned"
        project["stages"]["reporting"] = "pending"
        (state.root / "report.json").unlink(missing_ok=True)
        state.save_project(project)
        return task


def update_finding_status(
    state: RunState,
    finding_id: str,
    new_status: str,
    rationale: str | None = None,
    evidence: list[str] | None = None,
) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Z0-9]+-[A-Z0-9-]+-[0-9]{3}", finding_id):
        raise ValueError(f"invalid finding ID: {finding_id}")
    with state.lock():
        findings = read_json(state.root / "findings.json")
        matches = [finding for finding in findings if finding["id"] == finding_id]
        if len(matches) != 1:
            raise ValueError(f"unknown finding: {finding_id}")
        finding = matches[0]
        current_status = finding["status"]
        if new_status not in FINDING_TRANSITIONS:
            raise ValueError(f"invalid finding status: {new_status}")
        if new_status not in FINDING_TRANSITIONS[current_status]:
            raise ValueError(
                f"invalid finding transition: {current_status} -> {new_status}"
            )
        if new_status in TERMINAL_FINDING_STATUSES:
            cleaned_rationale = (rationale or "").strip()
            cleaned_evidence = sorted(
                {item.strip() for item in (evidence or []) if item.strip()}
            )
            if not cleaned_rationale or not cleaned_evidence:
                raise ValueError(
                    "terminal finding dispositions require rationale and evidence"
                )
            finding["disposition"] = {
                "rationale": cleaned_rationale,
                "evidence": cleaned_evidence,
                "updatedAt": utc_now(),
            }
        else:
            finding.pop("disposition", None)
        finding["status"] = new_status
        for item in findings:
            validate_contract("finding.schema.json", item)
        write_json(state.root / "findings.json", findings)
        project = state.load_project()
        project["stages"]["reporting"] = "pending"
        state.save_project(project)
        (state.root / "report.json").unlink(missing_ok=True)
        return finding


def print_json(value: Any) -> None:
    print(json.dumps(value, indent=2))
