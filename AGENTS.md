# Repository Guidelines

## Project Structure & Module Organization
This repository is a single-purpose Node.js tool that converts remote MP4 assets into locally hosted GIFs. Core logic lives in `convertMp4ToGif.js`, which reads `videoList.json`, enriches entries, and writes the result to `videoList_converted.json`. Downloaded source videos are cached under `downloads/`, while generated animations are written to `gifs/` so they can be committed or inspected. Supplemental datasets such as `home_data.json` stay at the project root for easy inspection.

## Build, Test, and Development Commands
Run `npm install` once to pull `fluent-ffmpeg`, `@aws-sdk/client-s3`, `dotenv`, and supporting packages. Use `npm run convert` to execute the conversion pipeline end-to-end; it creates the output JSON and refreshes any missing assets. Trigger `npm run upload:r2` after conversion to push all referenced media to Cloudflare R2 and produce `videoList_r2.json` with public URLs. When a custom ffmpeg binary is required, prefix conversion with `FFMPEG_PATH=/path/to/ffmpeg npm run convert`. All commands assume Node.js 18+ for native `fetch` support and load configuration from the project `.env`.

## Coding Style & Naming Conventions
Code is written as ES modules with `import` statements and top-level async helpers. Follow the existing two-space indentation, prefer `const`/`let` over `var`, and use descriptive camelCase for functions such as `collectVideoEntries`. Constants that act as configuration (e.g., `VIDEO_LIST_PATH`) are uppercased and defined near the top of the file. Keep helper functions pure where possible and place new utilities alongside related logic to preserve the script’s linear flow.

## Testing Guidelines
There is no automated test suite; validate changes by running `npm run convert` against a representative slice of `videoList.json` and confirming the console summary, the updated JSON diff, and the presence of expected GIF assets. When touching parsing logic, seed a temporary entry that exercises the new path and inspect the logged output for regression clues. Remove any exploratory fixtures before committing.

## Commit & Pull Request Guidelines
Existing history favors short, imperative commit subjects (e.g., “Remove duplicate entries from videoList dataset”). Mirror that style, and squash fixups locally before opening a PR. Pull requests should include a concise summary, note the data files touched, mention manual validation steps, and link to any related issue. Attach before/after screenshots or GIF previews when the change affects generated media so reviewers can spot quality regressions quickly.

## Environment & Dependency Notes
Ensure ffmpeg is installed and reachable on your PATH or explicitly set via `FFMPEG_PATH`. Configure R2 credentials in `.env` using `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and optional `R2_PREFIX`/`R2_PUBLIC_BASE_URL`. Set `R2_DOWNLOAD_DELAY_MS` (default 2000) if you need a longer pause between remote GIF downloads. Generated assets can grow quickly; periodically prune unused files to keep the repo lightweight. When working on macOS or Linux, confirm the downloads, downloads_r2, and gifs directories remain writable because the scripts create them at runtime if missing.
