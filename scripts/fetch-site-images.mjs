// Tanıtım sitesinin büyük fotoğraflarını (site/img/remote.json) indirir ve sha256 ile doğrular.
// Depoyu küçük tutmak için bu görseller git'te değil; Docker derlemesi bu betiği çalıştırır.
// İndirme başarısız olursa sayfa bozulmasın diye "fallback" görseli kopyalanır.
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../site/img");
const { files } = JSON.parse(await readFile(path.join(dir, "remote.json"), "utf8"));
let failed = 0;
for (const f of files) {
  const out = path.join(dir, f.name);
  try {
    const buf = await readFile(out).catch(() => null);
    if (buf && createHash("sha256").update(buf).digest("hex") === f.sha256) { console.log(`✓ ${f.name} (zaten var)`); continue; }
    const r = await fetch(f.url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = Buffer.from(await r.arrayBuffer());
    const sum = createHash("sha256").update(data).digest("hex");
    if (sum !== f.sha256) throw new Error(`sha256 uyuşmuyor (${sum})`);
    await writeFile(out, data);
    console.log(`✓ ${f.name} (${(data.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    failed++;
    console.warn(`! ${f.name} indirilemedi: ${e.message}; yerine ${f.fallback} kullanılıyor`);
    await access(path.join(dir, f.fallback)).then(() => copyFile(path.join(dir, f.fallback), out)).catch(() => {});
  }
}
if (failed) console.warn(`${failed} görsel yedekle değiştirildi.`);
