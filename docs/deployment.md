# Production deployment

Target: **https://yoosufsayyid.com/apps/datathon**. The deployment uses two Docker containers, a same-origin frontend proxy and an existing HTTPS reverse proxy. Local `npm start` continues to work at `/` without environment setup.

## Prepared versus live

The repository contains the Docker images, GitHub Actions workflow and restricted server installer. The dedicated Actions private key has already been added to the repository secret `DATATHON_SSH_PRIVATE_KEY`. `DATATHON_DEPLOY_ENABLED` is initially `false`, so a push can test and publish images without attempting an unconfigured deployment.

The server still needs its one-time installation, verified SSH host key and reverse-proxy route. Do not treat a successful image build as a successful server deployment. The final Actions job checks both the public page and its real backend health endpoint.

## Deployment boundary

- The frontend publishes only `127.0.0.1:18730`. FastAPI has no host port. Existing HTTPS infrastructure forwards only `/apps/datathon` to this listener and preserves the path prefix.
- Both containers run as UID/GID `10001`, with a read-only root filesystem, dropped capabilities, no privilege escalation, resource limits and bounded logs. No Docker socket or other application folders are mounted.
- Mutable files live only below `/srv/datathon/state` by default. Root-owned deployment configuration and generated environment secrets live in `/srv/datathon/control`.
- The dedicated SSH key has a forced command and cannot open a shell, SFTP, PTY or forwarding session. A fixed root-owned helper accepts only validated image digests for the two Datathon image repositories. It cannot receive a shell command, path, Compose file or environment override from Actions.
- The installer uses an **existing server account**. It does not reduce that account's permissions when accessed through its other keys or password. The restriction applies specifically to the dedicated deployment key. Do not give Actions your personal administrative SSH key.
- A one-time administrator must install the helper and add the HTTPS route. Actions never modifies Nginx, sudo rules, SSH configuration, unrelated applications or server users.

## Database and data policy

**Neither image startup nor the workflow runs migrations, schema creation, data acquisition, imports or seed scripts against PostgreSQL.** Production forces `MOBILITY_ENVIRONMENT=production`, an empty `MOBILITY_DATABASE_URL`, and `MOBILITY_COMPUTED_CACHE_POSTGRES_ENABLED=false`. The application also refuses its optional PostgreSQL cache outside development, even if a DSN is accidentally inherited.

The backend image includes the versioned normalized, graph, derived and public planning snapshots. Background preparation populates only the app's local memory/disk cache. Notices and review-check receipts use local app state, including SQLite; this does not connect to the shared PostgreSQL database. Production source import/accept endpoints return 403. Read-only source checks remain available.

If you need to update source data, validate and accept it locally, commit the intended snapshots, then push. Optional shared cache table setup is an explicit **local development** command: `uv run --directory backend python -m app.cli.database_setup`. It is not needed for production and is never called by Actions or Docker. Do not add database credentials to Actions, Docker build arguments, committed files or this guide.

## One-time server installation

The prepared server configuration assumes Linux with an x86-64 CPU, Python 3.10+, Docker Engine and Docker Compose 2.20+. Reserve approximately 4 GB available RAM and sufficient image/cache disk space. Inspect your existing server before installing or changing any shared service. If the server is ARM, change the build platforms before publishing.

Use your ordinary administrator connection for these one-time steps. Substitute the actual SSH host, port and **existing** account. `/srv/datathon` must be a dedicated empty protected directory, or an earlier installation made by this installer; `/opt/NAME` is also supported. The installer refuses symlinked or unsafe paths and unrelated existing folders.

From this checkout, upload only the public key and deployment files. The destination `~/datathon-setup` below must not already contain another project:

```sh
scp -P PORT artifacts/private/datathon-actions.pub EXISTING_USER@HOST:/tmp/datathon-actions.pub
scp -P PORT -r deploy EXISTING_USER@HOST:~/datathon-setup
ssh -p PORT EXISTING_USER@HOST
sudo bash ~/datathon-setup/install-server.sh /srv/datathon EXISTING_USER /tmp/datathon-actions.pub
```

The ignored local private key is `artifacts/private/datathon-actions`. Its contents belong only in the GitHub secret already configured. Never upload it to the server or commit it. The installer appends the **public** key with command restrictions while preserving other authorized keys. It creates a narrow sudo rule for the fixed helper when using a non-root account; the account is not added to the Docker group. An existing incompatible Datathon sudo rule is refused for manual review.

The installer generates a random internal `VELA_API_KEY`, writes the same value to `control/frontend.env` and `control/backend.env`, and sets root-only permissions. It preserves an existing pair on a rerun. No database password, server login password or persistent registry token is required by the deployment workflow. The examples in `deploy/server/*.env.example` contain no secrets.

## HTTPS path

Review `deploy/nginx-location.conf` and place those two location blocks inside the **existing HTTPS server block for yoosufsayyid.com**. Back up that existing site configuration first, run `sudo nginx -t`, then reload Nginx only if validation succeeds. Do not replace the site's complete configuration. If the server uses Caddy, Traefik or another proxy, adapt this route to that proxy rather than installing a second proxy.

The route must preserve `/apps/datathon` on upstream requests. In Nginx the provided `proxy_pass http://127.0.0.1:18730;` intentionally has no trailing slash. TLS and the existing domain certificate remain managed by your current reverse proxy. The route `/apps/datathon/api/backend/health` must return JSON with `"status":"ok"` after the first deployment.

