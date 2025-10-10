import { promises as fs } from 'fs';
import { createWriteStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import ffmpeg from 'fluent-ffmpeg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VIDEO_LIST_PATH = path.join(__dirname, 'videoList.json');
const OUTPUT_JSON_PATH = path.join(__dirname, 'videoList_converted.json');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const GIF_DIR = path.join(__dirname, 'gifs');

const customFfmpegPath = process.env.FFMPEG_PATH;
if (customFfmpegPath) {
  ffmpeg.setFfmpegPath(customFfmpegPath);
}

async function ensureDirectories() {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  await fs.mkdir(GIF_DIR, { recursive: true });
}

async function readVideoList() {
  const raw = await fs.readFile(VIDEO_LIST_PATH, 'utf8');
  return JSON.parse(raw);
}

function collectVideoEntries(node, entries = []) {
  if (!node) {
    return entries;
  }

  if (Array.isArray(node)) {
    node.forEach(item => collectVideoEntries(item, entries));
  } else if (typeof node === 'object') {
    if (typeof node.video === 'string') {
      entries.push(node);
    }
    Object.values(node).forEach(value => collectVideoEntries(value, entries));
  }

  return entries;
}

function extractFilenameFromUrl(url) {
  try {
    const { pathname } = new URL(url);
    return decodeURIComponent(path.basename(pathname));
  } catch (error) {
    throw new Error(`Unable to parse URL "${url}": ${error.message}`);
  }
}

async function downloadFile(url, destination) {
  if (existsSync(destination)) {
    return destination;
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(destination));
  return destination;
}

function convertToGif(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vf',
        'fps=12,scale=512:-1:flags=lanczos'
      ])
      .toFormat('gif')
      .on('error', reject)
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

function normalizePath(filePath) {
  return path.relative(__dirname, filePath).split(path.sep).join('/');
}

async function processEntry(entry) {
  if (!entry.video || !entry.video.toLowerCase().endsWith('.mp4')) {
    return null;
  }

  const originalUrl = entry.video;
  const filename = extractFilenameFromUrl(originalUrl);
  const baseName = filename.replace(/\.[^.]+$/u, '');
  const localMp4Path = path.join(DOWNLOAD_DIR, filename);
  const localGifPath = path.join(GIF_DIR, `${baseName}.gif`);

  console.log(`Processing ${originalUrl}`);

  await downloadFile(originalUrl, localMp4Path);
  await convertToGif(localMp4Path, localGifPath);

  entry.video = normalizePath(localGifPath);
  return { originalUrl, gifPath: localGifPath };
}

async function main() {
  await ensureDirectories();

  const videoList = await readVideoList();
  const entries = collectVideoEntries(videoList);
  const conversionResults = [];

  for (const entry of entries) {
    if (entry.video && entry.video.toLowerCase().endsWith('.mp4')) {
      const result = await processEntry(entry);
      if (result) {
        conversionResults.push(result);
      }
    }
  }

  await fs.writeFile(OUTPUT_JSON_PATH, JSON.stringify(videoList, null, 2));

  console.log(`Converted ${conversionResults.length} MP4 file(s) to GIF.`);
  console.log(`Updated JSON saved to ${OUTPUT_JSON_PATH}`);
}

if (import.meta.url === `file://${__filename}`) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
