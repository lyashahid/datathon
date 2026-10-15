# ruff: noqa: E501
from importlib.resources import files

import pytest

from vendor.vela_api.browser import (
    MORE_PATTERN,
    REVIEW_PATTERN,
    SELECTORS,
    BrowserReviews,
    browser_language,
    normalize_reviews,
)
from vendor.vela_api.common import ApiError
from vendor.vela_api.config import load_calibration


def test_languages_and_rating_unknown():
    assert browser_language("zh-HK") == "zh-TW"
    assert browser_language("he") == "iw"
    assert browser_language("ur") == "en"
    reviews = normalize_reviews(
        [{"a": "Jane", "r": 0, "t": "Hi"}, {"a": "", "r": 5}, {"a": "Bool", "r": True}]
    )
    assert len(reviews) == 2 and reviews[0]["rating"] is None and reviews[1]["rating"] is None


async def test_browser_disabled_is_explicit():
    service = BrowserReviews(load_calibration())
    with pytest.raises(ApiError) as error:
        await service.reviews("0x1:0x2")
    assert error.value.code == "browser_disabled" and error.value.status_code == 503


@pytest.mark.browser
async def test_vendored_scraper_in_real_chromium_offline():
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(offline=True, viewport={"width": 1200, "height": 1000})
        try:
            page = await context.new_page()
            await page.set_content("""<h1>D-avis Cafe</h1>
                <button role="tab" aria-label="Overview of D-avis Cafe" onclick="window.wrongClick=true">Overview</button>
                <div class="jJc9Ad"><div data-review-id="one"></div><span class="d4r55">Jane</span>
                  <span role="img" aria-label="5 顆星"></span><span class="wiI7pd">Great coffee.</span>
                  <span class="rsqaWe">a month ago</span></div>
                <div class="jJc9Ad"><div data-review-id="two"></div><span class="d4r55">Ali</span>
                  <span role="img" aria-label="4 stars"></span><span class="wiI7pd">Nice place.</span></div>""")
            script = (
                files("vendor.vela_api").joinpath("data/reviews.js").read_text(encoding="utf-8")
            )
            await page.evaluate(
                script,
                {
                    "cap": 2,
                    "selectors": SELECTORS,
                    "reviewPattern": REVIEW_PATTERN,
                    "morePattern": MORE_PATTERN,
                },
            )
            await page.wait_for_function("window.__velaReviewResult !== null", timeout=3000)
            reviews = normalize_reviews(await page.evaluate("window.__velaReviewResult"))
            assert [r["author"] for r in reviews] == ["Jane", "Ali"]
            assert [r["rating"] for r in reviews] == [5, 4]
            assert reviews[0]["relative_time"] == "a month ago"
            assert await page.evaluate("window.wrongClick || false") is False
        finally:
            await context.close()
            await browser.close()
