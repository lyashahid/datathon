"""Isolated safety and rollout tests; never call Docker, SSH or any database."""

import ast
import importlib.util
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "datathon_deploy", Path(__file__).with_name("deploy.py")
)
deploy = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = deploy
SPEC.loader.exec_module(deploy)

OLD = deploy.Release("sha256:" + "1" * 64, "sha256:" + "2" * 64, "a" * 40)
NEW = deploy.Release("sha256:" + "3" * 64, "sha256:" + "4" * 64, "b" * 40)


class RequestTests(unittest.TestCase):
    def raw(self, **extra):
        return json.dumps(
            {
                "frontend_digest": NEW.frontend_digest,
                "backend_digest": NEW.backend_digest,
                "revision": NEW.revision,
                **extra,
            }
        ).encode()

    def test_only_digest_release_and_optional_registry_credentials_are_accepted(self):
        request = deploy.parse_request(
            self.raw(registry_user="lyashahid", registry_token="ghs_secret")
        )
        self.assertEqual(request.release, NEW)
        self.assertNotIn("ghs_secret", repr(request))
        self.assertIsNone(deploy.parse_request(self.raw()).registry_token)

    def test_rejects_arbitrary_paths_commands_images_and_malformed_requests(self):
        invalid = [
            self.raw(compose_file="/etc/another-app.yaml"),
            self.raw(command="sh"),
            self.raw(frontend_digest="ubuntu:latest"),
            self.raw(backend_digest=123),
            self.raw(revision="$(id)"),
            self.raw(registry_user="lyashahid"),
            self.raw(registry_user="bad;id", registry_token="token"),
            self.raw(registry_user="lyashahid", registry_token="secret\ncommand"),
            self.raw(registry_user="lyashahid", registry_token="x" * 4097),
            b"[]",
            b"not json",
            b"",
            b"x" * (deploy.MAX_REQUEST_BYTES + 1),
            self.raw()[:-1] + b',"revision":"' + b"c" * 40 + b'"}',
        ]
        for raw in invalid:
            with self.subTest(raw=raw[:60]), self.assertRaises(deploy.DeployError):
                deploy.parse_request(raw)


class RolloutTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.control = Path(self.temporary.name) / "control"
        self.control.mkdir()
        self.calls = []
        self.started_releases = []
        self.fail_pulls = False
        self.fail_starts = 0

    def fake_runner(self, arguments, *, environment, input_text=None, timeout=240):
        self.calls.append((arguments, dict(environment), input_text, timeout))
        if "up" in arguments:
            self.started_releases.append(deploy.read_release(self.control / "release.env"))
        if self.fail_pulls and arguments[1] == "pull":
            raise deploy.DeployError("Pull failed.")
        if "up" in arguments and self.fail_starts:
            self.fail_starts -= 1
            raise deploy.DeployError("Health failed.")

    def gateway(self):
        return deploy.Deployment(self.control, self.fake_runner)

    def test_pull_then_health_check_with_fixed_sanitized_configuration(self):
        deploy.write_release(self.control / "release.env", OLD)
        with patch.dict(os.environ, {"DOCKER_HOST": "evil", "COMPOSE_FILE": "/other"}):
            self.gateway().deploy(deploy.Request(NEW, "lyashahid", "ephemeral-secret"))
        arguments = [call[0] for call in self.calls]
        self.assertEqual(
            arguments[:3],
            [
                [
                    "/usr/bin/docker",
                    "login",
                    "ghcr.io",
                    "--username",
                    "lyashahid",
                    "--password-stdin",
                ],
                ["/usr/bin/docker", "pull", NEW.frontend_image],
                ["/usr/bin/docker", "pull", NEW.backend_image],
            ],
        )
        self.assertEqual(self.calls[0][2], "ephemeral-secret\n")
        self.assertNotIn("ephemeral-secret", repr(arguments))
        for _, environment, _, _ in self.calls:
            self.assertNotIn("DOCKER_HOST", environment)
            self.assertNotIn("COMPOSE_FILE", environment)
            self.assertNotIn("ephemeral-secret", repr(environment))
            self.assertEqual(Path(environment["DOCKER_CONFIG"]).parent, self.control)
            self.assertFalse(Path(environment["DOCKER_CONFIG"]).exists())
        final = arguments[-1]
        self.assertIn(str(self.control / "compose.yaml"), final)
        self.assertIn(str(self.control / "release.env"), final)
        self.assertEqual(final[final.index("--project-directory") + 1], str(self.control))
        self.assertIn("datathon", final)
        self.assertEqual(
            final[-9:],
            [
                "up",
                "--detach",
                "--wait",
                "--wait-timeout",
                "180",
                "--remove-orphans",
                "--no-build",
                "--pull",
                "never",
            ][-9:],
        )
        self.assertEqual(deploy.read_release(self.control / "release.env"), NEW)
        self.assertFalse(list(self.control.glob(".docker-*")))

    def test_failed_pull_leaves_existing_release_and_services_untouched(self):
        deploy.write_release(self.control / "release.env", OLD)
        self.fail_pulls = True
        with self.assertRaises(deploy.DeployError):
            self.gateway().deploy(deploy.Request(NEW))
        self.assertEqual(deploy.read_release(self.control / "release.env"), OLD)
        self.assertEqual(len(self.calls), 1)

    def test_failed_health_check_restores_previous_images_and_checks_their_health(self):
        deploy.write_release(self.control / "release.env", OLD)
        self.fail_starts = 1
        with self.assertRaisesRegex(deploy.DeployError, "previous release was restored"):
            self.gateway().deploy(deploy.Request(NEW))
        self.assertEqual(deploy.read_release(self.control / "release.env"), OLD)
        self.assertEqual(sum("up" in call[0] for call in self.calls), 2)
        self.assertEqual(self.started_releases, [NEW, OLD])
        self.assertFalse(
            any(
                token in {"down", "prune", "-v", "migrate"}
                for call in self.calls
                for token in call[0]
            )
        )

    def test_failed_rollback_reports_administrator_action_and_preserves_old_state(self):
        deploy.write_release(self.control / "release.env", OLD)
        self.fail_starts = 2
        with self.assertRaisesRegex(deploy.DeployError, "rollback failed"):
            self.gateway().deploy(deploy.Request(NEW))
        self.assertEqual(deploy.read_release(self.control / "release.env"), OLD)

    def test_failed_initial_release_stops_only_fixed_project_and_removes_state(self):
        self.fail_starts = 1
        with self.assertRaisesRegex(deploy.DeployError, "Initial deployment failed"):
            self.gateway().deploy(deploy.Request(NEW))
        self.assertFalse((self.control / "release.env").exists())
        self.assertEqual(self.calls[-1][0][-3:], ["stop", "--timeout", "20"])

    def test_corrupt_previous_state_fails_before_any_docker_operation(self):
        (self.control / "release.env").write_text("COMPOSE_FILE=/etc/another-app.yaml\n")
        with self.assertRaisesRegex(deploy.DeployError, "Stored release state"):
            self.gateway().deploy(deploy.Request(NEW))
        self.assertEqual(self.calls, [])


