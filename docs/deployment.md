# Production deployment

Target: **https://yoosufsayyid.com/apps/datathon**. The deployment uses two Docker containers, a same-origin frontend proxy and an existing HTTPS reverse proxy. Local `npm start` continues to work at `/` without environment setup.

## Deployment target and status

The confirmed SSH target is `yoosuf@169.58.6.224` on port `22`. Datathon has its own folder below the existing applications directory, and its secrets use the server's separate environment directory:

| Purpose | Server path |
| --- | --- |
| App installation | `/srv/apps/datathon` |
| Protected deployment controls | `/srv/apps/datathon/control` |
| Writable application state | `/srv/apps/datathon/state` |
| Frontend environment | `/etc/server-apps/datathon.frontend.env` |
| Backend environment | `/etc/server-apps/datathon.backend.env` |
| Datathon Nginx locations | `/etc/nginx/snippets/datathon.conf` |

The dedicated Actions private key is already stored as repository secret `DATATHON_SSH_PRIVATE_KEY`. The steps below document installation and recovery; do not treat a successful image build as proof of a live release. The final Actions job checks both the public page and its real backend health endpoint.

## Actions deployment configuration · 17 October 2026

The repository variable `DATATHON_DEPLOY_ENABLED` was confirmed as `true` on 17 October 2026. Code pushes to `main` therefore request an automated deployment after checks and image smoke tests pass; documentation-only pushes are ignored. The workflow has two jobs, **build** and **deploy**. This configuration does not establish which release is currently running; confirm that from the deployment result and actual container images.

Manual workflow runs default to building and testing only. Leave the `deploy` input unchecked when validating a branch. To deploy a manual run, select `main` and check `deploy`; the repository deployment variable must also remain `true`.

## Manual deployment fallback

The administrator-owned checkout is `/srv/apps/datathon/source`. Use the existing trusted administrator SSH connection, run `git pull --ff-only` there, verify a clean checkout and its commit, then build the Dockerfile's `frontend` and `backend` targets on the server. The frontend requires `--build-arg PUBLIC_BASE_PATH=/apps/datathon`. Label both images with `org.opencontainers.image.revision` and the verified commit. No registry credentials or database connection string are needed for these builds.

Before replacing the public containers, test the backend candidate in an isolated temporary container with no published ports, no network and no production state mounts. Keep the production memory/CPU limits and use temporary writable runtime storage. Check health, national datasets, capital and Hithadhoo baselines, heatmap geometry and a computation-only evaluation. Remove only that temporary container after recording its result.

Manual releases use the protected `/srv/apps/datathon/control/manual-release.env`, containing the two immutable local image IDs and `DATATHON_REVISION`. Preserve the previous manifest as `manual-rollback-<UTC timestamp>.env` and serialize releases with `control/deploy.lock`. Validate Compose configuration before replacing the manual manifest, then run the existing fixed Compose file with `up -d --wait --wait-timeout 240 --no-build --pull never`. If health fails, restore the previous manifest and repeat that command. The Actions gateway uses the separate `release.env`; use **`manual-release.env`** when inspecting or maintaining a manual release. Confirm the running containers' image IDs before choosing a manifest for recovery.

After switching, check the public HTTPS health endpoint, application correctness and bounded request timings. A successful image build alone does not complete deployment. This process changes only Datathon's two containers and preserves its persistent runtime volume, other state, reverse proxy and unrelated applications.

## Deployment boundary

- The frontend publishes only `127.0.0.1:18730`. FastAPI has no host port. Existing HTTPS infrastructure forwards only `/apps/datathon` to this listener and preserves the path prefix.
- Both containers run as UID/GID `10001`, with a read-only root filesystem, dropped capabilities, no privilege escalation, resource limits and bounded logs. No Docker socket or other application folders are mounted.
- Mutable files live only below `/srv/apps/datathon/state`. Root-owned deployment configuration lives in `/srv/apps/datathon/control`; the two root-only environment files live separately under `/etc/server-apps`. The control folder contains only the two exact environment-file symlinks required by the fixed Compose configuration. The environment directory and other apps' files are never mounted into containers.
- The dedicated SSH key has a forced command and cannot open a shell, SFTP, PTY or forwarding session. A fixed root-owned helper accepts only validated image digests for the two Datathon image repositories. It cannot receive a shell command, path, Compose file or environment override from Actions.
- The installer uses an **existing server account**. It does not reduce that account's permissions when accessed through its other keys or password. The restriction applies specifically to the dedicated deployment key. Do not give Actions your personal administrative SSH key.
- A one-time administrator must install the helper and add the HTTPS route. Actions never modifies Nginx, sudo rules, SSH configuration, unrelated applications or server users.

## Database and data policy

