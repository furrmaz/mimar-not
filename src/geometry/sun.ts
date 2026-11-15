// Güneş konumu (yaklaşık, ön tasarım için): enlem, ay ve saate göre yükseklik ve azimut.
export type Facing = "G" | "K" | "D" | "B";
const BEARING: Record<Facing, number> = { K: 0, D: 90, G: 180, B: 270 };
export const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const FACING_NAMES: Record<Facing, string> = { G: "Güney", K: "Kuzey", D: "Doğu", B: "Batı" };
const rad = (d: number) => (d * Math.PI) / 180;

/** Güneşin yüksekliği (°) ve güneyden batıya doğru azimutu (°). Saat: yerel güneş saati. */
export function sunAngles(month: number, hour: number, lat = 39) {
  const n = Math.round((month - 0.5) * 30.4);
  const decl = rad(23.44) * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const h = rad(15 * (hour - 12));
  const phi = rad(lat);
  const sinA = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinA)));
  const az = Math.atan2(Math.cos(decl) * Math.sin(h), Math.cos(h) * Math.cos(decl) * Math.sin(phi) - Math.sin(decl) * Math.cos(phi));
  return { altitude: (alt * 180) / Math.PI, azimuth: (az * 180) / Math.PI };
}

/**
 * Sahne koordinatında güneşe doğru birim vektör [x, y, z]. Sahne: +z arka (bahçe) cephe, y yukarı;
 * sokaktan bahçeye bakarken sağ taraf −x. facing: bahçe cephesinin baktığı yön.
 */
export function sunVector(month: number, hour: number, facing: Facing, lat = 39): [number, number, number] {
  const { altitude, azimuth } = sunAngles(month, hour, lat);
  const a = rad(Math.max(2, altitude));
  const bearing = 180 + azimuth; // pusula açısı (kuzeyden saat yönünde)
  const t = rad(bearing - BEARING[facing]);
  return [-Math.sin(t) * Math.cos(a), Math.sin(a), Math.cos(t) * Math.cos(a)];
}

/** Arsa yön metninden bahçe cephesinin yönü (bulunamazsa güney). */
export function facingFromText(text: string | undefined): Facing {
  const t = (text ?? "").toLocaleLowerCase("tr");
  const m = /(güney|kuzey|doğu|batı)[^.;,]*?(bahçe|arka)|(bahçe|arka)[^.;,]*?(güney|kuzey|doğu|batı)/.exec(t);
  const w = m ? m[1] ?? m[4] : /sokak|yol|ön cephe/.test(t) ? undefined : /(güney|kuzey|doğu|batı)/.exec(t)?.[1];
  return w === "kuzey" ? "K" : w === "doğu" ? "D" : w === "batı" ? "B" : "G";
}