class ProtectionTests(unittest.TestCase):
    def test_gateway_and_tests_parse_on_host_python_310(self):
        for path in (Path(__file__), Path(__file__).with_name("deploy.py")):
            with self.subTest(file=path.name):
                ast.parse(path.read_text("utf-8"), feature_version=(3, 10))

    def test_layout_checks_every_ancestor_and_fixed_control_file(self):
        control = Path("/srv/datathon/control")
        with patch.object(deploy, "assert_secure_path") as protect:
            deploy.secure_layout(control)
        directory_calls = [
            call.args[0] for call in protect.call_args_list if call.kwargs["directory"]
        ]
        self.assertEqual(directory_calls, [control, *control.parents])
        file_calls = [
            call.args[0].name for call in protect.call_args_list if not call.kwargs["directory"]
        ]
        self.assertEqual(file_calls, ["deploy.py", "compose.yaml", "frontend.env", "backend.env"])

    def test_rejects_symlinks_writable_files_and_non_root_ownership(self):
        for mode, owner in [
            (stat.S_IFLNK | 0o777, 0),
            (stat.S_IFREG | 0o666, 0),
            (stat.S_IFREG | 0o600, 1000),
        ]:
            with (
                self.subTest(mode=mode, owner=owner),
                patch.object(
                    Path, "lstat", return_value=SimpleNamespace(st_mode=mode, st_uid=owner)
                ),
                self.assertRaises(deploy.DeployError),
            ):
                deploy.assert_secure_path(Path("protected"), directory=False)

    def test_accepts_only_protected_root_owned_regular_file(self):
        with patch.object(
            Path, "lstat", return_value=SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0)
        ):
            deploy.assert_secure_path(Path("protected"), directory=False)

    def test_docker_failure_never_includes_subprocess_output_or_exception_text(self):
        error = deploy.subprocess.CalledProcessError(
            1, "docker", output="secret", stderr="password"
        )
        with patch.object(deploy.subprocess, "run", side_effect=error):
            with self.assertRaises(deploy.DeployError) as result:
                deploy.run_command(["/usr/bin/docker"], environment={"HOME": "/protected"})
        self.assertNotIn("secret", str(result.exception))
        self.assertNotIn("password", str(result.exception))


if __name__ == "__main__":
    unittest.main()
