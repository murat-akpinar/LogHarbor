# readme-tour

Records `images/logharbor-tour.gif`, the animation at the top of the README: Dashboard →
Events → Requests → Exceptions → Analysis, driven through the real nav links.

It borrows Playwright and the event seeder from [`../perf-check`](../perf-check), so install
happens there:

```bash
cd ../perf-check && npm install && npx playwright install chromium
```

Then, from this directory:

```bash
node tour.mjs                                     # own throwaway server, seeded, ~3 min
node tour.mjs --url http://192.168.1.131:5000 --pass '...'    # a running instance, ~40 s
node tour.mjs --keep-video                        # leave the webm in .work/ to inspect
```

Either way it overwrites `images/logharbor-tour.gif` in place. Encoding needs **ffmpeg** on
PATH and **npx** (for gifsicle); with neither, the webm is kept and the path printed.

## What it does that is not obvious

* **Draws its own cursor.** Playwright's video has no pointer, so an unedited take looks like
  a slideshow of screenshots — you cannot see that anything was clicked.
* **Throws away a warm-up load.** The first visit pays for the bundle, the fonts and every
  cold query. Filming it puts six seconds of nothing at the front of the gif.
* **Waits on `[data-skeleton]`, not on the network.** The live tail holds a websocket open, so
  `networkidle` never arrives and every dwell would be spent filming loading placeholders.
* **Marks the ingest-rejection banner read** and paints the document background dark before
  the stylesheet lands — otherwise frame one is a white flash and a week-old warning.

## Numbers

860 px wide (what GitHub gives a README image), 10 fps, 128 colours, gifsicle `--lossy=45`.
That lands around 3.7 MB for a 23-second tour. Raising the colour count to 200 or the width
to 1000 doubles the file for a difference nobody sees; dithering is off because a dark UI
does not band at 128 and the dither noise is what makes the file large.
