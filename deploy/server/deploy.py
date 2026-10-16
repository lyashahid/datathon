#!/usr/bin/python3 -I
"""Fixed, root-owned Datathon deployment gateway. Never execute checkout scripts."""

from __future__ import annotations

import json
import os
import re
import signal
import stat
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

MAX_REQUEST_BYTES = 8192
FRONTEND_IMAGE = "ghcr.io/lyashahid/datathon-frontend"
BACKEND_IMAGE = "ghcr.io/lyashahid/datathon-backend"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
REGISTRY_USER = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\Z")
EXTERNAL_ENVIRONMENT = {
    name: Path("/etc/server-apps") / f"datathon.{name}" for name in ("frontend.env", "backend.env")
}


class DeployError(Exception):
    """Only prewritten, non-secret messages may leave the gateway."""


@dataclass(frozen=True)
class Release:
    frontend_digest: str
    backend_digest: str
    revision: str

    def __post_init__(self) -> None:
        if not all(
            isinstance(value, str) and pattern.fullmatch(value)
            for value, pattern in (
                (self.frontend_digest, DIGEST),
                (self.backend_digest, DIGEST),
                (self.revision, REVISION),
            )
        ):
            raise DeployError("Invalid immutable release identifiers.")

    @property
    def frontend_image(self) -> str:
        return f"{FRONTEND_IMAGE}@{self.frontend_digest}"

    @property
    def backend_image(self) -> str:
        return f"{BACKEND_IMAGE}@{self.backend_digest}"

    def render(self) -> str:
        return (
            f"DATATHON_FRONTEND_IMAGE={self.frontend_image}\n"
            f"DATATHON_BACKEND_IMAGE={self.backend_image}\n"
            f"DATATHON_REVISION={self.revision}\n"
        )


@dataclass(frozen=True)
class Request:
    release: Release
    registry_user: str | None = None
    registry_token: str | None = field(default=None, repr=False)


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise DeployError("Duplicate request fields are not accepted.")
        result[key] = value
    return result


def parse_request(raw: bytes) -> Request:
    if not raw or len(raw) > MAX_REQUEST_BYTES:
        raise DeployError("Deployment request is empty or exceeds 8 KiB.")
    try:
        value = json.loads(raw, object_pairs_hook=_unique_object)
    except (ValueError, UnicodeError, RecursionError):
        raise DeployError("Deployment request must be a JSON object.") from None
    fields = {"frontend_digest", "backend_digest", "revision", "registry_user", "registry_token"}
    if not isinstance(value, dict) or set(value) - fields:
        raise DeployError("Unsupported deployment request fields.")
    if not {"frontend_digest", "backend_digest", "revision"} <= value.keys():
        raise DeployError("Both image digests and the source revision are required.")
    release = Release(value["frontend_digest"], value["backend_digest"], value["revision"])
    user, token = value.get("registry_user"), value.get("registry_token")
    if (user is None) != (token is None):
        raise DeployError("Registry authentication requires both username and token.")
    if user is not None and (
        not isinstance(user, str)
        or not REGISTRY_USER.fullmatch(user)
        or not isinstance(token, str)
        or not 1 <= len(token) <= 4096
        or not all(33 <= ord(character) <= 126 for character in token)
    ):
        raise DeployError("Invalid registry authentication fields.")
    return Request(release, user, token)


def read_release(path: Path) -> Release | None:
    if not path.exists():
        return None
    if path.stat().st_size > 1024:
        raise DeployError("Stored release state is invalid; an administrator must repair it.")
    try:
        values = dict(line.split("=", 1) for line in path.read_text("utf-8").splitlines())
        if set(values) != {
            "DATATHON_FRONTEND_IMAGE",
            "DATATHON_BACKEND_IMAGE",
            "DATATHON_REVISION",
        }:
            raise ValueError
        front = values["DATATHON_FRONTEND_IMAGE"]
        back = values["DATATHON_BACKEND_IMAGE"]
        if not front.startswith(FRONTEND_IMAGE + "@") or not back.startswith(BACKEND_IMAGE + "@"):
            raise ValueError
        release = Release(
            front.removeprefix(FRONTEND_IMAGE + "@"),
            back.removeprefix(BACKEND_IMAGE + "@"),
            values["DATATHON_REVISION"],
        )
        # Canonical formatting also rejects duplicate fields and hidden extra values.
        if path.read_text("utf-8") != release.render():
            raise ValueError
        return release
    except (ValueError, UnicodeError, DeployError):
        raise DeployError(
            "Stored release state is invalid; an administrator must repair it."
        ) from None


def write_release(path: Path, release: Release) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".release-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as target:
            target.write(release.render())
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def run_command(
    arguments: list[str],
    *,
    environment: dict[str, str],
    input_text: str | None = None,
    timeout: int = 240,
) -> None:
    try:
        subprocess.run(
            arguments,
            input=input_text,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=timeout,
            env=environment,
            cwd=environment["HOME"],
        )
    except (OSError, subprocess.SubprocessError):
        # Docker errors and daemon output can contain credentials or image-supplied text.
        raise DeployError(
            "A fixed Docker operation failed; inspect it locally as administrator."
        ) from None


