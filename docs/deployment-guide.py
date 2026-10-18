#!/usr/bin/env python3
"""Render the public, credential-free Datathon production setup guide.

Requires reportlab, pypdf and Pillow. Screenshots are official GitHub Docs
reference images; the live repository contains no credentials in this guide.
Run from the repository root: python docs/deployment-guide.py
"""

from __future__ import annotations

from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/pdf/datathon-deployment-guide.pdf"
IMAGES = ROOT / "docs/images"
PAGE_W, PAGE_H = 595.276, 841.89
MARGIN = 44
BODY_W = PAGE_W - MARGIN * 2
TEAL = colors.HexColor("#0F766E")
DARK = colors.HexColor("#142D32")
INK = colors.HexColor("#23343A")
MUTED = colors.HexColor("#52676E")
LINE = colors.HexColor("#DCE5E6")
PALE = colors.HexColor("#EEF6F4")
PAPER = colors.HexColor("#F7FAFA")
LINK = "#086E76"


def register_fonts() -> None:
    windows = Path("C:/Windows/Fonts")
    linux = Path("/usr/share/fonts/truetype/dejavu")
    families = {
        "Guide": [windows / "arial.ttf", linux / "DejaVuSans.ttf"],
        "Guide-Bold": [windows / "arialbd.ttf", linux / "DejaVuSans-Bold.ttf"],
        "Guide-Italic": [windows / "ariali.ttf", linux / "DejaVuSans-Oblique.ttf"],
        "Guide-Mono": [windows / "consola.ttf", linux / "DejaVuSansMono.ttf"],
    }
    for name, candidates in families.items():
        path = next(
            (candidate for candidate in candidates if candidate.is_file()), None
        )
        if path is None:
            raise RuntimeError(f"Install Arial/Consolas or DejaVu fonts for {name}.")
        pdfmetrics.registerFont(TTFont(name, str(path)))
    pdfmetrics.registerFontFamily(
        "Guide", normal="Guide", bold="Guide-Bold", italic="Guide-Italic"
    )


register_fonts()
STYLE = getSampleStyleSheet()
STYLE.add(
    ParagraphStyle(
        "Body",
        fontName="Guide",
        fontSize=9.4,
        leading=14.2,
        textColor=INK,
        spaceAfter=8,
    )
)
STYLE.add(
    ParagraphStyle(
        "SmallBody", parent=STYLE["Body"], fontSize=8.5, leading=12, spaceAfter=6
    )
)
STYLE.add(
    ParagraphStyle(
        "CaptionGuide",
        parent=STYLE["Body"],
        fontSize=7.2,
        leading=10,
        textColor=MUTED,
        spaceAfter=9,
    )
)
STYLE.add(
    ParagraphStyle(
        "SectionGuide",
        fontName="Guide-Bold",
        fontSize=25,
        leading=30,
        textColor=DARK,
        spaceAfter=9,
    )
)
STYLE.add(
    ParagraphStyle(
        "SubGuide",
        fontName="Guide-Bold",
        fontSize=11,
        leading=15,
        textColor=DARK,
        spaceBefore=9,
        spaceAfter=7,
    )
)
STYLE.add(
    ParagraphStyle(
        "EyebrowGuide",
        fontName="Guide-Bold",
        fontSize=8,
        leading=11,
        textColor=TEAL,
        spaceAfter=8,
    )
)
STYLE.add(
    ParagraphStyle(
        "CellGuide", parent=STYLE["Body"], fontSize=8.5, leading=12, spaceAfter=0
    )
)
STYLE.add(
    ParagraphStyle(
        "MonoGuide",
        parent=STYLE["Body"],
        fontName="Guide-Mono",
        fontSize=7.6,
        leading=11.3,
        spaceAfter=0,
    )
)
STYLE.add(
    ParagraphStyle(
        "CoverTitle",
        parent=STYLE["SectionGuide"],
        fontSize=36,
        leading=41,
        spaceAfter=17,
    )
)
STYLE.add(
    ParagraphStyle(
        "CoverLead",
        parent=STYLE["Body"],
        fontSize=13,
        leading=19,
        textColor=MUTED,
        spaceAfter=20,
    )
)


