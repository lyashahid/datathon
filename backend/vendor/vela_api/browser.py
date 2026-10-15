# ruff: noqa: E501
"""Optional server Chromium adaptation of Vela's anonymous review WebView."""

import asyncio
from importlib.resources import files
from urllib.parse import urlencode, urlsplit

from .common import ApiError

REVIEW_PATTERN = "review|rezension|bewertung|reseña|opini|avis|commentaire|recension|recensioni|avalia|beoordel|отзыв|відгук|omdöme|vélemény|értékelés|recenzi|ביקור|评论|評論|评价|クチコミ|口コミ|レビュー"
MORE_PATTERN = "more|all|mehr|alle|más|todas|plus|tous|più|tutte|mais|meer|ещё|все|więcej|wszystkie|fler|alla|több|összes|mai multe|toate|більше|всі|עוד|כל|更多|全部|もっと|すべて"
SELECTORS = {
    "card": ".jJc9Ad",
    "id": "[data-review-id]",
    "moreToggle": "button.w8nwRe",
    "author": ".d4r55,.Vpc5Fe,.TSUbDb",
    "text": ".wiI7pd",
    "date": ".rsqaWe",
}
SUPPORTED_LANGUAGES = {
    "en",
    "fr",
    "de",
    "es",
    "it",
    "pt",
    "nl",
    "ru",
    "pl",
    "sv",
    "uk",
    "hu",
    "ro",
    "zh",
    "ja",
    "he",
    "iw",
}


def browser_language(language):
    base = language.split("-")[0].lower()
    if base not in SUPPORTED_LANGUAGES:
        return "en"
    if base == "he":
        return "iw"
    if base == "zh":
        return "zh-TW" if language.lower() in {"zh-tw", "zh-hk", "zh-mo", "zh-hant"} else "zh-CN"
    return base


def normalize_reviews(rows):
    result = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("a"):
            continue
        result.append(
            {
                "id": row.get("rid") or None,
                "author": row["a"],
                "author_photo": row.get("av") or None,
                "rating": row.get("r")
                if isinstance(row.get("r"), int)
                and not isinstance(row.get("r"), bool)
                and row.get("r") in (1, 2, 3, 4, 5)
                else None,
                "relative_time": row.get("d") or None,
                "text": row.get("t") or None,
                "photos": row.get("p") or [],
            }
        )
    return result


class BrowserReviews:
    def __init__(self, calibration, enabled=False):
        self.calibration, self.enabled = calibration, enabled
        self._playwright = self._browser = self._context = None
        self._lock = asyncio.Lock()

    async def _start(self):
        if self._context:
            return
        try:
            from playwright.async_api import async_playwright

            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(headless=True)
            # One process-local anonymous browser session; every lookup gets a fresh page.
            self._context = await self._browser.new_context(
                viewport={"width": 1200, "height": 1000},
                user_agent=self.calibration["userAgent"],
                locale="en-US",
                service_workers="block",
            )
        except Exception as exc:
            await self.close()
            raise ApiError(
                "browser_unavailable",
                "Install the browser extra and run python -m playwright install chromium.",
                503,
            ) from exc

    async def close(self):
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._playwright = self._browser = self._context = None

    async def reviews(self, feature_id, limit=50, language="en", region="us"):
        if not self.enabled:
            raise ApiError(
                "browser_disabled",
                "Enable VELA_BROWSER_ENABLED=true and install Chromium to use browser reviews.",
                503,
            )
        try:
            cid = str(int(feature_id.split(":")[1][2:], 16))
        except (ValueError, IndexError) as exc:
            raise ApiError("invalid_argument", "A Google feature_id is required.", 422) from exc
        # Queue wait is bounded too; the browser is intentionally serialized.
        try:
            async with asyncio.timeout(50):
                async with self._lock:
                    await self._start()
                    return await self._fetch(cid, limit, language, region)
        except TimeoutError as exc:
            raise ApiError(
                "browser_timeout", "The browser review request exceeded its deadline.", 504
            ) from exc

    async def _fetch(self, cid, limit, language, region):
        page = await self._context.new_page()
        script = files(__package__).joinpath("data/reviews.js").read_text(encoding="utf-8")
        lang = browser_language(language)

        async def filter_requests(route):
            parts = urlsplit(route.request.url)
            host = (parts.hostname or "").lower()
            allowed = parts.scheme == "https" and any(
                host == s or host.endswith("." + s)
                for s in (
                    "google.com",
                    "googleapis.com",
                    "googleusercontent.com",
                    "gstatic.com",
                    "ggpht.com",
                )
            )
            if allowed:
                await route.continue_()
            else:
                await route.abort()

        await page.route("**/*", filter_requests)
        try:
            url = "https://www.google.com/maps?" + urlencode({"cid": cid, "hl": lang, "gl": region})
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            except Exception as exc:
                raise ApiError(
                    "browser_navigation_failed", "The Google Maps page could not be loaded.", 502
                ) from exc
            if "consent.google." in page.url or "/sorry/" in page.url:
                raise ApiError(
                    "upstream_blocked", "Google requires consent or a verification challenge.", 503
                )
            await page.evaluate(
                script,
                {
                    "cap": limit,
                    "reviewPattern": (self.calibration.get("reviewWords") or {}).get(
                        "review", REVIEW_PATTERN
                    ),
                    "morePattern": (self.calibration.get("reviewWords") or {}).get(
                        "more", MORE_PATTERN
                    ),
                    "selectors": SELECTORS | (self.calibration.get("reviewSelectors") or {}),
                },
            )
            settled = True
            try:
                await page.wait_for_function("window.__velaReviewResult !== null", timeout=35000)
            except Exception:
                settled = False
            rows = await page.evaluate(
                "window.__velaReviewResult || window.__velaReviewPartial || []"
            )
            if not rows:
                # An empty page might be a layout change or a challenge: do not label it zero reviews.
                raise ApiError(
                    "browser_no_reviews",
                    "The browser returned no readable review cards; absence of reviews is unconfirmed.",
                    502,
                )
            return {
                "reviews": normalize_reviews(rows)[:limit],
                "next_token": None,
                "end": None,
                "completeness": "limited",
                "backend": "browser",
                "pagination_verified": False,
                "requested_language": language,
                "page_language": lang,
                "settled": settled,
                "rating_histogram": await page.evaluate("window.__velaReviewHistogram"),
            }
        finally:
            await page.close()
