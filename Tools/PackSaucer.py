#!/usr/bin/env python3
"""Build Saucer with CMake and package its install tree as a ZIP archive."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Build Saucer with CMake and create a distributable ZIP archive.")
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
        default=repository_root / "dist" / "saucer-windows-x64.zip",
        help="Generated ZIP file (default: dist/saucer-windows-x64.zip).",
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
    parser.add_argument(
        "--parallel",
        type=int,
        default=os.cpu_count() or 1,
        help="Number of parallel build jobs (default: available CPUs).",
    )
    return parser.parse_args()


def run_command(command: list[str]) -> None:
    print("+", subprocess.list2cmdline(command))
    subprocess.run(command, check=True)


def package_directory(directory: Path, output: Path) -> int:
    files = sorted(path for path in directory.rglob("*") if path.is_file())
    if not files:
        raise ValueError(f"Install directory is empty: {directory}")

    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for file_path in files:
            archive.write(
                file_path,
                (Path("saucer") / file_path.relative_to(directory)).as_posix(),
            )

    print(f"Created {output} with {len(files)} file(s).")
    return 0


def build_and_package(args: argparse.Namespace) -> int:
    source = args.source.resolve()
    build_dir = args.build_dir.resolve()
    output = args.output.resolve()

    if not source.is_dir():
        raise ValueError(f"Saucer source directory does not exist: {source}")
    if args.parallel < 1:
        raise ValueError("--parallel must be at least 1.")

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
    run_command(
        [
            "cmake",
            "--build",
            str(build_dir),
            "--config",
            args.config,
            "--parallel",
            str(args.parallel),
        ]
    )

    with tempfile.TemporaryDirectory(prefix=".saucer-package-", dir=output.parent) as temp:
        install_dir = Path(temp) / "install"
        run_command(
            [
                "cmake",
                "--install",
                str(build_dir),
                "--config",
                args.config,
                "--prefix",
                str(install_dir),
            ]
        )

        license_file = source / "LICENSE"
        if license_file.is_file():
            license_directory = install_dir / "licenses"
            license_directory.mkdir(parents=True, exist_ok=True)
            shutil.copy2(license_file, license_directory / license_file.name)

        return package_directory(install_dir, output)


def main() -> int:
    args = parse_args()
    try:
        return build_and_package(args)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
