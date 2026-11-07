// Ofis / antet bilgileri (paftaların antet kutusunda kullanılır). Tarayıcı ve masaüstünde localStorage'da saklanır.
export interface OfficeInfo {
  office: string;
  architect: string;
  regNo: string;
  contact: string;
}
const KEY = "mimar-not.office";
export const EMPTY_OFFICE: OfficeInfo = { office: "", architect: "", regNo: "", contact: "" };

export function loadOffice(): OfficeInfo {
  try {
    return { ...EMPTY_OFFICE, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...EMPTY_OFFICE };
  }
}
export function saveOffice(o: OfficeInfo) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* yok say */ }
}
export function todayTR() {
  return new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
