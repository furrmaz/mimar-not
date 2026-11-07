// Asgari mahal ölçüleri ön kontrolü (Planlı Alanlar İmar Yönetmeliği md. 29 esas alınarak sadeleştirilmiş).
import type { BuildingLayout, PlacedRoom } from "./layout";

export interface RoomIssue {
  floor: string;
  roomId: string;
  room: string;
  message: string;
  /** true: yönetmelik değil, programdan sapma */
  soft?: boolean;
}

interface Rule { area?: number; side?: number; label: string }
const RULES: Partial<Record<PlacedRoom["type"], Rule>> = {
  salon: { area: 12, side: 3.0, label: "Oturma odası" },
  ebeveyn: { area: 9, side: 2.5, label: "Yatak odası" },
  yatak: { area: 9, side: 2.5, label: "Yatak odası" },
  cocuk: { area: 9, side: 2.5, label: "Yatak odası" },
  misafir: { area: 9, side: 2.5, label: "Yatak odası" },
  calisma: { area: 7, side: 2.2, label: "Diğer oda" },
  mutfak: { area: 5, side: 1.5, label: "Mutfak" },
  banyo: { area: 3, side: 1.5, label: "Banyo" },
  wc: { area: 1.2, side: 0.9, label: "WC" },
  hol: { side: 1.1, label: "Hol / koridor" },
  koridor: { side: 1.1, label: "Hol / koridor" },
  antre: { side: 1.1, label: "Giriş holü" },
};

const f = (v: number) => v.toFixed(2).replace(".", ",");

export function roomChecks(L: BuildingLayout): RoomIssue[] {
  const out: RoomIssue[] = [];
  for (const fl of L.floors)
    for (const r of fl.rooms) {
      const rule = RULES[r.type];
      const area = r.rect.w * r.rect.h;
      const side = Math.min(r.rect.w, r.rect.h);
      if (rule?.area && area < rule.area - 0.05)
        out.push({ floor: fl.name, roomId: r.id, room: r.name, message: `${rule.label} en az ${f(rule.area)} m² olmalı; planda ${f(area)} m².` });
      if (rule?.side && side < rule.side - 0.01)
        out.push({ floor: fl.name, roomId: r.id, room: r.name, message: `${rule.label} dar kenarı en az ${f(rule.side)} m olmalı; planda ${f(side)} m.` });
      if (r.type !== "merdiven" && r.requestedArea > 0 && area < r.requestedArea * 0.8)
        out.push({ floor: fl.name, roomId: r.id, room: r.name, soft: true, message: `Müşterinin istediği ${f(r.requestedArea)} m², planda ${f(area)} m² kaldı.` });
    }
  return out;
}

export interface AreaRow { floor: string; net: number; gross: number; outdoor: number; rooms: number }
export function areaTable(L: BuildingLayout) {
  const rows: AreaRow[] = L.floors.map((fl) => ({
    floor: fl.name,
    net: fl.rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0),
    gross: (L.W + L.extWall) * (L.D + L.extWall),
    outdoor: fl.outdoor.reduce((s, o) => s + o.area, 0),
    rooms: fl.rooms.filter((r) => r.band !== "hall" && r.type !== "merdiven").length,
  }));
  const total = rows.reduce((t, r) => ({ floor: "Toplam", net: t.net + r.net, gross: t.gross + r.gross, outdoor: t.outdoor + r.outdoor, rooms: t.rooms + r.rooms }), { floor: "Toplam", net: 0, gross: 0, outdoor: 0, rooms: 0 });
  return { rows, total };
}
