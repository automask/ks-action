#!/usr/bin/env python3
"""Apply the configured patches to this repository with git am and push the result."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

DEFAULT_CONFIG = Path(".github") / "config" / "ApplyPatch.json"
COMMIT_AUTHOR_NAME = "github-actions[bot]"
COMMIT_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"
# --3way falls back on a three-way merge, --ignore-space-change tolerates CRLF
# noise and --keep-cr stops mailsplit from stripping CR from patch lines.
GIT_AM_OPTIONS = ("--3way", "--ignore-space-change", "--keep-cr")


def parse_args(repository_root: Path) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply the patch files listed in the config with git am and push the result.")
    parser.add_argument(
        "--config",
        type=Path,
        default=repository_root / DEFAULT_CONFIG,
        help=f"JSON config file (default: {DEFAULT_CONFIG.as_posix()}).",
    )
    parser.add_argument(
        "--branch",
        default="main",
        help="Branch of this repository to commit and push to (default: main).",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Push the commits to origin; without it they are only committed locally.",
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


def resolve_inside(repository_root: Path, path: Path) -> Path:
    resolved = path if path.is_absolute() else repository_root / path
    return resolved.resolve()


def load_patches(path: Path, repository_root: Path) -> list[Path]:
    if not path.is_file():
        raise ValueError(f"Config file does not exist: {path}")

    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path}: {error}") from error

    if not isinstance(config, list) or not config:
        raise ValueError(f"Config must be a non-empty JSON array of patch paths: {path}")

    patches: list[Path] = []
    for index, entry in enumerate(config):
        if not isinstance(entry, str) or not entry:
            raise ValueError(f"Config entry {index} must be a non-empty path string: {path}")

        patch = resolve_inside(repository_root, Path(entry))
        if not patch.is_file():
            raise ValueError(f"Patch file does not exist: {patch}")
        patches.append(patch)
    return patches


def require_clean_tree(repository_root: Path) -> None:
    """git am refuses a dirty index anyway; check first for a clearer message."""
    status = run_command(["git", "status", "--porcelain"], cwd=repository_root, check=False, capture=True)
    if status.stdout.strip():
        raise ValueError(f"Working tree is not clean; commit or stash first:\n{status.stdout.rstrip()}")


def is_series_applied(patches: list[Path], repository_root: Path) -> bool:
    """Report whether the series result is already in the tree.

    Only the last patch is probed: git am commits the whole series or none of
    it, and once a later patch is applied the earlier ones no longer reverse
    cleanly on their own.
    """
    reverse = run_command(
        ["git", "apply", "--reverse", "--check", "--", str(patches[-1])],
        cwd=repository_root,
        check=False,
        capture=True,
    )
    return reverse.returncode == 0


def apply_patches(patches: list[Path], repository_root: Path) -> None:
    """Apply the whole series in one git am run, so a failure can be rolled back whole."""
    command = [
        "git",
        "-c",
        f"user.name={COMMIT_AUTHOR_NAME}",
        "-c",
        f"user.email={COMMIT_AUTHOR_EMAIL}",
        "am",
        *GIT_AM_OPTIONS,
        "--",
        *[str(patch) for patch in patches],
    ]
    result = run_command(command, cwd=repository_root, check=False, capture=True)
    if result.stdout.strip():
        print(result.stdout.rstrip())

    if result.returncode == 0:
        return

    # A failed am leaves the repository mid-operation; abort restores the original branch.
    run_command(["git", "am", "--abort"], cwd=repository_root, check=False, capture=True)
    raise ValueError(f"git am failed, the repository was restored to its previous state:\n{result.stderr.strip()}")


def apply_configured_patches(args: argparse.Namespace) -> int:
    repository_root = Path(__file__).resolve().parents[2]
    config_path = resolve_inside(repository_root, args.config)

    patches = load_patches(config_path, repository_root)
    require_clean_tree(repository_root)

    if is_series_applied(patches, repository_root):
        print(f"Already applied: {patches[-1]}")
        print("No changes; nothing to commit.")
    else:
        apply_patches(patches, repository_root)
        print(f"Applied {len(patches)} patch(es).")

    if not args.push:
        print("Left the patches committed locally.")
        return 0

    # Always push, even without new commits: commits left behind by an earlier
    # run would otherwise never reach the remote.
    run_command(["git", "push", "origin", f"HEAD:{args.branch}"], cwd=repository_root)
    print(f"Pushed to {args.branch}.")
    return 0


def main() -> int:
    args = parse_args(Path(__file__).resolve().parents[2])
    try:
        return apply_configured_patches(args)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
