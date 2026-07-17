# Kiteframe recording demo

Kiteframe is a fictional SaaS signup journey built specifically for the
chrome-bridge operation-recording showcase. Every name, metric, testimonial,
email address, and product claim is synthetic. The site makes no network
requests and submits no data.

## Serve the site

From the repository root:

```bash
python3 -m http.server 4177 --bind 127.0.0.1 --directory examples/recording-demo
```

Open `http://127.0.0.1:4177/`. Keep the Chrome viewport unchanged throughout a
recording run so every WebM has compatible dimensions.

With the chrome-bridge server and exactly one extension instance connected, the
canonical journey can be recorded automatically:

```bash
uv run python examples/recording-demo/record_journey.py
```

The script opens the fixture in an inactive tab, selects it as the operation
target without foregrounding it, records the journey below
`Downloads/chrome-bridge`, and writes the actual uniquified download names to
`/tmp/kiteframe-recordings.json`. It leaves the demo tab open for review; pass
`--close-tab` to close only that tab after recording.

## Canonical recording journey

Use the visible placeholder/help values so the finished recording contains no
personal data. Each filename is passed as `video_filename` except the first,
standalone establishing shot.

| Order | Action | Output filename |
| --- | --- | --- |
| 01 | Record the landing-page hero for 2 seconds | `01-landing.webm` |
| 02 | Navigate without recording, then hold on the signup screen for 1 second | `02-signup-arrival.webm` |
| 03 | Type `Morgan Rivera` into **Full name** | `03-full-name.webm` |
| 04 | Type `morgan@example.test` into **Work email** | `04-email.webm` |
| 05 | Type `frame-demo-2026` into **Create a password** | `05-password.webm` |
| 06 | Type `Northstar Studio` into **Workspace name** | `06-workspace.webm` |
| 07 | Select `11–50 people` under **Team size** | `07-team-size.webm` |
| 08 | Select `Operations` under **Your role** | `08-role.webm` |
| 09 | Press `PageDown` to reveal the goal cards | `09-scroll.webm` |
| 10 | Click **Smoother launches** | `10-goal.webm` |
| 11 | Click the local-demo acknowledgement | `11-acknowledge.webm` |
| 12 | Click **Create my workspace** | `12-complete.webm` |

The exact ref strings are intentionally not documented: take a fresh
`browser_snapshot` before each strict-ref operation.

## Join the recordings

The recorder saves the clips under `Downloads/chrome-bridge`. Validate and join
them without committing the raw recordings:

```bash
python3 examples/recording-demo/join_recordings.py \
  "$HOME/Downloads/chrome-bridge" \
  /tmp/kiteframe-showcase.webm \
  --mp4 /tmp/kiteframe-showcase.mp4
```

The script considers only files matching `[0-9][0-9]-*.webm`. It verifies each
video with `ffprobe`, uses lossless stream concatenation when the video streams
match, and otherwise normalizes the clips to the first clip's dimensions before
encoding a joined WebM. The optional MP4 is H.264 with fast-start metadata for
review and upload compatibility.

Before publication, watch the joined video from beginning to end and confirm:

- the virtual cursor, typed values, selections, scrolling, and final transition
  are legible;
- the current scrolled viewport is recorded, with no jump to the document top;
- there is no black lead-in frame or accidental browser/profile information;
- only the controlled `.test` address and fictional names appear.
