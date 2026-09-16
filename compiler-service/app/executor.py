"""
Executor module: compiles and runs C code.

Two modes:
  - Docker mode (production): each execution runs in an isolated Docker container
    with strict resource limits, no network, non-root user, read-only filesystem.
  - Mock mode (development): uses subprocess with a timeout; NO sandbox security.
    NEVER use mock mode in production or with untrusted code.
"""
import os
import shutil
import subprocess
import tempfile
import time
import uuid
import logging
from typing import Optional

from .config import settings
from .models import ExecuteResponse

logger = logging.getLogger(__name__)


class ExecutionError(Exception):
    pass


def _write_source(tmpdir: str, source_code: str) -> str:
    """Write source code to temp directory. Returns path to source file."""
    src_path = os.path.join(tmpdir, "solution.c")
    with open(src_path, "w", encoding="utf-8") as f:
        f.write(source_code)
    return src_path


def _docker_execute(
    source_code: str,
    stdin: str,
    timeout_ms: int,
    memory_limit_mb: int,
) -> ExecuteResponse:
    """
    Execute C code in an isolated Docker container.

    Security measures:
    - --network none: no network access
    - --memory / --memory-swap: hard memory cap
    - --cpus: CPU throttle
    - --pids-limit: prevent fork bombs
    - --read-only: immutable container FS
    - --tmpfs /tmp: writable temp only (noexec, nosuid)
    - --user 1001:1001: non-root
    - --security-opt no-new-privileges: no privilege escalation
    - --cap-drop ALL: remove all Linux capabilities
    - --rm: auto-remove container after exit
    """
    timeout_s = timeout_ms / 1000
    exec_id = str(uuid.uuid4())[:8]

    with tempfile.TemporaryDirectory() as tmpdir:
        src_path = _write_source(tmpdir, source_code)
        stdin_path = os.path.join(tmpdir, "stdin.txt")
        with open(stdin_path, "w", encoding="utf-8") as f:
            f.write(stdin)

        # Mount source dir as read-only into container
        docker_cmd = [
            "docker", "run", "--rm",
            "--name", f"fcf-exec-{exec_id}",
            "--network", "none",
            f"--memory={memory_limit_mb}m",
            f"--memory-swap={memory_limit_mb}m",
            f"--cpus={settings.max_cpu}",
            f"--pids-limit={settings.max_pids}",
            "--read-only",
            "--tmpfs", "/tmp:rw,exec,nosuid,size=32m",
            "--user", "1001:1001",
            "--security-opt", "no-new-privileges",
            "--cap-drop", "ALL",
            "-v", f"{tmpdir}:/code:ro",
            settings.sandbox_image,
            "/bin/sh", "-c",
            (
                "cp /code/solution.c /tmp/solution.c && "
                "gcc -O2 -o /tmp/solution /tmp/solution.c -lm 2>/tmp/compile_err.txt; "
                "COMPILE_EXIT=$?; "
                "if [ $COMPILE_EXIT -ne 0 ]; then "
                "  echo 'COMPILE_FAILED'; cat /tmp/compile_err.txt; exit 2; "
                "fi; "
                "/tmp/solution </code/stdin.txt 2>/tmp/run_err.txt; "
                "RUN_EXIT=$?; "
                "cat /tmp/run_err.txt >&2; "
                "exit $RUN_EXIT"
            ),
        ]

        start = time.monotonic()
        try:
            proc = subprocess.run(
                docker_cmd,
                input=stdin,
                capture_output=True,
                text=True,
                timeout=timeout_s + 2,  # extra 2s buffer for docker overhead
            )
            elapsed_ms = int((time.monotonic() - start) * 1000)

            # Parse output
            stdout = proc.stdout or ""
            stderr = proc.stderr or ""

            if proc.returncode == 2:
                # Compilation failed
                compile_error = stdout.replace("COMPILE_FAILED\n", "", 1).strip()
                return ExecuteResponse(
                    success=False,
                    status="compile_error",
                    stdout="",
                    stderr="",
                    compile_error=compile_error or "Compilation failed",
                    execution_time_ms=elapsed_ms,
                    memory_used_mb=None,
                )

            if proc.returncode == 137:
                # OOM killed
                return ExecuteResponse(
                    success=False,
                    status="memory_limit_exceeded",
                    stdout="",
                    stderr=stderr[:2048],
                    compile_error=None,
                    execution_time_ms=elapsed_ms,
                    memory_used_mb=memory_limit_mb,
                )

            if proc.returncode != 0:
                return ExecuteResponse(
                    success=False,
                    status="runtime_error",
                    stdout=stdout[:4096],
                    stderr=stderr[:2048],
                    compile_error=None,
                    execution_time_ms=elapsed_ms,
                    memory_used_mb=None,
                )

            return ExecuteResponse(
                success=True,
                status="accepted",
                stdout=stdout[:4096],
                stderr=stderr[:2048],
                compile_error=None,
                execution_time_ms=elapsed_ms,
                memory_used_mb=None,
            )

        except subprocess.TimeoutExpired:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            # Kill the container
            subprocess.run(
                ["docker", "rm", "-f", f"fcf-exec-{exec_id}"],
                capture_output=True,
            )
            return ExecuteResponse(
                success=False,
                status="time_limit_exceeded",
                stdout="",
                stderr="",
                compile_error=None,
                execution_time_ms=elapsed_ms,
                memory_used_mb=None,
            )

        except Exception as e:
            logger.exception("Docker execution error")
            return ExecuteResponse(
                success=False,
                status="system_error",
                stdout="",
                stderr="",
                compile_error=None,
                execution_time_ms=0,
                memory_used_mb=None,
            )