def p(text: str, style: str = "Body") -> Paragraph:
    return Paragraph(text, STYLE[style])


def a(label: str, url: str) -> str:
    return f'<a href="{escape(url, quote=True)}" color="{LINK}">{escape(label)}</a>'


def mono(text: str) -> str:
    return '<font name="Guide-Mono">' + escape(text) + "</font>"


def code(text: str) -> Table:
    lines = "<br/>".join(
        escape(line).replace(" ", "&nbsp;") for line in text.splitlines()
    )
    result = Table([[p(lines, "MonoGuide")]], colWidths=[BODY_W])
    result.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PAPER),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    result.spaceAfter = 10
    return result


def note(title: str, text: str) -> Table:
    result = Table([[p(title, "SubGuide")], [p(text, "SmallBody")]], colWidths=[BODY_W])
    result.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("LINEBEFORE", (0, 0), (0, -1), 3, TEAL),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, 0), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    result.spaceAfter = 10
    return result


def table(headers: list[str], rows: list[list[str]], widths: list[float]) -> Table:
    data = [[p(escape(header), "CellGuide") for header in headers]]
    data += [[p(cell, "CellGuide") for cell in row] for row in rows]
    result = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, 0), 0.7, LINE),
                ("LINEBELOW", (0, 1), (-1, -1), 0.45, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    result.spaceAfter = 11
    return result


def step(number: str, title: str, detail: str) -> list:
    return [p(f"{number}. {title}", "SubGuide"), p(detail)]


def heading(number: str, title: str, lead: str) -> list:
    return [p(f"SETUP / {number}", "EyebrowGuide"), p(title, "SectionGuide"), p(lead)]


def screenshot(filename: str, max_height: float) -> Image:
    path = IMAGES / filename
    width, height = ImageReader(str(path)).getSize()
    scale = min(BODY_W / width, max_height / height)
    result = Image(str(path), width * scale, height * scale)
    result.hAlign = "LEFT"
    result.spaceBefore = 5
    result.spaceAfter = 5
    return result


class Architecture(Flowable):
    def __init__(self):
        super().__init__()
        self.width, self.height = BODY_W, 115

    def draw(self):
        canvas = self.canv
        items = [
            (0, 5, 151, "GitHub main", "Test + build images"),
            (177, 5, 151, "Restricted deploy key", "Fixed Datathon operation"),
            (354, 5, 153, "Your existing server", "/srv/apps/datathon"),
        ]
        for x, y, width, title, subtitle in items:
            canvas.setFillColor(PALE)
            canvas.setStrokeColor(LINE)
            canvas.roundRect(x, y, width, 72, 9, fill=1, stroke=1)
            canvas.setFillColor(DARK)
            canvas.setFont("Guide-Bold", 9)
            canvas.drawCentredString(x + width / 2, y + 43, title)
            canvas.setFillColor(MUTED)
            canvas.setFont("Guide", 7.7)
            canvas.drawCentredString(x + width / 2, y + 25, subtitle)
        for x in [155, 332]:
            canvas.setStrokeColor(TEAL)
            canvas.setLineWidth(1.3)
            canvas.line(x, 41, x + 18, 41)
            canvas.line(x + 13, 45, x + 18, 41)
            canvas.line(x + 13, 37, x + 18, 41)


def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(TEAL)
    canvas.rect(0, PAGE_H - 6, PAGE_W, 6, fill=1, stroke=0)
    canvas.setFont("Guide-Bold", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, PAGE_H - 30, "DATATHON / PRODUCTION PLAYBOOK")
    canvas.setFont("Guide", 8)
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 30, "18 OCT 2026")
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN, 39, PAGE_W - MARGIN, 39)
    canvas.setFont("Guide", 7.5)
    canvas.drawString(MARGIN, 24, "yoosufsayyid.com/apps/datathon")
    canvas.drawRightString(PAGE_W - MARGIN, 24, f"{doc.page} / 8")
    canvas.restoreState()


