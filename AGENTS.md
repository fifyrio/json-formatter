# Repository Guidelines

## Project Structure & Module Organization
This Node.js tool ingests remote MP4 files and emits local GIFs plus enriched metadata. `convertMp4ToGif.js` is the primary entry point; it reads `videoList.json`, downloads missing assets into `downloads/`, and writes GIFs to `gifs/`. The conversion report lands in `videoList_converted.json`, while Cloudflare-ready entries are written by `uploadVideosToR2.js` into `videoList_r2.json`. Keep supplemental datasets such as `home_data.json` at the project root for quick inspection, and avoid committing oversized intermediates outside the `downloads/` cache.

## Build, Test, and Development Commands
- `npm install` — installs `fluent-ffmpeg`, AWS SDK clients, and supporting dependencies.
- `npm run convert` — runs the end-to-end conversion pipeline; respect `FFMPEG_PATH=/custom/bin ffmpeg` when a bundled binary is required.
- `npm run upload:r2` — uploads generated GIFs and videos to Cloudflare R2, producing fresh public URLs.
All commands assume Node.js 18+ and draw credentials from `.env`.

## Coding Style & Naming Conventions
Use ES module syntax with top-level async helpers and two-space indentation. Prefer `const` unless reassignment is necessary, adopt camelCase for functions such as `collectVideoEntries`, and reserve SCREAMING_SNAKE_CASE for config constants near the top of each file. Co-locate helper utilities with related logic so the scripts read linearly.

## Testing Guidelines
There is no automated test suite. Validate changes by running `npm run convert` on a limited subset of `videoList.json`, then confirm console summaries, JSON diffs, and fresh files in `gifs/`. When adjusting parsing or metadata shaping, stage a temporary entry that covers the new branch and inspect log output before removing the fixture.

## Commit & Pull Request Guidelines
Commits should be short, imperative statements (e.g., “Refresh sample video metadata”). For pull requests, include a concise overview, list modified data files, call out manual validation steps, and attach before/after GIFs when visual quality could shift. Squash local fixups before opening the PR.

## Security & Configuration Tips
Keep `.env` out of version control; populate it with `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, optional `R2_PREFIX`, and `R2_PUBLIC_BASE_URL`. Tune `R2_DOWNLOAD_DELAY_MS` if remote endpoints need throttling, and verify the `downloads/`, `downloads_r2/`, and `gifs/` directories remain writable on your OS.