class Deployment:
    def __init__(self, control: Path, runner: Callable = run_command) -> None:
        self.control = control
        self.root = control.parent
        self.state = control / "release.env"
        self.runner = runner

    def _compose(self, environment: dict[str, str], *operation: str) -> None:
        self.runner(
            [
                "/usr/bin/docker",
                "compose",
                "--project-name",
                "datathon",
                "--project-directory",
                str(self.control),
                "--env-file",
                str(self.state),
                "--file",
                str(self.control / "compose.yaml"),
                *operation,
            ],
            environment=environment,
        )

    def _start(self, environment: dict[str, str]) -> None:
        self._compose(
            environment,
            "up",
            "--detach",
            "--wait",
            "--wait-timeout",
            "180",
            "--remove-orphans",
            "--no-build",
            "--pull",
            "never",
        )

    def deploy(self, request: Request) -> None:
        previous = read_release(self.state)
        with tempfile.TemporaryDirectory(prefix=".docker-", dir=self.control) as config:
            environment = {
                "PATH": "/usr/bin:/bin",
                "HOME": str(self.control),
                "DOCKER_CONFIG": config,
                "LANG": "C.UTF-8",
            }
            if request.registry_token is not None:
                self.runner(
                    [
                        "/usr/bin/docker",
                        "login",
                        "ghcr.io",
                        "--username",
                        request.registry_user,
                        "--password-stdin",
                    ],
                    environment=environment,
                    input_text=request.registry_token + "\n",
                    timeout=90,
                )
            # Pull both immutable images before changing either running service or release state.
            for image in (request.release.frontend_image, request.release.backend_image):
                self.runner(
                    ["/usr/bin/docker", "pull", image], environment=environment, timeout=900
                )
            write_release(self.state, request.release)
            try:
                self._start(environment)
            except DeployError:
                if previous is not None:
                    write_release(self.state, previous)
                    try:
                        self._start(environment)
                    except DeployError:
                        raise DeployError(
                            "Deployment and health-checked rollback failed; "
                            "administrator action is required."
                        ) from None
                    raise DeployError(
                        "Deployment failed; the previous release was restored and is healthy."
                    ) from None
                try:
                    self._compose(environment, "stop", "--timeout", "20")
                except DeployError:
                    pass
                self.state.unlink(missing_ok=True)
                raise DeployError(
                    "Initial deployment failed; no successful release was recorded."
                ) from None


def assert_secure_path(path: Path, *, directory: bool) -> None:
    try:
        metadata = path.lstat()
    except OSError:
        raise DeployError(
            "Deployment control files are missing; run the administrator setup."
        ) from None
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise DeployError("Deployment control paths must be root-owned and protected from writes.")


def assert_secure_environment(path: Path) -> None:
    """Accept private local env files or the two fixed, protected server env targets."""
    target = path
    if path.is_symlink():
        if path.lstat().st_uid != 0 or path.name not in EXTERNAL_ENVIRONMENT:
            raise DeployError("Environment links must be root-owned and use the fixed targets.")
        target = EXTERNAL_ENVIRONMENT[path.name]
        if os.readlink(path) != str(target):
            raise DeployError("Environment links must use the fixed server env targets.")
        for directory in (target.parent, *target.parent.parents):
            assert_secure_path(directory, directory=True)
    assert_secure_path(target, directory=False)
    if target.lstat().st_mode & 0o077:
        raise DeployError("Environment files must be private to root (mode 0600).")


def secure_layout(control: Path) -> None:
    # Checking every ancestor prevents replacing a protected folder through a writable parent.
    for directory in (control, *control.parents):
        assert_secure_path(directory, directory=True)
    for name in ("deploy.py", "compose.yaml"):
        assert_secure_path(control / name, directory=False)
    env_paths = [control / name for name in EXTERNAL_ENVIRONMENT]
    if any(path.is_symlink() for path in env_paths) != all(path.is_symlink() for path in env_paths):
        raise DeployError("Both environment files must use the same protected storage layout.")
    for path in env_paths:
        assert_secure_environment(path)
    for name in ("release.env", "deploy.lock"):
        if (control / name).exists() or (control / name).is_symlink():
            assert_secure_path(control / name, directory=False)


@contextmanager
def deployment_lock(path: Path):
    import fcntl

    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise DeployError("Another Datathon deployment is already running.") from None
        yield
    finally:
        os.close(descriptor)


def main() -> int:
    try:
        if len(sys.argv) != 1 or os.environ.get("SSH_ORIGINAL_COMMAND", "") not in ("", "deploy"):
            raise DeployError("Only the fixed deployment operation is accepted.")
        if not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise DeployError(
                "The deployment gateway must run through its restricted administrator rule."
            )
        # Do not resolve away a symlink before checking the installed control path.
        control = Path(__file__).absolute().parent
        secure_layout(control)

        def expired(_signal, _frame):
            raise DeployError("Deployment request input timed out.")

        signal.signal(signal.SIGALRM, expired)
        signal.alarm(15)
        try:
            request = parse_request(sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1))
        finally:
            signal.alarm(0)
        with deployment_lock(control / "deploy.lock"):
            Deployment(control).deploy(request)
        print(f"Datathon release {request.release.revision} is healthy.")
        return 0
    except DeployError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        # Never reveal arbitrary exception representations to the deployment credential.
        print(
            "Deployment failed; an administrator must inspect the app deployment locally.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