def _mock_execute(
    source_code: str,
    stdin: str,
    timeout_ms: int,
    memory_limit_mb: int,
) -> ExecuteResponse:
    """
    DEVELOPMENT ONLY — executes on host with subprocess.
    NO SANDBOX. NO SECURITY. Never use with untrusted code.
    Requires gcc to be installed on host.
    """
    import sys
    import shutil
    import re

    logger.warning("MOCK MODE: executing code on host — development only, NOT secure")

    timeout_s = timeout_ms / 1000

    # Locate compiler
    compiler = shutil.which("gcc") or shutil.which("clang")

    if not compiler:
        logger.warning("No C compiler (gcc/clang) found on host. Attempting mock interpretation for dev.")
        # Dumb Charades fallback: simple printf / puts extraction
        pattern = re.compile(r'(?:printf\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\)|puts\s*\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\))')
        matches = pattern.findall(source_code)
        if matches:
            out_parts = []
            for m in matches:
                txt = m[0] if m[0] else m[1]
                try:
                    txt = txt.encode().decode('unicode_escape')
                except Exception:
                    pass
                if m[1]:  # puts appends newline
                    txt += "\n"
                out_parts.append(txt)
            output = "".join(out_parts)
            return ExecuteResponse(
                success=True,
                status="accepted",
                stdout=output[:4096],
                stderr="",
                compile_error=None,
                execution_time_ms=10,
                memory_used_mb=None,
            )
        return ExecuteResponse(
            success=False,
            status="compile_error",
            stdout="",
            stderr="",
            compile_error="Host C compiler (gcc) not found in PATH and mock parser could not parse output. Please install GCC.",
            execution_time_ms=0,
            memory_used_mb=None,
        )

    # On Windows, default TEMP is in user profile (may have spaces in path).
    # gcc/ld fail when source/output path contains spaces. Use C:\Temp if on Windows.
    import sys as _sys
    safe_base = "C:\\Temp" if _sys.platform == "win32" and os.path.isdir("C:\\Temp") else None
    with tempfile.TemporaryDirectory(dir=safe_base) as tmpdir:
        src_path = os.path.join(tmpdir, "solution.c")
        bin_path = os.path.join(tmpdir, "solution")

        with open(src_path, "w", encoding="utf-8") as f:
            f.write(source_code)

        # Compile
        try:
            compile_result = subprocess.run(
                [compiler, "-O2", "-o", bin_path, src_path, "-lm"],
                capture_output=True, text=True, timeout=10,
            )
        except Exception as e:
            return ExecuteResponse(
                success=False,
                status="compile_error",
                stdout="",
                stderr="",
                compile_error=f"Compilation execution failed: {str(e)}",
                execution_time_ms=0,
                memory_used_mb=None,
            )

        if compile_result.returncode != 0:
            return ExecuteResponse(
                success=False,
                status="compile_error",
                stdout="",
                stderr="",
                compile_error=compile_result.stderr[:4096] or "Compilation failed",
                execution_time_ms=0,
                memory_used_mb=None,
            )

        exe_path = bin_path
        if sys.platform == "win32" and not os.path.exists(exe_path) and os.path.exists(f"{bin_path}.exe"):
            exe_path = f"{bin_path}.exe"

        # Run
        start = time.monotonic()
        try:
            run_result = subprocess.run(
                [exe_path],
                input=stdin,
                capture_output=True,
                text=True,
                timeout=timeout_s,
            )
            elapsed_ms = int((time.monotonic() - start) * 1000)

            if run_result.returncode != 0:
                return ExecuteResponse(
                    success=False,
                    status="runtime_error",
                    stdout=run_result.stdout[:4096],
                    stderr=run_result.stderr[:2048],
                    compile_error=None,
                    execution_time_ms=elapsed_ms,
                    memory_used_mb=None,
                )

            return ExecuteResponse(
                success=True,
                status="accepted",
                stdout=run_result.stdout[:4096],
                stderr=run_result.stderr[:2048],
                compile_error=None,
                execution_time_ms=elapsed_ms,
                memory_used_mb=None,
            )

        except subprocess.TimeoutExpired:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            return ExecuteResponse(
                success=False,
                status="time_limit_exceeded",
                stdout="",
                stderr="",
                compile_error=None,
                execution_time_ms=elapsed_ms,
                memory_used_mb=None,
            )
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            return ExecuteResponse(
                success=False,
                status="runtime_error",
                stdout="",
                stderr=str(e),
                compile_error=None,
                execution_time_ms=elapsed_ms,
                memory_used_mb=None,
            )


def execute(
    source_code: str,
    stdin: str = "",
    timeout_ms: int = 5000,
    memory_limit_mb: int = 64,
) -> ExecuteResponse:
    """Main entry point — routes to Docker or mock based on config."""
    # Clamp to configured maximums
    timeout_ms = min(timeout_ms, settings.max_timeout_ms)
    memory_limit_mb = min(memory_limit_mb, settings.max_memory_mb)

    if settings.mock_mode:
        return _mock_execute(source_code, stdin, timeout_ms, memory_limit_mb)
    else:
        return _docker_execute(source_code, stdin, timeout_ms, memory_limit_mb)