def build() -> None:
    story = []
    story += [Spacer(1, 15), p("ONE-TIME SETUP. AUTOMATIC RELEASES.", "EyebrowGuide")]
    story += [p("Deploy Datathon<br/>with confidence.", "CoverTitle")]
    story += [
        p(
            "A practical setup guide for your existing server and GitHub repository.",
            "CoverLead",
        )
    ]
    story += [
        p(
            a("Open the production address", "https://yoosufsayyid.com/apps/datathon")
            + "<br/>"
            + a(
                "Repository: lyashahid/datathon",
                "https://github.com/lyashahid/datathon",
            )
        )
    ]
    story += [Architecture(), Spacer(1, 10)]
    story += [
        table(
            ["You complete once", "Code pushes to main do"],
            [
                [
                    "Install app controls and separate environment files. Configure the verified server connection in GitHub. Enable deployment after setup.",
                    "Run quick checks. Build both cached images in parallel. Smoke-test and deploy their exact digests. Verify container health and the public app.",
                ],
            ],
            [BODY_W * 0.5, BODY_W * 0.5],
        )
    ]
    story += [
        p(
            "Confirmed target: yoosuf@169.58.6.224, SSH port 22. App folder: /srv/apps/datathon. Environment files: /etc/server-apps/datathon.*.env. The Actions key is saved in GitHub; DATATHON_DEPLOY_ENABLED was confirmed true on 17 October 2026. Verify running images separately.",
            "SmallBody",
        )
    ]
    story += [
        note(
            "Your shared database stays outside deployment",
            "Production uses reviewed snapshot files and in-memory analytics caches. The deployment workflow does not receive the shared PostgreSQL connection string, run migrations, seed data or alter database schemas. A small app-local SQLite store may hold notices in the Datathon state folder.",
        )
    ]
    story += [
        p("Before you start", "SubGuide"),
        p(
            "Use the existing yoosuf server account and GitHub repository administration access. Verify the server host fingerprint for the one-time setup. Keep the existing apps and separate environment folders intact. No new server user or password is needed."
        ),
    ]
    story += [
        p(
            "This is a setup playbook, not a certificate that deployment has already completed. The live release is confirmed by the checks on page 6.",
            "CaptionGuide",
        )
    ]
    story += [PageBreak()]

    story += heading(
        "01",
        "Use the prepared deploy key",
        "Use your existing server account. GitHub receives a separate key whose installed server entry can perform only the fixed Datathon deployment operation.",
    )
    story += step(
        "1",
        "Locate the files already generated for you",
        "The dedicated private key is already stored as the repository secret DATATHON_SSH_PRIVATE_KEY. It does not need to be generated or pasted again. The local files are in the ignored artifacts/private folder:",
    )
    story += [
        code(
            "D:/Projects/Personal/datathon/artifacts/private/\n  datathon-actions       # private key: keep private\n  datathon-actions.pub   # public key: install on server"
        )
    ]
    story += [
        table(
            ["File", "Where it goes"],
            [
                [
                    mono("datathon-actions"),
                    "Private key. Already saved in <b>DATATHON_SSH_PRIVATE_KEY</b>. Keep the local file out of Git, chat, screenshots and this PDF.",
                ],
                [
                    mono("datathon-actions.pub"),
                    "Public key. Copy only this file to the server for the installer. A .pub file is not the private key.",
                ],
            ],
            [BODY_W * 0.43, BODY_W * 0.57],
        )
    ]
    story += step(
        "2",
        "Verify and save the server host key",
        "Confirm the SSH host-key fingerprint against your provider's console or an already trusted administrator session. Then collect the verified host entry for the known-hosts secret. A key scan alone does not authenticate a new server.",
    )
    story += [
        code(
            "ssh-keyscan -p 22 169.58.6.224 |\n  Set-Content -Encoding ascii artifacts/private/known_hosts\nssh-keygen -lf artifacts/private/known_hosts"
        )
    ]
    story += [
        p(
            "Keep the bracketed [host]:port form when using a non-default port. On first normal SSH login, compare the displayed fingerprint with your trusted reference before accepting it.",
            "CaptionGuide",
        )
    ]
    story += step(
        "3",
        "Copy the setup files with your normal server login",
        "Run these commands from the local repository folder using the existing yoosuf login. The temporary destination ~/datathon-setup must not contain another project. Upload only the public key and the deployment scripts.",
    )
    story += [
        code(
            "scp -P 22 artifacts/private/datathon-actions.pub `\n  yoosuf@169.58.6.224:/tmp/datathon-actions.pub\nscp -P 22 -r deploy `\n  yoosuf@169.58.6.224:datathon-setup"
        )
    ]
    story += [PageBreak()]

    story += heading(
        "02",
        "Install once on the server",
        "These steps use your normal administrator login, not the restricted automation key. They are never run by GitHub Actions.",
    )
    story += step(
        "4",
        "Check the prerequisites",
        "Use a Linux x86-64 server with Docker Engine, Docker Compose 2.20+, Python 3.10+ and your existing HTTPS reverse proxy. Docker runs locally; no Docker socket or Docker-group membership is given to the deployment key. The configured container limits are up to 3.5 GB RAM and 3 CPU cores combined; leave extra capacity for your other apps.",
    )
    story += [code("docker --version\ndocker compose version\npython3 --version")]
    story += step(
        "5",
        "Install the protected application gateway",
        "Connect with ssh yoosuf@169.58.6.224. The app gets its own /srv/apps/datathon folder. The fourth argument places only its two environment files in the existing /etc/server-apps folder. Unrelated app files are preserved.",
    )
    story += [
        code(
            'sudo bash "$HOME/datathon-setup/install-server.sh" \\\n  /srv/apps/datathon yoosuf /tmp/datathon-actions.pub \\\n  /etc/server-apps'
        )
    ]
    story += [
        p(
            "No user is created. Controls live in /srv/apps/datathon/control and app state in /srv/apps/datathon/state. The dedicated public key gets a forced command and a narrow sudo rule. Existing /srv/apps and /etc/server-apps ownership and other apps stay intact.",
            "SmallBody",
        )
    ]
    story += step(
        "6",
        "Add the Datathon location to your existing HTTPS site",
        "Back up the active /etc/nginx/sites-enabled/yoosufsayyid.com: it is a regular file on this server, not a symlink. Include the root-owned /etc/nginx/snippets/datathon.conf in its HTTPS block. Keep all other routes and apps-extra.conf. The sites-available copy is mirrored but inactive; editing it alone has no effect.",
    )
    story += [code("sudo nginx -t && sudo systemctl reload nginx")]
    story += [
        note(
            "Runtime environment files are already generated",
            "The installer creates /etc/server-apps/datathon.frontend.env and datathon.backend.env with root-only access. Exact symlinks in control/ let Compose use them. A random internal VELA_API_KEY is generated automatically. Production disables PostgreSQL and prewarms local caches. Do not copy a local .env into production.",
        )
    ]
    story += [
        p(
            "The restricted key cannot open a shell, transfer files, forward connections or change other app/proxy configuration. Your existing account's other login methods retain their current permissions; the restriction applies to this dedicated key.",
            "CaptionGuide",
        )
    ]
    story += [PageBreak()]

    story += heading(
        "03",
        "Add the two GitHub secrets",
        "Open the lyashahid/datathon repository in GitHub. The images below are official reference images; they show an example repository rather than your credentials.",
    )
    story += [screenshot("github-settings.png", 60)]
    story += [
        p(
            "Figure 1. Repository Settings tab. Source: "
            + a(
                "GitHub Docs reference image",
                "https://docs.github.com/assets/cb-28260/images/help/repository/repo-actions-settings.png",
            ),
            "CaptionGuide",
        )
    ]
    story += [
        p(
            "7. Click <b>Settings</b>. In the Security sidebar, open <b>Secrets and variables &gt; Actions</b>. Choose <b>Secrets</b>, then <b>New repository secret</b>."
        )
    ]
    story += [screenshot("github-secrets.png", 135)]
    story += [
        p(
            "Figure 2. Secrets and Variables tabs. Source: "
            + a(
                "GitHub Docs reference image",
                "https://docs.github.com/assets/cb-57155/images/help/repository/actions-secrets-tab.png",
            ),
            "CaptionGuide",
        )
    ]
    story += [
        table(
            ["Secret name - type exactly", "Secret value"],
            [
                [
                    mono("DATATHON_SSH_PRIVATE_KEY"),
                    "<b>Already configured.</b> If replacing it, paste the entire local datathon-actions private-key file, including its BEGIN/END OPENSSH PRIVATE KEY lines and line breaks.",
                ],
                [
                    mono("DATATHON_SSH_KNOWN_HOSTS"),
                    "Paste verified contents of artifacts/private/known_hosts from page 2 if not already configured. This pins the server identity; do not paste an IP address alone.",
                ],
            ],
            [BODY_W * 0.48, BODY_W * 0.52],
        )
    ]
    story += [
        p(
            "8. Add or update the known-hosts secret: enter its Name, paste the verified Secret value and click <b>Add secret</b> or <b>Update secret</b>. Leave the existing private-key secret unchanged. GitHub does not show saved secret values again."
        )
    ]
    story += [
        note(
            "No server password or registry password is required",
            "Use your normal server credentials only for the one-time administrator steps. The workflow automatically receives GitHub's short-lived GITHUB_TOKEN to publish/pull its container packages. Do not add a personal access token, SSH password, PostgreSQL password or the internal VELA_API_KEY to repository secrets.",
        )
    ]
    story += [PageBreak()]

    story += heading(
        "04",
        "Add variables and enable",
        "In the same Actions secrets and variables screen, select the Variables tab. Click New repository variable for each row below.",
    )
    story += [
        table(
            ["Variable name - type exactly", "Value to enter"],
            [
                [
                    mono("DATATHON_SSH_HOST"),
                    "<b>169.58.6.224</b><br/>Server IP only, without https://, a path or a :port suffix.",
                ],
                [
                    mono("DATATHON_SSH_USER"),
                    "<b>yoosuf</b><br/>The existing server account used by the installer. No new account is created.",
                ],
                [
                    mono("DATATHON_SSH_PORT"),
                    "<b>22</b><br/>The confirmed SSH port for this server.",
                ],
                [
                    mono("DATATHON_DEPLOY_ENABLED"),
                    "Confirmed <b>true</b> on 17 October 2026. Use <b>false</b> while preparing a new installation or intentionally pausing releases.",
                ],
            ],
            [BODY_W * 0.48, BODY_W * 0.52],
        )
    ]
    story += step(
        "9",
        "Let the workflow create its environment",
        "The workflow automatically creates or references <b>production</b> and already limits deployment to <b>refs/heads/main</b>. No manual environment setup is required. A repository administrator may optionally add a main-only branch rule in Settings &gt; Environments &gt; production.",
    )
    story += [
        p(
            "The optional environment rule is not configured by this setup: the available credential can manage secrets and variables, but cannot administer environment rules. For automatic releases, leave required reviewers and wait timers disabled. No extra user action is needed for the normal workflow.",
            "SmallBody",
        )
    ]
    story += step(
        "10",
        "Check Actions and package access",
        "If GitHub has disabled repository Actions, enable them in Settings &gt; Actions &gt; General. Ensure organization policy permits the pinned actions used by this workflow. The workflow requests contents:read, packages:write for building, and packages:read for deployment.",
    )
    story += [
        note(
            "If a GHCR permission error occurs",
            "Open the affected Datathon frontend/backend container package in GitHub. In Package settings &gt; Manage Actions access, grant this repository access. Packages built here carry the repository source label; no long-lived server registry login is saved.",
        )
    ]
    story += [
        p(
            "Before enabling a new installation, check both secrets, the connection variables and successful installer completion. The app URL is fixed to yoosufsayyid.com/apps/datathon. An enabled variable alone does not prove a successful release.",
            "CaptionGuide",
        )
    ]
    story += [PageBreak()]

    story += heading(
        "05",
        "Run the first deployment",
        "Code pushes to main run build then deploy when DATATHON_DEPLOY_ENABLED is true. Documentation-only pushes are ignored. No SSH commands are needed for routine releases.",
    )
    story += step(
        "11",
        "Start the workflow",
        "Open <b>Actions &gt; Test and deploy Datathon &gt; Run workflow</b>. Manual runs default to build-only on any selected branch. To release, select <b>main</b> and check <b>deploy</b>. Leave <b>full_checks</b> off for quick checks; enable it for full lint/regression and installer checks.",
    )
    story += [
        table(
            ["Stage", "What success means"],
            [
                [
                    "build",
                    "Frontend type check, 9 startup, 2 source-receipt and 18 gateway tests pass. Cached Docker Bake builds both Linux x86-64 images in parallel, publishes exact GHCR digests and smoke-tests them using production Compose. Full frontend/backend regression and installer tests are optional via full_checks (default false).",
                ],
                [
                    "deploy",
                    "The restricted server gateway pulls those images, starts only Datathon and waits for healthy containers. The public page must respond and /apps/datathon/api/backend/health must return status ok. Manual runs require deploy checked, main selected and the repository deployment variable true.",
                ],
            ],
            [BODY_W * 0.22, BODY_W * 0.78],
        )
    ]
    story += step(
        "12",
        "Confirm the real user journey",
        "Open the production link below in a fresh browser. Confirm Analytics opens; then enter Map &amp; planning, inspect Malé/Hulhumalé, add a draft intervention, compare its impact and export a proposal PDF. Check browser navigation and a direct link under the /apps/datathon prefix.",
    )
    story += [
        p(
            a(
                "https://yoosufsayyid.com/apps/datathon",
                "https://yoosufsayyid.com/apps/datathon",
            )
        )
    ]
    story += [
        code(
            "curl --fail --location \\\n  https://yoosufsayyid.com/apps/datathon\ncurl --fail \\\n  https://yoosufsayyid.com/apps/datathon/api/backend/health"
        )
    ]
    story += [
        note(
            "Warmup starts automatically",
            "The backend prepares expensive read-only capital-area analytics after startup. The health endpoint can become ready before every background view is warm; the first visit can still briefly show preparation. You do not need another precompute command or a database migration.",
        )
    ]
    story += [
        p(
            "A failed verification or build leaves the current release untouched. If the server cannot make the new containers healthy, the gateway attempts to restore the previously recorded healthy release and reports the outcome in the Actions log.",
            "SmallBody",
        )
    ]
    story += [PageBreak()]

    story += heading(
        "06",
        "Operate without DB changes",
        "Use Git history for routine application releases. Keep server administration and reviewed local data maintenance separate from the deployment workflow.",
    )
    story += step(
        "13",
        "Ship a code or data-snapshot change",
        "Make and test the change locally, commit it and push to main. The production image carries the reviewed normalized source snapshots and derived graph files. Production source-import/rebuild endpoints are disabled; the pipeline does not connect to the shared database. If a schema or source-data change is needed, review and run it locally before releasing. Do not add migrations or seeds to Actions or container startup.",
    )
    story += step(
        "14",
        "Roll back an unhealthy or unwanted release",
        "The gateway already attempts an automatic rollback if new containers fail their health checks. For a release that is healthy but has an application bug, revert its source commit locally and push the revert to main. This creates a new reviewed release through the normal pipeline.",
    )
    story += [
        code(
            "git switch main\ngit pull --ff-only\ngit revert BAD_COMMIT_SHA\ngit push origin main"
        )
    ]
    story += [
        p(
            "Replace BAD_COMMIT_SHA with the source commit to undo. Resolve any conflicts and rerun the relevant tests before pushing. Do not use a force push, run a database rollback or broadly prune Docker resources shared with other apps.",
            "SmallBody",
        )
    ]
    story += step(
        "15",
        "Inspect only this application as administrator",
        "Log in with your normal administrator access. The restricted CI key intentionally has no diagnostic shell, log browsing or arbitrary Docker access.",
    )
    story += [
        code(
            "sudo docker compose --project-name datathon \\\n  --project-directory /srv/apps/datathon/control \\\n  --env-file /srv/apps/datathon/control/release.env \\\n  --file /srv/apps/datathon/control/compose.yaml ps\nsudo docker compose --project-name datathon \\\n  --project-directory /srv/apps/datathon/control \\\n  --env-file /srv/apps/datathon/control/release.env \\\n  --file /srv/apps/datathon/control/compose.yaml \\\n  logs --tail 100 frontend backend"
        )
    ]
    story += [
        note(
            "Keep controls protected",
            "Code pushes cannot change the fixed gateway, Compose file or environment files. Back up control/, state/ and the two /etc/server-apps/datathon.*.env files privately. Manual fallback uses manual-release.env; Actions uses release.env. Match the manifest to running image IDs before recovery. Preserve ownership and symlinks; never log environment contents.",
        )
    ]
    story += [PageBreak()]

    story += heading(
        "07",
        "Troubleshoot and keep safe",
        "Start with the failed workflow stage. Keep the two SSH secrets encrypted, the host identity pinned and the deployment credential restricted.",
    )
    story += [
        table(
            ["Symptom", "What to check"],
            [
                [
                    "Deploy is skipped",
                    "DATATHON_DEPLOY_ENABLED must be true and the run on main. Manual runs also require deploy checked; its default false intentionally permits build-only branch tests.",
                ],
                [
                    "Permission denied (publickey)",
                    "The secret contains the full matching private key, not .pub text. Check the existing username, SSH port, installed restricted public-key entry and firewall access.",
                ],
                [
                    "Host key verification failed",
                    "Compare the current server fingerprint through a trusted console. Update DATATHON_SSH_KNOWN_HOSTS only after verifying a legitimate host-key change.",
                ],
                [
                    "403 / denied while pulling GHCR",
                    "Check package Actions access for this repository. The job's short-lived token needs package read permission. Do not weaken the gateway to accept other registries.",
                ],
                [
                    "502, 404 or missing styles",
                    "Check the two Nginx locations, 127.0.0.1:18730 and container health. Keep /apps/datathon intact; proxy_pass must not strip the prefix.",
                ],
                [
                    "Gateway or container failure",
                    "Use a normal administrator session to inspect only Datathon containers and the protected control-file ownership. Check available disk, RAM and Docker Compose support.",
                ],
            ],
            [BODY_W * 0.32, BODY_W * 0.68],
        )
    ]
    story += [
        p("Rotate or revoke the deployment key", "SubGuide"),
        p(
            "Generate a replacement key, have the administrator replace only the old Datathon restricted authorized_keys entry, then update DATATHON_SSH_PRIVATE_KEY. To stop automated deployments immediately, set DATATHON_DEPLOY_ENABLED to false and remove the dedicated public-key entry if compromise is suspected.",
            "SmallBody",
        ),
    ]
    story += [p("Official references and source files", "SubGuide")]
    story += [
        p(
            a(
                "GitHub: create repository secrets",
                "https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets",
            )
            + "<br/>"
            + a(
                "GitHub: configuration variables",
                "https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables",
            )
            + "<br/>"
            + a(
                "GitHub: deployment environments",
                "https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments",
            )
            + "<br/>"
            + a(
                "GitHub: container registry authentication",
                "https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry",
            ),
            "SmallBody",
        )
    ]
    story += [
        p(
            "Reference screenshots: GitHub Docs, Figures 1-2 on page 4. Screens may change over time. Implementation sources: .github/workflows/deploy.yml; Dockerfile; deploy/docker-bake.hcl; deploy/install-server.sh; deploy/server/deploy.py; deploy/server/compose.yaml; deploy/nginx-location.conf; docs/deployment.md. Guide source updated 18 October 2026.",
            "CaptionGuide",
        )
    ]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=(PAGE_W, PAGE_H),
        title="Datathon production deployment guide",
        author="Datathon",
        subject="Scoped server deployment and GitHub Actions setup",
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=58,
        bottomMargin=54,
    )
    frame = Frame(
        MARGIN,
        54,
        BODY_W,
        PAGE_H - 112,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    doc.addPageTemplates(PageTemplate(id="guide", frames=[frame], onPage=decorate))
    doc.build(story)
    from pypdf import PdfReader

    reader = PdfReader(OUTPUT)
    if len(reader.pages) != 8:
        raise RuntimeError(
            f"Expected 8 pages, generated {len(reader.pages)}; fix page overflow."
        )
    for index, page in enumerate(reader.pages, 1):
        content = page.extract_text() or ""
        if not content.strip():
            raise RuntimeError(f"Page {index} has no extractable text.")
    print(f"Created {OUTPUT} ({len(reader.pages)} pages)")


if __name__ == "__main__":
    build()
