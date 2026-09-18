# The Queens reader has no self-calibrating template store

Sudoku's reader ships seeded from rendered fonts and learns from every confirmed board (`/confirm` → `sudoku/reader/calibrate.py`), because digit fonts vary across the apps it might read. The Queens reader deliberately skips this: it targets Meowdoku only, which has exactly two fixed glyphs to recognize (the queen marker and the X) plus region colors that are consistent within an app and don't need learning (they're clustered per-board, unsupervised). If a second Queens-style app with different marker glyphs needs supporting later, revisit this — a calibration loop becomes worth its cost once there's font/glyph variation to adapt to.

## Amendment (Sudoku's loop is gone too)

The premise above no longer holds on Sudoku's side: with its reader ported into the browser and the Python runtime deleted, the learning half went with it and only the seeded exemplars remain (`docs/adr/0006-the-screenshot-reader-runs-in-the-browser-on-opencv-js.md`). The argument there was not that digit fonts stopped varying — they have not — but that a per-device store that never syncs is a worse answer to that than the trained classifier replacing it.

So neither reader learns anything now, for different reasons, and this decision is unchanged either way. What the amendment costs is the comparison: "unlike Sudoku's" is no longer the reason to keep the Queens reader simple. The reason is the one stated above on its own terms — two fixed glyphs and per-board colour clustering — and it is still the thing to revisit if a second Queens-style app turns up.
