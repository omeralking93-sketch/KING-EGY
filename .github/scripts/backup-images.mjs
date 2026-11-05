import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const baseUrl = process.env.SUPABASE_URL;
const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const outputDir = process.env.BACKUP_IMAGES_DIR || "backup-images";

if (!baseUrl || !apiKey) throw new Error("Missing Supabase public API configuration.");

await fs.mkdir(outputDir, { recursive: true });

const headers = {
  apikey: apiKey,
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
};

async function getImageUrls(table) {
  const url = new URL(`/rest/v1/${table}`, baseUrl);
  url.searchParams.set("select", "image_url");
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Could not read ${table}: HTTP ${response.status}`);
  const rows = await response.json();
  return rows.map((row) => row.image_url).filter((value) => typeof value === "string" && value.length);
}

const allUrls = new Set([
  ...(await getImageUrls("products")),
  ...(await getImageUrls("product_images")),
]);

const manifest = [];
let index = 0;

for (const rawUrl of allUrls) {
  let url;
  try { url = new URL(rawUrl); } catch { continue; }

  // Only archive images stored in this project's public product-images bucket.
  if (
    url.hostname !== new URL(baseUrl).hostname ||
    !url.pathname.startsWith("/storage/v1/object/public/product-images/")
  ) continue;

  index += 1;
  const ext = path.extname(url.pathname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".img";
  const filename = `${String(index).padStart(5, "0")}${ext}`;
  const response = await fetch(url, { headers: { apikey: apiKey } });
  if (!response.ok) throw new Error(`Image download failed (HTTP ${response.status}): ${url.pathname}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(path.join(outputDir, filename), bytes);
  manifest.push({
    file: filename,
    original_url: rawUrl,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}

await fs.writeFile(
  path.join(outputDir, "manifest.json"),
  JSON.stringify({ created_at: new Date().toISOString(), count: manifest.length, files: manifest }, null, 2),
);

console.log(`Backed up ${manifest.length} product image files.`);
