#!/usr/bin/env bash
# Run only inside an ephemeral container; never mounts a Docker socket or starts an app.
set -euo pipefail
[[ $EUID -eq 0 && -f /.dockerenv ]] || { echo 'Installer smoke checks require an ephemeral Docker container.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ "$source_dir" == /source ]] || { echo 'Mount only the deploy folder read-only at /source.' >&2; exit 1; }
[[ ! -S /var/run/docker.sock ]] || exit 1

# All host-affecting executables below are mocks inside this disposable container.
[[ -x /usr/bin/python3 ]] || ln -s "$(command -v python3)" /usr/bin/python3
cat > /usr/bin/docker <<'SH'
#!/bin/sh
[ "$1 $2 $3" = 'compose version --short' ] || exit 90
printf '%s\n' "${COMPOSE_TEST_VERSION:-2.20.0}"
SH
cat > /usr/bin/sudo <<'SH'
#!/bin/sh
exit 91
SH
cat > /usr/sbin/visudo <<'SH'
#!/bin/sh
[ "$1" = '-cf' ] && [ -f "$2" ]
SH
chmod 0755 /usr/bin/docker /usr/bin/sudo /usr/sbin/visudo
install -d -m 0755 /etc/sudoers.d /srv
useradd -m -s /bin/bash smokeadmin
install -d -o smokeadmin -g smokeadmin -m 0700 /home/smokeadmin/.ssh
printf 'ssh-ed25519 AAAA old-key\n' > /home/smokeadmin/.ssh/authorized_keys
chown smokeadmin:smokeadmin /home/smokeadmin/.ssh/authorized_keys
chmod 0600 /home/smokeadmin/.ssh/authorized_keys
# Match a public key copied from Windows without changing the upload first.
printf 'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA actions-smoke\r\n' > /tmp/actions.pub

install_app() { bash /source/install-server.sh "$1" smokeadmin /tmp/actions.pub; }
expect_rejection() {
  if install_app "$1" > /tmp/installer-rejection.log 2>&1; then
    echo "Unsafe installer case unexpectedly succeeded: $1" >&2
    exit 1
  fi
}

expect_command_rejection() {
  if "$@" > /tmp/installer-rejection.log 2>&1; then
    echo 'Unsafe installer command unexpectedly succeeded.' >&2
    exit 1
  fi
}

COMPOSE_TEST_VERSION=2.17.3 expect_rejection /srv/old-compose
[[ ! -e /srv/old-compose ]]
COMPOSE_TEST_VERSION=invalid expect_rejection /srv/invalid-compose
[[ ! -e /srv/invalid-compose ]]

printf 'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA actions-smoke\n\n' > /tmp/multiline-actions.pub
expect_command_rejection bash /source/install-server.sh /srv/multiline-key root /tmp/multiline-actions.pub
[[ ! -e /srv/multiline-key ]]
printf 'restrict ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA actions-smoke\r\n' > /tmp/options-actions.pub
expect_command_rejection bash /source/install-server.sh /srv/options-key root /tmp/options-actions.pub
[[ ! -e /srv/options-key ]]

install_app /srv/datathon-smoke > /tmp/installer-first.log
/usr/bin/python3 -I - <<'PY'
from pathlib import Path
import stat
control = Path('/srv/datathon-smoke/control')
front = dict(line.split('=', 1) for line in (control/'frontend.env').read_text().splitlines())
back = dict(line.split('=', 1) for line in (control/'backend.env').read_text().splitlines())
assert front['VELA_API_KEY'] == back['VELA_API_KEY']
assert len(front['VELA_API_KEY']) == 64
assert back['MOBILITY_COMPUTED_CACHE_POSTGRES_ENABLED'] == 'false'
for name in ('frontend.env', 'backend.env', 'authorized_keys.before-install'):
    metadata = (control/name).stat()
    assert metadata.st_uid == 0 and stat.S_IMODE(metadata.st_mode) == 0o600
assert not (control/'release.env').exists()
PY
first_env_hash=$(sha256sum /srv/datathon-smoke/control/frontend.env)
first_authorized_hash=$(sha256sum /home/smokeadmin/.ssh/authorized_keys)
install_app /srv/datathon-smoke > /tmp/installer-second.log
[[ "$first_env_hash" == "$(sha256sum /srv/datathon-smoke/control/frontend.env)" ]]
[[ "$first_authorized_hash" == "$(sha256sum /home/smokeadmin/.ssh/authorized_keys)" ]]
[[ $(grep -c 'restrict,command=' /home/smokeadmin/.ssh/authorized_keys) == 1 ]]
grep -Fq '/usr/bin/python3 -I /srv/datathon-smoke/control/deploy.py' /etc/sudoers.d/datathon-deploy

COMPOSE_TEST_VERSION=v2.40.3 bash /source/install-server.sh /srv/datathon-root-smoke root /tmp/actions.pub > /tmp/installer-root.log
grep -Fq 'restrict,command="/usr/bin/python3 -I /srv/datathon-root-smoke/control/deploy.py"' /root/.ssh/authorized_keys

# Nested server apps and shared env-directory conventions keep their existing permissions.
install -d -m 0750 /srv/apps /etc/server-apps
printf 'unrelated secret placeholder\n' > /etc/server-apps/other-app.env
chmod 0600 /etc/server-apps/other-app.env
printf 'ssh-ed25519 BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB nested-smoke\n' > /tmp/nested-actions.pub
install_nested() { bash /source/install-server.sh /srv/apps/datathon root /tmp/nested-actions.pub /etc/server-apps; }
install_nested > /tmp/installer-nested.log
[[ $(stat -c %a /srv/apps) == 750 && $(stat -c %a /etc/server-apps) == 750 ]]
[[ $(cat /etc/server-apps/other-app.env) == 'unrelated secret placeholder' ]]
[[ $(readlink /srv/apps/datathon/control/frontend.env) == /etc/server-apps/datathon.frontend.env ]]
[[ $(readlink /srv/apps/datathon/control/backend.env) == /etc/server-apps/datathon.backend.env ]]
[[ $(stat -c %a /etc/server-apps/datathon.frontend.env) == 600 ]]
[[ $(stat -c %a /etc/server-apps/datathon.backend.env) == 600 ]]
nested_env_hash=$(sha256sum /etc/server-apps/datathon.frontend.env)
nested_authorized_hash=$(sha256sum /root/.ssh/authorized_keys)
install_nested > /tmp/installer-nested-second.log
[[ "$nested_env_hash" == "$(sha256sum /etc/server-apps/datathon.frontend.env)" ]]
[[ "$nested_authorized_hash" == "$(sha256sum /root/.ssh/authorized_keys)" ]]
expect_command_rejection bash /source/install-server.sh /srv/apps/not-created root /tmp/nested-actions.pub /etc
[[ ! -e /srv/apps/not-created ]]
expect_command_rejection bash /source/install-server.sh /srv/apps/datathon root /tmp/nested-actions.pub
chmod 0770 /srv/apps
expect_command_rejection install_nested
chmod 0750 /srv/apps
chmod 0770 /etc/server-apps
expect_command_rejection install_nested
chmod 0750 /etc/server-apps
rm /srv/apps/datathon/control/frontend.env
ln -s /etc/server-apps/other-app.env /srv/apps/datathon/control/frontend.env
expect_command_rejection install_nested
[[ $(cat /etc/server-apps/other-app.env) == 'unrelated secret placeholder' ]]
rm /srv/apps/datathon/control/frontend.env
ln -s /etc/server-apps/datathon.frontend.env /srv/apps/datathon/control/frontend.env
chmod 0644 /etc/server-apps/datathon.backend.env
expect_command_rejection install_nested
[[ $(stat -c %a /etc/server-apps/datathon.backend.env) == 644 ]]
chmod 0600 /etc/server-apps/datathon.backend.env
install -d -m 0777 /srv/writable-ancestor
expect_rejection /srv/writable-ancestor/nested/datathon
[[ ! -e /srv/writable-ancestor/nested ]]
ln -s /srv/apps /srv/linked-ancestor
expect_rejection /srv/linked-ancestor/nested/datathon
[[ ! -e /srv/apps/nested ]]

install -d -m 0755 /srv/unrelated
printf 'keep\n' > /srv/unrelated/application-file
expect_rejection /srv/unrelated
[[ $(cat /srv/unrelated/application-file) == keep ]]

install -d -m 0755 /srv/unsafe-state /srv/symlink-target
ln -s /srv/symlink-target /srv/unsafe-state/state
expect_rejection /srv/unsafe-state
[[ ! -e /srv/symlink-target/runtime ]]
[[ $(stat -c %u /srv/symlink-target) == 0 ]]

ln -s /srv/symlink-target /srv/unsafe-root
expect_rejection /srv/unsafe-root
[[ ! -e /srv/symlink-target/control ]]

install -d -m 0777 /srv/unsafe-write
expect_rejection /srv/unsafe-write
[[ $(stat -c %a /srv/unsafe-write) == 777 ]]

install -d -o smokeadmin -g smokeadmin -m 0755 /srv/unsafe-owner
expect_rejection /srv/unsafe-owner
[[ $(stat -c %U /srv/unsafe-owner) == smokeadmin ]]

chmod 0644 /srv/datathon-smoke/control/backend.env
expect_rejection /srv/datathon-smoke
[[ $(stat -c %a /srv/datathon-smoke/control/backend.env) == 644 ]]
echo 'Installer checks passed: default/external env idempotency, nested ancestors, private generated env, exact forced key, old Compose, unsafe ownership, symlinks and unrelated folders.'
