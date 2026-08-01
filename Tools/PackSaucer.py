#!/usr/bin/env python3
"""Configure Saucer with CMake and package its source plus fetched dependency sources."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Configure Saucer with CMake and package source plus _deps *-src trees.")
    parser.add_argument(
        "--source",
        type=Path,
        default=repository_root / "Deps" / "saucer",
        help="Path to the Saucer source tree (default: Deps/saucer).",
    )
    parser.add_argument(
        "--build-dir",
        type=Path,
        default=repository_root / "Deps" / "saucer" / "build",
        help="CMake build directory (default: Deps/saucer/build).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repository_root / "dist" / "saucer-src-windows-x64.zip",
        help="Generated ZIP file (default: dist/saucer-src-windows-x64.zip).",
    )
    parser.add_argument(
        "--generator",
        default="Ninja",
        help="CMake generator to use (default: Ninja).",
    )
    parser.add_argument(
        "--config",
        default="Release",
        help="CMake build configuration (default: Release).",
    )
    return parser.parse_args()


def run_command(command: list[str]) -> None:
    print("+", subprocess.list2cmdline(command))
    subprocess.run(command, check=True)


def collect_files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*") if path.is_file())


def add_directory(archive: ZipFile, directory: Path, archive_root: Path) -> int:
    files = collect_files(directory)
    for file_path in files:
        archive.write(file_path, (archive_root / file_path.relative_to(directory)).as_posix())
    return len(files)


def configure_and_package(args: argparse.Namespace) -> int:
    source = args.source.resolve()
    build_dir = args.build_dir.resolve()
    output = args.output.resolve()

    if not source.is_dir():
        raise ValueError(f"Saucer source directory does not exist: {source}")

    output.parent.mkdir(parents=True, exist_ok=True)
    run_command(
        [
            "cmake",
            "-S",
            str(source),
            "-B",
            str(build_dir),
            "-G",
            args.generator,
            f"-DCMAKE_BUILD_TYPE={args.config}",
            "-Dsaucer_examples=OFF",
            "-Dsaucer_tests=OFF",
        ]
    )

    deps_dir = build_dir / "_deps"
    if not deps_dir.is_dir():
        raise ValueError(f"CMake _deps directory was not created: {deps_dir}")

    dep_src_dirs = sorted(path for path in deps_dir.iterdir() if path.is_dir() and path.name.endswith("-src"))
    if not dep_src_dirs:
        raise ValueError(f"No *-src directories found under: {deps_dir}")

    # Exclude the build tree from the saucer source package.
    skip_prefixes = (build_dir.resolve(),)
    source_files = [path for path in collect_files(source) if not any(path.resolve().is_relative_to(prefix) for prefix in skip_prefixes)]
    if not source_files:
        raise ValueError(f"Saucer source directory is empty after excluding build: {source}")

    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for file_path in source_files:
            archive.write(
                file_path,
                (Path("saucer") / file_path.relative_to(source)).as_posix(),
            )
        file_count = len(source_files)

        for dep_src in dep_src_dirs:
            added = add_directory(archive, dep_src, Path("deps") / dep_src.name)
            print(f"Packed dependency source: {dep_src.name} ({added} file(s))")
            file_count += added

    print(f"Created {output} with {file_count} file(s).")
    print("Included dependency sources:")
    for dep_src in dep_src_dirs:
        print(f"  - {dep_src.name}")
    return 0


def main() -> int:
    args = parse_args()
    try:
        return configure_and_package(args)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
