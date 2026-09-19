#!/usr/bin/env python3
"""Clone the water repository and copy its demo assets into Assets/water."""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

DEFAULT_REPOSITORY = "https://github.com/marklundin/water.git"
DEFAULT_SOURCE = Path("demo") / "assets"
DEFAULT_TARGET = Path("Assets") / "water"
COMMIT_AUTHOR_NAME = "github-actions[bot]"
COMMIT_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Clone the water repository and copy its demo assets into Assets/water.")
    parser.add_argument(
        "--repo",
        default=DEFAULT_REPOSITORY,
        help=f"water repository URL to clone (default: {DEFAULT_REPOSITORY}).",
    )
    parser.add_argument(
        "--ref",
        default="",
        help="water tag or branch to clone (default: the repository default branch).",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=repository_root / "External" / "water",
        help="Clone destination (default: External/water).",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"Assets directory inside the clone (default: {DEFAULT_SOURCE.as_posix()}).",
    )
    parser.add_argument(
        "--target",
        type=Path,
        default=DEFAULT_TARGET,
        help=f"Assets directory in this repository (default: {DEFAULT_TARGET.as_posix()}).",
    )
    parser.add_argument(
        "--branch",
        default="main",
        help="Branch of this repository to commit and push to (default: main).",
    )
    parser.add_argument(
        "--message",
        default="Copy water demo assets",
        help="Commit message.",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Push the commit to origin; without it the change is only committed locally.",
    )
    return parser.parse_args()


def run_command(command: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print("+", subprocess.list2cmdline(command), flush=True)
    return subprocess.run(command, check=check, cwd=cwd)


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


def prepare_work_dir(work_dir: Path) -> None:
    if not work_dir.exists():
        work_dir.parent.mkdir(parents=True, exist_ok=True)
        return
    if not (work_dir / ".git").exists() and any(work_dir.iterdir()):
        raise ValueError(f"Refusing to remove non-empty non-repository directory: {work_dir}")

    print(f"Removing existing clone: {work_dir}")
    remove_tree(work_dir)


def clone_water(args: argparse.Namespace, work_dir: Path) -> None:
    prepare_work_dir(work_dir)
    command = ["git", "clone", "--depth", "1"]
    if args.ref:
        command += ["--branch", args.ref]
    run_command(command + [args.repo, str(work_dir)])


def copy_assets(source: Path, target: Path, repository_root: Path) -> None:
    if not source.is_dir():
        raise ValueError(f"water assets directory does not exist: {source}")

    if not target.is_relative_to(repository_root):
        raise ValueError(f"Refusing to write assets outside the repository: {target}")

    if target.exists():
        print(f"Removing existing assets: {target}")
        remove_tree(target)

    shutil.copytree(source, target)
    files = [path for path in target.rglob("*") if path.is_file()]
    print(f"Copied {len(files)} file(s) from {source} to {target}")


def resolve_target(repository_root: Path, target: Path) -> Path:
    resolved = target if target.is_absolute() else repository_root / target
    return resolved.resolve()


def commit_assets(args: argparse.Namespace, repository_root: Path, target: Path) -> int:
    relative_target = target.relative_to(repository_root).as_posix()
    run_command(["git", "add", "--", relative_target], cwd=repository_root)

    staged = run_command(["git", "diff", "--cached", "--quiet"], cwd=repository_root, check=False)
    if staged.returncode == 0:
        print(f"No changes under {relative_target}; nothing to commit.")
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
        print(f"Left {relative_target} committed locally.")
        return 0

    # Always push, even without a new commit: a commit left behind by an earlier
    # run would otherwise never reach the remote.
    run_command(["git", "push", "origin", f"HEAD:{args.branch}"], cwd=repository_root)
    print(f"Pushed {relative_target} to {args.branch}.")
    return 0


def copy_water_assets(args: argparse.Namespace) -> int:
    repository_root = Path(__file__).resolve().parents[1]
    work_dir = args.work_dir.resolve()
    target = resolve_target(repository_root, args.target)

    clone_water(args, work_dir)
    copy_assets(work_dir / args.source, target, repository_root)
    return commit_assets(args, repository_root, target)


def main() -> int:
    args = parse_args()
    try:
        return copy_water_assets(args)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
