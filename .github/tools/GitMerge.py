#!/usr/bin/env python3
"""Clone the repository, write the merge data file and push the change back."""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

DEFAULT_DATA_PATH = Path("Assets") / "data.txt"
DEFAULT_CONTENT = "hello world"
COMMIT_AUTHOR_NAME = "github-actions[bot]"
COMMIT_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Clone a repository, write the merge data file and push the change back.")
    parser.add_argument(
        "--repo",
        required=True,
        help="Repository URL (or local path) to clone and push to.",
    )
    parser.add_argument(
        "--branch",
        default="main",
        help="Branch to clone and push (default: main).",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=repository_root / "Deps" / "git-merge",
        help="Clone destination (default: Deps/git-merge).",
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=DEFAULT_DATA_PATH,
        help=f"Data file path inside the repository (default: {DEFAULT_DATA_PATH.as_posix()}).",
    )
    parser.add_argument(
        "--content",
        default=DEFAULT_CONTENT,
        help=f"Content written to the data file (default: {DEFAULT_CONTENT!r}).",
    )
    parser.add_argument(
        "--message",
        default=f"Add {DEFAULT_DATA_PATH.name}",
        help="Commit message.",
    )
    return parser.parse_args()


def run_command(
    command: list[str],
    cwd: Path | None = None,
    secrets: tuple[str, ...] = (),
    check: bool = True,
) -> subprocess.CompletedProcess:
    display = subprocess.list2cmdline(command)
    for secret in secrets:
        display = display.replace(secret, "***")
    print("+", display, flush=True)
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


def authenticated_url(url: str, token: str | None) -> str:
    if not token:
        return url
    parsed = urlsplit(url)
    netloc = f"x-access-token:{token}@{parsed.netloc}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def prepare_work_dir(work_dir: Path) -> None:
    if not work_dir.exists():
        work_dir.parent.mkdir(parents=True, exist_ok=True)
        return
    if not (work_dir / ".git").exists() and any(work_dir.iterdir()):
        raise ValueError(f"Refusing to remove non-empty non-repository directory: {work_dir}")

    print(f"Removing existing clone: {work_dir}")
    remove_tree(work_dir)


def merge_data(args: argparse.Namespace) -> int:
    token = os.environ.get("GITHUB_TOKEN")
    work_dir = args.work_dir.resolve()
    data_path = Path(args.data_path)
    content = (args.content.rstrip("\n") + "\n").encode("utf-8")

    prepare_work_dir(work_dir)
    url = authenticated_url(args.repo, token)
    secrets = (token,) if token else ()
    run_command(
        ["git", "clone", "--depth", "1", "--branch", args.branch, url, str(work_dir)],
        secrets=secrets,
    )

    data_file = work_dir / data_path
    data_file.parent.mkdir(parents=True, exist_ok=True)
    data_file.write_bytes(content)
    print(f"Wrote {data_path.as_posix()}: {args.content!r}")

    run_command(["git", "add", data_path.as_posix()], cwd=work_dir)

    # Let git decide whether anything changed; comparing bytes here would trip over
    # core.autocrlf rewriting line endings on checkout.
    staged = run_command(["git", "diff", "--cached", "--quiet"], cwd=work_dir, check=False)
    if staged.returncode == 0:
        print(f"Already up to date: {data_path.as_posix()}")
        return 0

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
        cwd=work_dir,
    )
    run_command(["git", "push", "origin", f"HEAD:{args.branch}"], cwd=work_dir, secrets=secrets)

    print(f"Pushed {data_path.as_posix()} to {args.branch}.")
    return 0


def main() -> int:
    args = parse_args()
    try:
        return merge_data(args)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
