// Claude çağrısı: masaüstü sunucusu (Express) ve sunucusuz sürümler (web paneli, Android) aynı kodu kullanır.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ProgramWireSchema, normalizeProgram, type Program, type ProgramWire } from "./schema";
import { repairProgram } from "../geometry/blocks";
import { SYSTEM_PROMPT } from "./prompt";

export const DEFAULT_MODEL = "claude-opus-5-5";
const TOOL_NAME = "bina_programi";
const { $schema: _s, ...WIRE_JSON_SCHEMA } = z.toJSONSchema(ProgramWireSchema) as Record<string, unknown> & { type: "object" };
/** API yapılandırılmış çıktı gramerini bir kez reddederse sonraki isteklerde doğrudan araç şemalı moda geçilir */
let strictRejected = false;

export interface GenerateRequest {
  notes?: string;
  previous?: Program;
  revision?: string;
  brief?: Record<string, unknown>;
  images?: { mediaType: string; data: string }[];
}
export interface GenerateResult {
  program: Program;
  warnings: string[];
  raw: unknown;
  usage?: unknown;
  model?: string;
}
export class GenerateError extends Error {
  constructor(public status: number, message: string, public raw?: unknown) {
    super(message);
  }
}

export function buildUserContent(body: GenerateRequest): Anthropic.Beta.BetaContentBlockParam[] {
  const notes = String(body.notes ?? "").trim();
  const revision = String(body.revision ?? "").trim();
  const { previous, brief } = body;
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 6).filter((im) => /^image\/(jpeg|png|webp|gif)$/.test(im?.mediaType) && typeof im.data === "string");
  if (revision && !previous) throw new GenerateError(400, "Düzeltme için önce bir proje üretilmiş olmalı.");
  if (!revision && notes.length < 10 && !(brief && Object.keys(brief).length) && !images.length)
    throw new GenerateError(400, "Not çok kısa. Müşterinin isteklerini yazın ya da bir görsel (eskiz, referans, imar durumu) ekleyin.");
  const briefText = brief && Object.keys(brief).length
    ? `\n\nMimarın formda seçtiği kesin değerler (notlarla çelişirse bunlar geçerlidir):\n${Object.entries(brief).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
    : "";
  const imgText = images.length
    ? `\n\nEkte ${images.length} görsel var (sırayla Görsel 1${images.length > 1 ? `…${images.length}` : ""}). Her birinin ne olduğunu belirle (cephe referansı, plan eskizi, el yazısı not, imar belgesi…) ve sistem talimatındaki kurallara göre programa yansıt; ne okuduğunu "imageReadings" alanına yaz. Cephe referansıysa "facade" renkleri ve biçimleri görseldekiyle aynı olsun.`
    : "";
  const notesText = notes || "(Not yazılmadı; programı ekteki görsellerden ve formdan çıkar.)";
  let text: string;
  if (revision) {
    text = `Mevcut bina programı (JSON):\n${JSON.stringify(previous)}\n\nMimarın düzeltme isteği:\n<duzeltme>\n${revision}\n</duzeltme>${imgText}\n\nYalnızca istenen değişikliği uygula. İstekle ilgisi olmayan her şeyi (oda adları, alanlar, katlar, imar değerleri, varsayımlar) aynen koru. Değişikliğin yan etkisi varsa (ör. oturum alanı büyümeli) onu da düzelt ve "assumptions" listesine kısa bir not ekle. "requirements" listesini güncelle: düzeltilen maddelerin durumunu yeniden değerlendir.`;
  } else if (previous) {
    text = `Mevcut bina programı (JSON):\n${JSON.stringify(previous)}\n\nMimarın yeni/ek notları — programı bunlara göre güncelle:\n<notlar>\n${notesText}\n</notlar>${briefText}${imgText}`;
  } else {
    text = `Müşteri görüşmesinde alınan mimar notları:\n<notlar>\n${notesText}\n</notlar>${briefText}${imgText}`;
  }
  return [
    ...images.flatMap((im, i) => [
      { type: "text" as const, text: `Görsel ${i + 1}:` },
      { type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType as "image/jpeg", data: im.data } },
    ]),
    { type: "text", text },
  ];
}

/** Claude'dan bina programı ister. Hata durumunda GenerateError fırlatır; iptal edilirse null döner. */
export async function generateWithClaude(client: Anthropic, body: GenerateRequest, opts: { model?: string; signal?: AbortSignal } = {}): Promise<GenerateResult | null> {
  const model = opts.model ?? DEFAULT_MODEL;
  const userContent = buildUserContent(body);
  let forceTool = true;
  const call = async (strict: boolean) => {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: strict ? { effort: "medium", format: betaZodOutputFormat(ProgramWireSchema) } : { effort: "medium" },
        system: strict ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\nProgramı ${TOOL_NAME} aracını çağırarak ver; ayrıca metin yazma.`,
        ...(strict
          ? {}
          : {
              tools: [{ name: TOOL_NAME, description: "Çıkardığın bina programını bu araçla ver. Şemadaki tüm alanları doldur.", input_schema: WIRE_JSON_SCHEMA }],
              tool_choice: forceTool ? { type: "tool" as const, name: TOOL_NAME } : { type: "auto" as const },
            }),
        messages: [{ role: "user", content: userContent }],
      },
      { signal: opts.signal },
    );
    return stream.finalMessage().catch((e) => {
      if (opts.signal?.aborted) return null;
      throw e;
    });
  };
  try {
    let strict = !strictRejected;
    const msg = await call(strict)
      .catch((e) => {
        // Gramer sınırı aşılırsa araç şemalı moda geç
        if (strict && e instanceof Anthropic.BadRequestError && /grammar|schema/i.test(e.message)) { strict = false; strictRejected = true; return call(false); }
        throw e;
      })
      .catch((e) => {
        // Zorunlu araç seçimi kabul edilmezse serbest seçimle tekrar dene
        if (!strict && forceTool && e instanceof Anthropic.BadRequestError && /tool_choice|thinking/i.test(e.message)) { forceTool = false; return call(false); }
        throw e;
      });
    if (!msg) return null;
    if (msg.stop_reason === "refusal") throw new GenerateError(422, "Model bu isteği işlemedi. Notları gözden geçirip tekrar deneyin.");
    if (msg.stop_reason === "max_tokens") throw new GenerateError(502, "Yanıt yarıda kesildi. Notları kısaltıp tekrar deneyin.");
    let wire: ProgramWire | null = null;
    let raw: unknown = null;
    let parseError = "";
    if (strict) {
      wire = (msg.parsed_output as ProgramWire | null) ?? null;
      raw = wire;
    } else {
      const tu = msg.content.find((c) => c.type === "tool_use");
      raw = tu && "input" in tu ? tu.input : msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      if (raw && typeof raw === "object") {
        const r = ProgramWireSchema.safeParse(fillDefaults(structuredClone(raw)));
        if (r.success) wire = r.data;
        else parseError = r.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      }
    }
    if (!wire && parseError) throw new GenerateError(502, `Claude'un yanıtı bina programı şemasına uymadı (${parseError}). Tekrar deneyin.`, raw);
    if (!wire) throw new GenerateError(502, "Modelden geçerli bir bina programı alınamadı.", raw);
    const fixed = sanitize(normalizeProgram(wire));
    const warnings = repairProgram(fixed);
    return { program: fixed, warnings, raw, usage: msg.usage, model: msg.model };
  } catch (err) {
    if (err instanceof GenerateError) throw err;
    if (err instanceof Anthropic.AuthenticationError || (err instanceof Anthropic.AnthropicError && /authentication/i.test(err.message)))
      throw new GenerateError(401, "Claude API anahtarı geçersiz. Anahtarı kontrol edin.");
    if (err instanceof Anthropic.RateLimitError) throw new GenerateError(429, "API hız sınırına takıldı, biraz sonra tekrar deneyin.");
    if (err instanceof Anthropic.APIConnectionError) throw new GenerateError(503, "Claude API'ye bağlanılamadı. İnternet bağlantınızı kontrol edin.");
    if (err instanceof Anthropic.APIError) throw new GenerateError(502, `Claude API hatası (${err.status}): ${err.message}`);
    throw new GenerateError(500, "Hata: " + (err as Error).message);
  }
}

