import 'dotenv/config';
import { promises as fs } from 'fs';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_JSON_PATH = path.join(__dirname, 'videoList_converted.json');
const OUTPUT_JSON_PATH = path.join(__dirname, 'videoList_r2.json');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads_r2');
const DOWNLOAD_DELAY_MS = Number.parseInt(process.env.R2_DOWNLOAD_DELAY_MS ?? '2000', 10) || 0;

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function loadConfig() {
  const accountId = getRequiredEnv('R2_ACCOUNT_ID');
  const accessKeyId = getRequiredEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = getRequiredEnv('R2_SECRET_ACCESS_KEY');
  const bucket = getRequiredEnv('R2_BUCKET_NAME');
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    prefix: process.env.R2_PREFIX ?? '',
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? '',
  };
}

function createS3Client(config) {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

async function ensureDirectories() {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(url, options = {}, maxAttempts = 3, backoffMs = 2000) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      const response = await fetch(url, options);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw error;
      }

      const waitTime = backoffMs * 2 ** (attempt - 1);
      console.warn(`Download attempt ${attempt} for ${url} failed (${error.message}). Retrying in ${waitTime}ms.`);
      await delay(waitTime);
    }
  }

  throw new Error(`Failed to download ${url} after ${maxAttempts} attempts.`);
}

async function readVideoList() {
  const raw = await fs.readFile(INPUT_JSON_PATH, 'utf8');
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

function isRemotePath(target) {
  return /^https?:\/\//iu.test(target);
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function sanitizeKeySegment(segment) {
  return segment.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/u, '');
}

function deriveObjectKey(source, localPath, prefix) {
  const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
  let keyBase = '';

  if (isRemotePath(source)) {
    const { pathname } = new URL(source);
    keyBase = decodeURIComponent(pathname);
  } else {
    const relativeLocal = path.relative(__dirname, localPath);
    keyBase = toPosixPath(relativeLocal);
  }

  keyBase = sanitizeKeySegment(keyBase);

  if (normalizedPrefix) {
    return `${normalizedPrefix}/${keyBase}`;
  }

  return keyBase;
}

async function downloadRemoteFile(url) {
  const { pathname } = new URL(url);
  const decodedPath = decodeURIComponent(pathname).replace(/^\/+/, '');
  const destination = path.join(DOWNLOAD_DIR, decodedPath);

  if (existsSync(destination)) {
    return destination;
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });

  if (DOWNLOAD_DELAY_MS > 0) {
    await delay(DOWNLOAD_DELAY_MS);
  }

  const response = await fetchWithRetry(url);

  await pipeline(response.body, createWriteStream(destination));
  return destination;
}

async function resolveLocalPath(target) {
  if (isRemotePath(target)) {
    return downloadRemoteFile(target);
  }

  const absolute = path.isAbsolute(target) ? target : path.join(__dirname, target);
  await fs.access(absolute);
  return absolute;
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

async function uploadToR2(client, config, filePath, objectKey) {
  const contentType = guessContentType(filePath);
  const body = createReadStream(filePath);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

function buildPublicUrl(config, objectKey) {
  if (config.publicBaseUrl) {
    const base = config.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/${objectKey}`;
  }

  return `https://${config.bucket}.${config.accountId}.r2.cloudflarestorage.com/${objectKey}`;
}

async function processEntry(entry, context) {
  if (!entry.video || typeof entry.video !== 'string') {
    return null;
  }

  const source = entry.video.trim();
  if (!source) {
    return null;
  }

  const localPath = await resolveLocalPath(source);
  const objectKey = deriveObjectKey(source, localPath, context.config.prefix);

  if (context.uploadedKeys.has(objectKey)) {
    return {
      key: objectKey,
      url: buildPublicUrl(context.config, objectKey),
      reused: true,
    };
  }

  await uploadToR2(context.client, context.config, localPath, objectKey);
  context.uploadedKeys.add(objectKey);

  return {
    key: objectKey,
    url: buildPublicUrl(context.config, objectKey),
    reused: false,
  };
}

async function main() {
  const config = loadConfig();
  const client = createS3Client(config);
  await ensureDirectories();

  const videoList = await readVideoList();
  const entries = collectVideoEntries(videoList);
  const context = {
    client,
    config,
    uploadedKeys: new Set(),
  };

  let uploadCount = 0;
  let reusedCount = 0;
  let failureCount = 0;

  for (const entry of entries) {
    let result;
    try {
      result = await processEntry(entry, context);
    } catch (error) {
      failureCount += 1;
      console.error(`Failed to process ${entry.video}: ${error.message}`);
      continue;
    }

    if (!result) {
      continue;
    }

    entry.video = result.url;
    if (result.reused) {
      reusedCount += 1;
    } else {
      uploadCount += 1;
      console.log(`Uploaded ${result.key}`);
    }
  }

  await fs.writeFile(OUTPUT_JSON_PATH, JSON.stringify(videoList, null, 2));

  console.log(`Uploaded ${uploadCount} new file(s) to R2. Reused ${reusedCount} existing upload(s).`);
  if (failureCount > 0) {
    console.warn(`Skipped ${failureCount} file(s) due to download or upload errors. Check logs above.`);
  }
  console.log(`Updated JSON with R2 URLs saved to ${OUTPUT_JSON_PATH}`);
}

if (import.meta.url === `file://${__filename}`) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
