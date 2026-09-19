#!/usr/bin/env python3
"""Clone the repository named in the config and copy the configured assets into this repository."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

DEFAULT_CONFIG = Path(".github") / "config" / "CopyAssets.json"
COMMIT_AUTHOR_NAME = "github-actions[bot]"
COMMIT_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"

CONFIG_KEYS = {"clone_url", "clone_path", "clone_ref", "copy_folder", "copy_file"}
REQUIRED_KEYS = ("clone_url", "clone_path")
ENTRY_KEYS = {"src_path", "dst_path"}


def parse_args(repository_root: Path) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clone the repository named in the config and copy the configured assets into this repository.")
    parser.add_argument(
        "--config",
        type=Path,
        default=repository_root / DEFAULT_CONFIG,
        help=f"JSON config file (default: {DEFAULT_CONFIG.as_posix()}).",
    )
    parser.add_argument(
        "--branch",
        default="",
        help="Branch of this repository to commit and push to (default: the checked-out branch).",
    )
    parser.add_argument(
        "--message",
        default="Copy assets",
        help="Commit message.",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Push the commit to origin; without it the change is only committed locally.",
    )
    return parser.parse_args()


def run_command(
    command: list[str],
    cwd: Path | None = None,
    check: bool = True,
    capture: bool = False,
) -> subprocess.CompletedProcess:
    print("+", subprocess.list2cmdline(command), flush=True)
    return subprocess.run(command, check=check, cwd=cwd, capture_output=capture, text=capture)


def remove_tree(directory: Path) -> None:
    """Remove a directory tree, clearing the read-only bit git sets on its object files."""

    def force_permissions(func: object, path: str, exc_info: object) -> None:
        os.chmod(path, stat.S_IWRITE)
        func(path)  # type: ignore[operator]

    # shutil.rmtree renamed onerror to onexc in 3.12.
    if sys.version_info >= (3, 12):
        shutil.rmtree(directory, onexc=force_permissions)
    else:
        shutil.rmtree(directory, onerror=force_permissions)


def load_config(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f"Config file does not exist: {path}")

    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path}: {error}") from error

    if not isinstance(config, dict):
        raise ValueError(f"Config must be a JSON object: {path}")

    unknown = sorted(set(config) - CONFIG_KEYS)
    if unknown:
        raise ValueError(f"Unknown config key(s) in {path}: {', '.join(unknown)}")

    for key in REQUIRED_KEYS:
        if not isinstance(config.get(key), str) or not config[key]:
            raise ValueError(f"Config needs a non-empty '{key}' string: {path}")

    if not isinstance(config.get("clone_ref", ""), str):
        raise ValueError(f"Config key 'clone_ref' must be a string: {path}")
    return config


def parse_entries(config: dict, key: str, path: Path) -> list[tuple[Path, Path]]:
    entries = config.get(key, [])
    if not isinstance(entries, list):
        raise ValueError(f"Config key '{key}' must be a list: {path}")

    parsed: list[tuple[Path, Path]] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"{key}[{index}] must be a JSON object: {path}")

        unknown = sorted(set(entry) - ENTRY_KEYS)
        if unknown:
            raise ValueError(f"Unknown {key}[{index}] key(s) in {path}: {', '.join(unknown)}")

        source, target = entry.get("src_path"), entry.get("dst_path")
        if not isinstance(source, str) or not source or not isinstance(target, str) or not target:
            raise ValueError(f"{key}[{index}] needs non-empty 'src_path' and 'dst_path' strings: {path}")

        parsed.append((Path(source), Path(target)))
    return parsed


def resolve_inside(repository_root: Path, path: Path) -> Path:
    resolved = path if path.is_absolute() else repository_root / path
    return resolved.resolve()


def current_branch(repository_root: Path) -> str:
    """The branch checked out here; the default push target, so main and master both work."""
    result = run_command(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repository_root, capture=True)
    branch = result.stdout.strip()
    if not branch or branch == "HEAD":
        raise ValueError(f"Repository is on a detached HEAD; pass --branch explicitly: {repository_root}")
    return branch


def prepare_work_dir(work_dir: Path) -> None:
    if not work_dir.exists():
        work_dir.parent.mkdir(parents=True, exist_ok=True)
        return
    if not (work_dir / ".git").exists() and any(work_dir.iterdir()):
        raise ValueError(f"Refusing to remove non-empty non-repository directory: {work_dir}")

    print(f"Removing existing clone: {work_dir}")
    remove_tree(work_dir)


def clone_repository(config: dict, work_dir: Path) -> None:
    prepare_work_dir(work_dir)

    command = ["git", "clone", "--depth", "1"]
    if config.get("clone_ref"):
        command += ["--branch", config["clone_ref"]]
    run_command(command + [config["clone_url"], str(work_dir)])


def describe_layout(root: Path, max_depth: int = 2, limit: int = 40) -> str:
    """List the clone's directories, so a wrong src_path can be fixed from the log."""
    lines: list[str] = []

    def walk(directory: Path, depth: int) -> None:
        if depth > max_depth or len(lines) >= limit:
            return
        for path in sorted(directory.iterdir(), key=lambda entry: (entry.is_file(), entry.name)):
            if path.name == ".git":
                continue

            lines.append(f"  {'  ' * (depth - 1)}{path.name}{'/' if path.is_dir() else ''}")
            if len(lines) >= limit:
                lines.append("  ... (truncated)")
                return
            if path.is_dir():
                walk(path, depth + 1)

    walk(root, 1)
    return "\n".join(lines)