/** Talimatlı modda eksik bırakılabilecek alanları doldurur (şema doğrulamasından önce). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillDefaults(o: any) {
  if (!o || typeof o !== "object") return o;
  const room = (r: any) => ({ note: "", ...r });
  o.blockSpacing ??= null;
  o.adjacencies ??= [];
  o.assumptions ??= [];
  o.openQuestions ??= [];
  o.requirements ??= [];
  o.imageReadings ??= [];
  o.facade = { wallColor: "", accentColor: "", frameColor: "", roofColor: "", windowStyle: "kare", accentPlacement: "zemin", balconyRail: "metal", shutters: false, cornice: false, ...(o.facade ?? {}) };
  if (Array.isArray(o.requirements)) o.requirements = o.requirements.map((r: any) => (typeof r === "string" ? { text: r, source: "not", status: "kismen", how: "" } : { source: "not", status: "kismen", how: "", ...r }));
  if (Array.isArray(o.floors)) o.floors = o.floors.map((f: any) => ({ ...f, rooms: (f?.rooms ?? []).map(room) }));
  if (Array.isArray(o.unitTypes)) o.unitTypes = o.unitTypes.map((u: any) => ({ duplex: false, ...u, rooms: (u?.rooms ?? []).map((r: any) => ({ upper: false, ...room(r) })) }));
  if (Array.isArray(o.blocks)) o.blocks = o.blocks.map((b: any) => ({ sameAs: "", ...b, floors: (b?.floors ?? []).map((f: any) => ({ units: [], ...f, rooms: (f?.rooms ?? []).map(room) })) }));
  if (Array.isArray(o.adjacencies)) o.adjacencies = o.adjacencies.map((a: any) => ({ reason: "", ...a }));
  return o;
}

// Modelden gelen sayıları makul aralıklara çeker.
function sanitize(p: Program): Program {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  p.floorHeight = clamp(p.floorHeight, 2.6, 6);
  p.footprint.width = clamp(p.footprint.width, 4, 120);
  p.footprint.depth = clamp(p.footprint.depth, 4, 80);
  p.site.width = Math.max(p.site.width || 0, p.footprint.width + 6);
  p.site.depth = Math.max(p.site.depth || 0, p.footprint.depth + 6);
  p.adjacencies = Array.isArray(p.adjacencies) ? p.adjacencies.slice(0, 12) : [];
  p.requirements = Array.isArray(p.requirements) ? p.requirements.slice(0, 60) : [];
  p.unitTypes = Array.isArray(p.unitTypes) ? p.unitTypes.map((u) => ({ ...u, rooms: u.rooms.map((r) => ({ ...r, area: clamp(r.area, 1, 300) })) })) : [];
  p.blocks = Array.isArray(p.blocks) ? p.blocks.slice(0, 12).map((b) => ({
    ...b,
    footprint: { width: clamp(b.footprint.width, 6, 120), depth: clamp(b.footprint.depth, 6, 80) },
    floors: b.floors.map((f) => ({ ...f, level: Math.round(f.level), units: (f.units ?? []).slice(0, 12) })).sort((a, c) => a.level - c.level),
  })) : [];
  if (p.blocks.length) {
    p.footprint = { ...p.blocks[0].footprint };
    p.adjacencies = [];
  }
  p.floors = p.floors
    .filter((f) => f.rooms.length > 0)
    .map((f) => ({ ...f, level: Math.round(f.level), rooms: f.rooms.map((r) => ({ ...r, area: clamp(r.area, 1, 500) })) }))
    .sort((a, b) => a.level - b.level);
  return p;
}