**Neither image startup nor the workflow runs migrations, schema creation, data acquisition, imports or seed scripts against PostgreSQL.** Production forces `MOBILITY_ENVIRONMENT=production`, an empty `MOBILITY_DATABASE_URL`, and `MOBILITY_COMPUTED_CACHE_POSTGRES_ENABLED=false`. The application also refuses its optional PostgreSQL cache outside development, even if a DSN is accidentally inherited.

The backend image includes the versioned normalized, graph, derived and public planning snapshots. Background preparation populates only the app's local memory/disk cache. Notices and review-check receipts use local app state, including SQLite; this does not connect to the shared PostgreSQL database. Production source import/accept endpoints return 403. Read-only source checks remain available.

If you need to update source data, validate and accept it locally, commit the intended snapshots, then push. Optional shared cache table setup is an explicit **local development** command: `uv run --directory backend python -m app.cli.database_setup`. It is not needed for production and is never called by Actions or Docker. Do not add database credentials to Actions, Docker build arguments, committed files or this guide.

## One-time server installation

The prepared server configuration assumes Linux with an x86-64 CPU, Python 3.10+, Docker Engine and Docker Compose 2.20+. Reserve approximately 4 GB available RAM and sufficient image/cache disk space. Inspect your existing server before installing or changing any shared service. If the server is ARM, change the build platforms before publishing.

Use the existing `yoosuf` administrator connection for these one-time steps. `/srv/apps/datathon` must be a dedicated empty protected directory, or an earlier installation made by this installer. The existing `/srv/apps` and `/etc/server-apps` directories are owned by `root:deploy` with mode `0750`; preserve those permissions and the other applications' contents. The installer refuses unsafe paths and unrelated existing app folders.

From this checkout, upload only the public key and deployment files. The destination `~/datathon-setup` below must not already contain another project:

```sh
scp -P 22 artifacts/private/datathon-actions.pub yoosuf@169.58.6.224:/tmp/datathon-actions.pub
scp -P 22 -r deploy yoosuf@169.58.6.224:~/datathon-setup
ssh -p 22 yoosuf@169.58.6.224
sudo bash ~/datathon-setup/install-server.sh /srv/apps/datathon yoosuf /tmp/datathon-actions.pub /etc/server-apps
```

The ignored local private key is `artifacts/private/datathon-actions`. Its contents belong only in the GitHub secret already configured. Never upload it to the server or commit it. The installer appends the **public** key with command restrictions while preserving other authorized keys. It creates a narrow sudo rule for the fixed helper when using a non-root account; the account is not added to the Docker group. An existing incompatible Datathon sudo rule is refused for manual review.

The fourth installer argument selects the existing separate environment directory. The installer generates a random internal `VELA_API_KEY`, writes the same value to `/etc/server-apps/datathon.frontend.env` and `/etc/server-apps/datathon.backend.env`, and sets root-only permissions. `control/frontend.env` and `control/backend.env` point only to those exact files; arbitrary symlinks are refused. An existing valid environment pair is preserved on a rerun. No database password, server login password or persistent registry token is required by the deployment workflow. The examples in `deploy/server/*.env.example` contain no secrets.

## HTTPS path

The active site configuration on this server is **`/etc/nginx/sites-enabled/yoosufsayyid.com`**, a regular root-owned file rather than a symlink. The copy in `sites-available` is mirrored for consistency but is not the active file; editing it alone does not change the running site. Review `deploy/nginx-location.conf`, install its two location blocks as the root-owned `/etc/nginx/snippets/datathon.conf`, and include that file inside the **existing HTTPS server block in the active configuration**. Preserve the site's existing `snippets/apps-extra.conf` include and all other routes. Back up the active file before editing, run `sudo nginx -t`, then reload Nginx only if validation succeeds. Do not replace the complete site configuration or assume that `sites-enabled` is a symlink.

The route must preserve `/apps/datathon` on upstream requests. In Nginx the provided `proxy_pass http://127.0.0.1:18730;` intentionally has no trailing slash. TLS and the existing domain certificate remain managed by your current reverse proxy. The route `/apps/datathon/api/backend/health` must return JSON with `"status":"ok"` after the first deployment.

## GitHub settings

Repository: https://github.com/lyashahid/datathon. Open **Settings → Secrets and variables → Actions**. Use repository secrets and repository variables consistently; the `production` environment is created/referenced by the workflow and does not require a second copy of these values.

No manual environment-creation step is required. The workflow itself limits deployment to `refs/heads/main`. A repository administrator may optionally add a separate main-only deployment branch rule under **Settings → Environments → production**. That optional protection has not been configured by this setup: the available credential can manage deployment secrets and variables but cannot administer environment rules. Leave required reviewers and wait timers disabled for automatic redeployment on each push.