def check_sources(work_dir: Path, folders: list[tuple[Path, Path]], files: list[tuple[Path, Path]]) -> None:
    """Fail before copying anything, reporting every bad src_path and the clone's real layout."""
    expected = [(source, "directory") for source, _ in folders] + [(source, "file") for source, _ in files]

    problems: list[str] = []
    for source, kind in expected:
        path = work_dir / source
        if (kind == "directory" and path.is_dir()) or (kind == "file" and path.is_file()):
            continue

        state = "missing" if not path.exists() else f"is not a {kind}"
        problems.append(f"  {source.as_posix()} ({state})")

    if problems:
        raise ValueError(
            "Configured src_path is not usable in the clone:\n"
            + "\n".join(problems)
            + f"\nLayout of {work_dir}:\n"
            + describe_layout(work_dir)
        )


def copy_folder(source: Path, target: Path, repository_root: Path) -> None:
    if not source.is_dir():
        raise ValueError(f"Asset directory does not exist: {source}")

    if not target.is_relative_to(repository_root):
        raise ValueError(f"Refusing to write assets outside the repository: {target}")

    if target.exists():
        print(f"Removing existing assets: {target}")
        remove_tree(target)

    shutil.copytree(source, target)
    files = [path for path in target.rglob("*") if path.is_file()]
    print(f"Copied {len(files)} file(s) from {source} to {target}")


def copy_file(source: Path, target: Path, repository_root: Path) -> None:
    if not source.is_file():
        raise ValueError(f"Asset file does not exist: {source}")

    if not target.is_relative_to(repository_root):
        raise ValueError(f"Refusing to write assets outside the repository: {target}")

    if target.is_dir():
        raise ValueError(f"Asset file target is a directory: {target}")

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    print(f"Copied file {source} to {target}")


def commit_assets(args: argparse.Namespace, repository_root: Path, targets: list[Path], branch: str) -> int:
    relative_targets = [target.relative_to(repository_root).as_posix() for target in targets]
    run_command(["git", "add", "--", *relative_targets], cwd=repository_root)

    staged = run_command(["git", "diff", "--cached", "--quiet"], cwd=repository_root, check=False)
    if staged.returncode == 0:
        print(f"No changes under {', '.join(relative_targets)}; nothing to commit.")
    else:
        run_command(
            [
                "git",
                "-c",
                f"user.name={COMMIT_AUTHOR_NAME}",
                "-c",
                f"user.email={COMMIT_AUTHOR_EMAIL}",
                "commit",
                "-m",
                args.message,
            ],
            cwd=repository_root,
        )

    if not args.push:
        print(f"Left {', '.join(relative_targets)} committed locally.")
        return 0

    # Always push, even without a new commit: a commit left behind by an earlier
    # run would otherwise never reach the remote.
    run_command(["git", "push", "origin", f"HEAD:{branch}"], cwd=repository_root)
    print(f"Pushed {', '.join(relative_targets)} to {branch}.")
    return 0


def copy_configured_assets(args: argparse.Namespace) -> int:
    repository_root = Path(__file__).resolve().parents[2]
    config_path = resolve_inside(repository_root, args.config)

    config = load_config(config_path)
    folders = parse_entries(config, "copy_folder", config_path)
    files = parse_entries(config, "copy_file", config_path)
    if not folders and not files:
        raise ValueError(f"Config lists nothing to copy, expected 'copy_folder' or 'copy_file': {config_path}")

    work_dir = resolve_inside(repository_root, Path(config["clone_path"]))
    clone_repository(config, work_dir)
    check_sources(work_dir, folders, files)

    targets: list[Path] = []
    # Folders first: a folder copy replaces its destination, so files copied into
    # that destination beforehand would be dropped.
    for source, target in folders:
        resolved_target = resolve_inside(repository_root, target)
        copy_folder(work_dir / source, resolved_target, repository_root)
        targets.append(resolved_target)

    for source, target in files:
        resolved_target = resolve_inside(repository_root, target)
        copy_file(work_dir / source, resolved_target, repository_root)
        targets.append(resolved_target)

    branch = args.branch or current_branch(repository_root)
    return commit_assets(args, repository_root, targets, branch)


def main() -> int:
    args = parse_args(Path(__file__).resolve().parents[2])
    try:
        return copy_configured_assets(args)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