## GitHub settings

Repository: https://github.com/lyashahid/datathon. Open **Settings → Secrets and variables → Actions**. Use repository secrets and repository variables consistently; the `production` environment is created/referenced by the workflow and does not require a second copy of these values.

| Type | Name | Value |
| --- | --- | --- |
| Secret | `DATATHON_SSH_PRIVATE_KEY` | Already configured with the dedicated private key. If rotating, paste the entire OpenSSH private key, including its begin/end lines. |
| Secret | `DATATHON_SSH_KNOWN_HOSTS` | Verified SSH host-key line(s) for the actual host and port. See below. |
| Variable | `DATATHON_SSH_HOST` | SSH hostname or IPv4 address, without `https://` or a path. |
| Variable | `DATATHON_SSH_USER` | The existing server account supplied to the installer. |
| Variable | `DATATHON_SSH_PORT` | Actual SSH port, normally `22`. |
| Variable | `DATATHON_DEPLOY_ENABLED` | Keep `false` until server installation and the HTTPS route are ready; then set `true`. |

To obtain a candidate known-hosts line locally:

```sh
ssh-keyscan -p PORT HOST > datathon-known-hosts.txt
ssh-keygen -lf datathon-known-hosts.txt
```

**Verify that fingerprint through the server console or your trusted existing administrator connection** before saving the file contents as `DATATHON_SSH_KNOWN_HOSTS`. `ssh-keyscan` alone does not authenticate the host. For a non-default port, preserve the `[HOST]:PORT` form generated by the command. The workflow requires strict host-key checking and will fail safely when the key changes.

The workflow uses GitHub's automatic, job-scoped `GITHUB_TOKEN` to publish and pull its GHCR images. You do not need to create or paste a personal access token. If Actions is restricted by repository/organization policy, allow the pinned GitHub, Docker and Astral actions used in `.github/workflows/deploy.yml`. Package publishing must be allowed. Existing packages with these names must grant this repository Actions access. Repository administrator access may be needed to change those policies.

## First deployment and subsequent pushes

1. Finish the server installation and HTTPS route.
2. Set the remaining SSH secret/variables, then set `DATATHON_DEPLOY_ENABLED=true`.
3. Open **Actions → Test and deploy Datathon → Run workflow**, choose `main`, and run it. A new push to `main` also triggers it.
4. Check **verify**, **build** and **deploy**. Tests must pass before images are published. Deploy pulls immutable SHA-256 image digests and waits for container health. It does not upload a checkout or execute repository scripts on the server.
5. Open https://yoosufsayyid.com/apps/datathon. Check Analytics, Map & planning, proposal preview, impact review and PDF export. Live feeds require outbound network access and their providers' coverage.

After setup, every push to `main` follows the same sequence automatically. Deployments are serialized. The restricted helper pulls both images before changing the active release and rolls back to the previous image pair if container health fails. A failure in the later public HTTPS check is reported in Actions and requires inspecting the route; that check does not silently change proxy configuration.

## Inspection, rollback and maintenance

Use your normal administrator login, not the Actions key, to inspect the app:

```sh
sudo docker compose --project-name datathon --project-directory /srv/datathon/control --env-file /srv/datathon/control/release.env -f /srv/datathon/control/compose.yaml ps
sudo docker compose --project-name datathon --project-directory /srv/datathon/control --env-file /srv/datathon/control/release.env -f /srv/datathon/control/compose.yaml logs --tail 100
curl --fail http://127.0.0.1:18730/apps/datathon/api/backend/health
```

Logs may contain upstream data, so inspect them privately before sharing. Back up `state/` and the root-only `control/*.env` securely. Never run a global `docker system prune` as part of this deployment. If you need to reverse an already healthy release, revert the relevant Git commit and push to `main`; the usual workflow rebuilds and deploys that reviewed state. Re-running an older successful workflow is another option while its images remain available.

Changes to the protected Compose file, resource limits, app folder or helper require a deliberate administrator installation; a push cannot alter these protections. Read/review installer changes before rerunning it. This is intentional: repository automation can update app images, not server administration policy.

If the first deployment fails, check the verified host key, restricted public key, existing account, image permissions, available RAM/disk, Compose version and port 18730. If the page appears but assets or API calls fail, check that the reverse proxy preserves the path prefix. Do not solve these failures by disabling SSH host checking, publishing FastAPI publicly or enabling production database setup.

## Local verification

```sh
npm run check
npm run lint
npm test
npm run test:startup
uv run --directory backend pytest -m 'not browser'
python -I -m unittest discover -s deploy/server -p test_deploy.py -v
docker build --target frontend -t datathon/frontend:local .
docker build --target backend -t datathon/backend:local .
```

Against a running prefixed build, set `MOBILITY_QA_URL=http://127.0.0.1:18730/apps/datathon` and run `node scripts/verify-subpath.mjs`. It checks the real backend proxy, redirects, navigation, asset loading and absence of requests escaping the app mount.

## References

- [GitHub: repository and environment secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [GitHub: publishing Docker images with Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [Docker Engine security](https://docs.docker.com/engine/security/)
- [OpenSSH authorized-key restrictions](https://man.openbsd.org/sshd.8)
