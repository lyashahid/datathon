#!/usr/bin/env bash
# One-time administrative installation. Never invoked by GitHub Actions.
set -euo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'Run this one-time installer with sudo.' >&2; exit 1; }
[[ $# -eq 3 ]] || { echo 'Usage: sudo bash deploy/install-server.sh /srv/datathon EXISTING_USER /path/to/actions-key.pub' >&2; exit 1; }
app_root=$1
account=$2
public_key_file=$3
[[ "$app_root" =~ ^/(srv|opt)/[a-zA-Z0-9_-]+$ ]] || { echo 'Use a dedicated protected /srv/NAME or /opt/NAME folder.' >&2; exit 1; }
[[ "$account" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || exit 1
[[ -f "$public_key_file" && ! -L "$public_key_file" ]] || exit 1
getent passwd "$account" > /dev/null || { echo 'The named server account must already exist.' >&2; exit 1; }
[[ -x /usr/bin/python3 && -x /usr/bin/docker ]] || { echo 'Install Python3 and Docker Engine first.' >&2; exit 1; }
compose_version=$(/usr/bin/docker compose version --short)
if [[ ! "$compose_version" =~ ^v?([0-9]+)\.([0-9]+)(\.[0-9]+)?([+-].*)?$ ]] ||
   ! (( 10#${BASH_REMATCH[1]:-0} > 2 || (10#${BASH_REMATCH[1]:-0} == 2 && 10#${BASH_REMATCH[2]:-0} >= 20) )); then
  echo 'Docker Compose 2.20 or later is required for health-checked deployments with a timeout.' >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
key=$(cat -- "$public_key_file")
[[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [a-zA-Z0-9@._-]+)?$ ]] || { echo 'Supply one plain Ed25519 public key, not a private key or authorized_keys options.' >&2; exit 1; }
key_data=$(printf '%s' "$key" | awk '{print $2}')

# Never adopt an unrelated application, follow a symlink, or repair unsafe ownership
# by silently chowning a directory that another application might already use.
protected_directory() {
  local directory=$1
  [[ ! -L "$directory" ]] || { echo 'Symlinked deployment paths are forbidden.' >&2; exit 1; }
  if [[ -e "$directory" ]]; then
    [[ -d "$directory" && $(stat -c %u "$directory") == 0 ]] || { echo 'Deployment parents must be root-owned directories.' >&2; exit 1; }
    (( (8#$(stat -c %a "$directory") & 0022) == 0 )) || { echo 'Deployment parents must not be group/world writable.' >&2; exit 1; }
  fi
}
for directory in / "$(dirname -- "$app_root")" "$app_root" "$app_root/control" "$app_root/state"; do
  protected_directory "$directory"
done
if [[ -d "$app_root" && -n "$(ls -A -- "$app_root")" ]]; then
  [[ -f "$app_root/control/INSTALLATION" && ! -L "$app_root/control/INSTALLATION" ]] || { echo 'The target is not an installed Datathon folder. Choose a dedicated empty folder.' >&2; exit 1; }
  [[ $(cat -- "$app_root/control/INSTALLATION") == datathon-install-v1 ]] || exit 1
  for file in "$app_root/control/"*; do
    [[ -f "$file" && ! -L "$file" && $(stat -c %u "$file") == 0 ]] || { echo 'Unsafe existing deployment control file.' >&2; exit 1; }
    (( (8#$(stat -c %a "$file") & 0022) == 0 )) || exit 1
  done
fi
install -d -o root -g root -m 0755 "$app_root" "$app_root/control" "$app_root/state"
printf 'datathon-install-v1\n' > "$app_root/control/INSTALLATION"
chmod 0644 "$app_root/control/INSTALLATION"
for state in runtime live-cache live-raw forecast-issues; do
  [[ ! -L "$app_root/state/$state" ]] || exit 1
  install -d -o 10001 -g 10001 -m 0700 "$app_root/state/$state"
done
install -o root -g root -m 0755 "$script_dir/server/deploy.py" "$app_root/control/deploy.py"
install -o root -g root -m 0644 "$script_dir/server/compose.yaml" "$app_root/control/compose.yaml"

# The internal API key is generated here; neither GitHub nor image builds need it.
APP_CONTROL="$app_root/control" /usr/bin/python3 -I - <<'PY'
import os, pathlib, secrets, stat
control = pathlib.Path(os.environ['APP_CONTROL'])
front, back = control / 'frontend.env', control / 'backend.env'
if front.exists() != back.exists():
    raise SystemExit('Both environment files must exist together; restore the missing one before retrying.')
if not front.exists():
    key = secrets.token_hex(32)
    files = {
        front: f'VELA_API_KEY={key}\n',
        back: (
            'MOBILITY_ENVIRONMENT=production\n'
            'MOBILITY_COMPUTED_CACHE_POSTGRES_ENABLED=false\n'
            'MOBILITY_COMPUTED_CACHE_PREWARM=true\n'
            f'VELA_API_KEY={key}\n'
            'VELA_BROWSER_ENABLED=true\n'
            'MOBILITY_LIVE_AIRCRAFT_ENABLED=true\n'
            'MOBILITY_LIVE_VESSEL_ENABLED=true\n'
            'MOBILITY_LIVE_FOLLOWME_ENABLED=true\n'
            'MOBILITY_LIVE_BUS_ENABLED=false\n'
        ),
    }
    for file, content in files.items():
        with file.open('x') as stream:
            stream.write(content)
        file.chmod(0o600)
for file in (front, back):
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise SystemExit('Environment files must be root-owned regular files with mode0600.')
PY

# Validate the installed protected tree before granting the dedicated key access.
APP_CONTROL="$app_root/control" /usr/bin/python3 -I - <<'PY'
import os, pathlib, runpy
control = pathlib.Path(os.environ['APP_CONTROL'])
gateway = runpy.run_path(str(control / 'deploy.py'))
gateway['secure_layout'](control)
PY

if [[ "$account" == root ]]; then
  forced="/usr/bin/python3 -I $app_root/control/deploy.py"
else
  [[ -x /usr/bin/sudo ]] || { echo 'sudo is required for an existing non-root account.' >&2; exit 1; }
  forced="/usr/bin/sudo -n /usr/bin/python3 -I $app_root/control/deploy.py"
  sudo_file=$(mktemp)
  trap 'rm -f -- "$sudo_file"' EXIT
  printf '%s ALL=(root) NOPASSWD: /usr/bin/python3 -I %s/control/deploy.py\n' "$account" "$app_root" > "$sudo_file"
  /usr/sbin/visudo -cf "$sudo_file" > /dev/null
  [[ ! -L /etc/sudoers.d/datathon-deploy ]] || { echo 'The Datathon sudo rule must not be a symlink.' >&2; exit 1; }
  if [[ -e /etc/sudoers.d/datathon-deploy ]] && ! cmp -s "$sudo_file" /etc/sudoers.d/datathon-deploy; then
    echo 'An existing Datathon sudo rule differs. Review it manually before replacing it.' >&2
    exit 1
  fi
  install -o root -g root -m 0440 "$sudo_file" /etc/sudoers.d/datathon-deploy
fi

account_home=$(getent passwd "$account" | cut -d: -f6)
account_group=$(id -gn "$account")
[[ -d "$account_home" && ! -L "$account_home/.ssh" && ! -L "$account_home/.ssh/authorized_keys" ]] || exit 1
if [[ ! -d "$account_home/.ssh" ]]; then
  install -d -o "$account" -g "$account_group" -m 0700 "$account_home/.ssh"
fi
authorized="$account_home/.ssh/authorized_keys"
[[ ! -e "$authorized" || -f "$authorized" ]] || { echo 'The existing authorized_keys must be a regular file.' >&2; exit 1; }
line="restrict,command=\"$forced\" $key"
if [[ -f "$authorized" ]] && grep -Fq -- "$key_data" "$authorized"; then
  grep -Fxq -- "$line" "$authorized" || { echo 'This key already exists with different restrictions. Review it manually.' >&2; exit 1; }
else
  if [[ -f "$authorized" ]]; then
    install -o root -g root -m 0600 "$authorized" "$app_root/control/authorized_keys.before-install"
  fi
  printf '\n%s\n' "$line" >> "$authorized"
  chown "$account:$account_group" "$authorized"
  chmod 0600 "$authorized"
fi
echo "Installed Datathon-only deployment control at $app_root/control. No user was created."
echo 'No app was started, no database was contacted, and no reverse-proxy configuration was changed.'
echo 'Add the reviewed reverse-proxy location, then enable DATATHON_DEPLOY_ENABLED in GitHub.'
