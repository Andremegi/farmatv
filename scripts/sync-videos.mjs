// Se ejecuta en cada build de Netlify.
// Descarga los MP4 de la carpeta de vídeos de Drive a public/videos/
// y genera public/videos/list.json para que la web los reproduzca
// desde Netlify (sin depender de Google en la TV).
//
// Si algo falla, el build falla y Netlify mantiene publicada la versión anterior.

import { mkdir, writeFile, readFile, rename, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const API_KEY = process.env.GOOGLE_API_KEY;
const FOLDER_ID = process.env.VIDEOS_FOLDER_ID;
const OUT_DIR = "public/videos";

if (!API_KEY || !FOLDER_ID) {
  console.error("Faltan GOOGLE_API_KEY o VIDEOS_FOLDER_ID en las variables de Netlify");
  process.exit(1);
}

async function listVideos() {
  const params = new URLSearchParams({
    q: `'${FOLDER_ID}' in parents and trashed = false and mimeType = 'video/mp4'`,
    fields: "files(id,name,size)",
    pageSize: "100",
    orderBy: "name",
    key: API_KEY
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!res.ok) throw new Error(`Drive list ${res.status}: ${await res.text()}`);
  return (await res.json()).files || [];
}

async function download(file) {
  const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`;
  const res = await fetch(url);
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("video/")) {
    throw new Error(`No se pudo descargar ${file.name}: ${res.status} ${type}`);
  }
  const raw = `${OUT_DIR}/${file.id}.original.mp4`;
  const out = `${OUT_DIR}/${file.id}.mp4`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(raw));

  // Los vídeos de iPhone suelen venir en HEVC (H.265), que el navegador de
  // muchas Smart TV (p. ej. Samsung) no reproduce. Se convierten a H.264.
  if (isHevc(await readFile(raw))) {
    console.log(`  HEVC detectado, convirtiendo a H.264...`);
    await promisify(execFile)(ffmpegPath, [
      "-y", "-loglevel", "error",
      "-i", raw,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      out
    ], { maxBuffer: 1024 * 1024 * 10 });
    await unlink(raw);
  } else {
    await rename(raw, out);
  }
}

function isHevc(buffer) {
  return buffer.includes("hvc1") || buffer.includes("hev1");
}

const files = await listVideos();
await mkdir(OUT_DIR, { recursive: true });

for (const file of files) {
  const mb = file.size ? (Number(file.size) / 1e6).toFixed(1) : "?";
  console.log(`Descargando ${file.name} (${mb} MB)...`);
  await download(file);
}

const list = files.map(f => ({ id: f.id, name: f.name, src: `/videos/${f.id}.mp4` }));
await writeFile(`${OUT_DIR}/list.json`, JSON.stringify({ files: list }, null, 2));
console.log(`${list.length} vídeos listos en ${OUT_DIR}`);
