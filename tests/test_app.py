"""The web layer: PWA plumbing, and the readers behind the share dispatcher.

The dispatch itself runs in the page now (``web/reader/share-dispatch.ts``,
tested in ``tests/reader/share-dispatch.test.ts``). ``/share/parse`` is still
served and still reads, and the tests below still hold the Python readers to
the boards they produce for a shared screenshot, until the whole app goes.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import app

FIXTURES = Path(__file__).parent / "fixtures"
KILLER = FIXTURES / "puzzle_page_killer_board3.png"
CLASSIC = FIXTURES / "meowdoku_sample_board.png"

client = TestClient(app)


def _share(path: Path):
    with path.open("rb") as fh:
        return client.post("/share/parse", files={"image": (path.name, fh, "image/png")})


def _manifest() -> dict:
    return json.loads((Path(__file__).parent.parent / "static" / "manifest.webmanifest").read_text())


# --- installability -------------------------------------------------------


def test_manifest_is_served_as_a_manifest():
    # Served as anything else it is ignored, and with it the share target — so
    # the app would install but never appear in the share sheet.
    res = client.get("/manifest.webmanifest")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/manifest+json")


def test_manifest_declares_what_chrome_needs_to_offer_an_install():
    manifest = _manifest()
    assert manifest["display"] == "standalone", "a 'browser' display is not installable"
    sizes = {icon["sizes"] for icon in manifest["icons"]}
    assert {"192x192", "512x512"} <= sizes


def test_a_maskable_icon_is_offered():
    # Without one, Android puts the square icon in a white circle on many
    # launchers rather than cropping it.
    assert any(icon.get("purpose") == "maskable" for icon in _manifest()["icons"])


@pytest.mark.parametrize("icon", ["icon-192.png", "icon-512.png", "icon-maskable-512.png"])
def test_every_icon_the_manifest_names_exists(icon):
    assert (Path(__file__).parent.parent / "static" / "icons" / icon).is_file()


def test_service_worker_is_served_from_the_root():
    # A worker's scope is the directory it is served from. One under /static
    # could not intercept the share POST to /share, so this route is the whole
    # reason the file is not simply left in the static mount.
    res = client.get("/sw.js")
    assert res.status_code == 200
    assert "javascript" in res.headers["content-type"]


# The manifest, Chrome and sw.js have to agree on the form field name, and that
# assertion used to live here — /share/parse was the fourth place that had to
# agree. The page reads the stashed file rather than a form field now, so the
# agreement no longer involves this app at all and is asserted in
# tests/ui/share-target.test.js, which outlives it.


def test_a_share_that_the_worker_missed_still_lands_on_the_app():
    # No service worker registered means no interception; the GET should show
    # the app rather than a 404, even though the screenshot itself is lost.
    res = client.get("/share")
    assert res.status_code == 200
    assert "<title>" in res.text


# --- choosing a reader ----------------------------------------------------


def test_a_shared_killer_screenshot_goes_to_the_killer_tab():
    res = _share(KILLER)
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "killer"
    assert len(body["board"]["cages"]) == 28
    assert body["checksum_ok"], "the share path must not read the board any worse"


def test_a_shared_classic_screenshot_goes_to_the_sudoku_tab():
    # The share sheet offers one target but the app has two readers, so the
    # cage count decides. A board with no cage outlines yields at most a stray
    # one or two from grid artefacts.
    res = _share(CLASSIC)
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "sudoku"
    assert len(body["board"]["cells"]) == 81


def test_the_two_kinds_are_told_apart_by_a_wide_margin():
    # The threshold sits in a gap, not on a boundary: if these ever converge
    # the sniff is the thing to revisit, not the constant to nudge.
    import app as web

    killer_cages = len(_share(KILLER).json()["board"]["cages"])
    classic_cages = len(web._read_killer(CLASSIC.read_bytes())["board"]["cages"])
    assert classic_cages < web.MIN_KILLER_CAGES < killer_cages
    assert killer_cages - classic_cages > 20


def test_a_shared_non_board_is_refused_rather_than_guessed_at():
    res = client.post(
        "/share/parse", files={"image": ("noise.png", b"not a png at all", "image/png")}
    )
    assert res.status_code == 422