| Type | Name | Value |
| --- | --- | --- |
| Secret | `DATATHON_SSH_PRIVATE_KEY` | Already configured with the dedicated private key. If rotating, paste the entire OpenSSH private key, including its begin/end lines. |
| Secret | `DATATHON_SSH_KNOWN_HOSTS` | Verified SSH host-key line(s) for the actual host and port. See below. |
| Variable | `DATATHON_SSH_HOST` | `169.58.6.224` |
| Variable | `DATATHON_SSH_USER` | `yoosuf` - the existing account; no new server user is needed. |
| Variable | `DATATHON_SSH_PORT` | `22` |
| Variable | `DATATHON_DEPLOY_ENABLED` | Confirmed `true` on 17 October 2026. Set `false` to pause automated deployments or while preparing a new installation. |

To obtain a candidate known-hosts line locally:

```sh
ssh-keyscan -p 22 169.58.6.224 > datathon-known-hosts.txt
ssh-keygen -lf datathon-known-hosts.txt
```

**Verify that fingerprint through the server console or your trusted existing administrator connection** before saving the file contents as `DATATHON_SSH_KNOWN_HOSTS`. `ssh-keyscan` alone does not authenticate the host. For a non-default port, preserve the `[HOST]:PORT` form generated by the command. The workflow requires strict host-key checking and will fail safely when the key changes.

The workflow uses GitHub's automatic, job-scoped `GITHUB_TOKEN` to publish and pull its GHCR images. You do not need to create or paste a personal access token. If Actions is restricted by repository/organization policy, allow the pinned GitHub, Docker and Astral actions used in `.github/workflows/deploy.yml`. Package publishing must be allowed. Existing packages with these names must grant this repository Actions access. Repository administrator access may be needed to change those policies.

## First deployment and subsequent pushes

1. Finish the server installation and HTTPS route.
2. Verify the SSH secrets/variables and `DATATHON_DEPLOY_ENABLED=true`.
3. Open **Actions → Test and deploy Datathon → Run workflow**, choose `main`, check `deploy`, and run it. Leave `full_checks` unchecked for the normal fast path. A code push to `main` triggers the normal path automatically.
4. Check **build** and **deploy**. Build runs the frontend type check, 9 startup tests, 2 source-receipt tests and 18 deployment-gateway tests. Docker Bake builds the frontend and backend in parallel using separate GitHub Actions caches, publishes immutable SHA-256 image digests, then smoke-tests those exact images through the production Compose configuration. Deploy pulls the verified digests and waits for container health. It does not upload a checkout or execute repository scripts on the server.
5. Open https://yoosufsayyid.com/apps/datathon. Check Analytics, Map & planning, proposal preview, impact review and PDF export. Live feeds require outbound network access and their providers' coverage.

The optional `full_checks` input adds frontend lint and regression tests, backend lint and non-browser regression tests, and the server installer test. It defaults to `false` and can be enabled on a manual build without enabling deployment. The normal path avoids installing the backend development test environment on the runner; the backend image still installs its locked runtime dependencies.

After setup, code pushes to `main` follow the same sequence automatically; documentation-only pushes do not run it. Deployments are serialized. The restricted helper pulls both images before changing the active release and rolls back to the previous image pair if container health fails. A failure in the later public HTTPS check is reported in Actions and requires inspecting the route; that check does not silently change proxy configuration.

## Inspection, rollback and maintenance

Use your normal administrator login, not the Actions key, to inspect an Actions release:

```sh
sudo docker compose --project-name datathon --project-directory /srv/apps/datathon/control --env-file /srv/apps/datathon/control/release.env -f /srv/apps/datathon/control/compose.yaml ps
sudo docker compose --project-name datathon --project-directory /srv/apps/datathon/control --env-file /srv/apps/datathon/control/release.env -f /srv/apps/datathon/control/compose.yaml logs --tail 100
curl --fail http://127.0.0.1:18730/apps/datathon/api/backend/health
```

For a manual fallback release, substitute `manual-release.env` in these commands and verify the running image IDs against that manifest. Logs may contain upstream data, so inspect them privately before sharing. Securely back up `/srv/apps/datathon/state`, the protected control files and only the two `/etc/server-apps/datathon.*.env` files. Preserve symlinks and ownership when restoring. Never run a global `docker system prune` as part of this deployment. To reverse a manual release, restore its timestamped rollback manifest to `manual-release.env`, run the same scoped Compose health-wait command and verify both actual image IDs and health. An Actions release can be reverted through a reviewed source revert pushed to `main` while automated deployments are enabled. The two manifests may describe different image pairs; do not interchange them during recovery.

Changes to the protected Compose file, resource limits, app folder or helper require a deliberate administrator installation; a push cannot alter these protections. Read/review installer changes before rerunning it. This is intentional: repository automation can update app images, not server administration policy.

If the first deployment fails, check the verified host key, restricted public key, existing account, image permissions, available RAM/disk, Compose version and port 18730. If the page appears but assets or API calls fail, check that the reverse proxy preserves the path prefix. Do not solve these failures by disabling SSH host checking, publishing FastAPI publicly or enabling production database setup.

## Local verification

```sh
npm run check
npm run lint
npm test
npm run test:startup
python -I -m unittest discover -s backend/tests -p test_source_use.py -v
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
