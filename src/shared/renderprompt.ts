// Gerçekçi render için görüntü modeli talimatını (prompt) Claude yazar: 3D görünümün ekran görüntüsüne,
// kamera bilgisine ve bina programına bakıp o açıdaki binayı ayrıntılı tarif eden İngilizce bir talimat üretir.
// Claude'a ulaşılamazsa şablon talimat (renderPrompt) kullanılır; render yine de çalışır.
import type Anthropic from "@anthropic-ai/sdk";
import type { Program } from "./schema";
import { DEFAULT_MODEL } from "./generate";
import { cameraText, renderPrompt, type CameraInfo } from "./render";

export interface PromptInput {
  view: string;
  refs?: string[];
  program: Program;
  camera?: CameraInfo;
  extra?: string;
  modelId?: string;
}
export interface PromptResult { prompt: string; source: "claude" | "template"; usage?: unknown; model?: string }

const SYSTEM = `You are an expert architectural visualiser who writes prompts for AI image-editing models (Qwen Image Edit, Grok Imagine, Ideogram).
The first image is a screenshot of a simple 3D massing model of a building from an architect's design app. The image model will receive this screenshot as its input image and must turn it into a photorealistic architectural photograph.
The architect's top priority: the photograph must be taken from EXACTLY the same camera position, angle, height, lens and framing as the screenshot, and the building must keep exactly the same geometry. Beautiful but faithful.

Write ONE prompt in English that:
1. Opens with a direct edit instruction: convert this 3D model render into a photorealistic photograph, keeping the identical camera viewpoint, perspective, framing and composition (the building occupies the same area of the frame).
2. States the camera precisely, using the camera data given (eye-level / elevated / aerial, height, looking direction, lens in mm, which facades are seen and where they are in the frame). Do not invent a different angle.
3. Describes the building exactly as visible in the screenshot: number of storeys above ground, roof type, how many window openings per visible facade and per floor (count them in the image), doors and entrance, balconies/terraces and railings, setbacks, overhangs, chimneys, multiple blocks if any. Say explicitly: do not add or remove floors, windows, balconies, wings or roof elements.
4. Maps the model's flat colours to real materials and colours using the program data (render/plaster, stone, brick, timber, concrete, window frame colour, roof covering). If reference photos are attached after the first image, take materials, colours and mood from them but never their geometry.
5. Describes surroundings consistent with what is in the screenshot (ground, paths, trees, plot edges), upgraded to real landscaping; keep empty areas plausible and simple. Mediterranean Turkey context unless the notes say otherwise.
6. Lighting and photographic quality: natural daylight matching the shadows in the screenshot unless the architect asks otherwise, real glass reflections with interior depth, subtle weathering, sharp, high dynamic range, professional architectural photography, vertical lines kept straight.
7. Includes the architect's extra wishes (they may be written in Turkish — translate them faithfully). If a wish conflicts with the camera or geometry, keep the camera and geometry.
8. Ends with: no text, no watermark, no people blocking the facade, no CGI or plastic look, no distorted geometry.

Output only the prompt text as one paragraph, without quotes, headings, markdown or commentary. Maximum 1600 characters.`;

const INTERIOR_SYSTEM = `You are an expert interior design visualiser who writes prompts for AI image-editing models (Qwen Image Edit, Grok Imagine, Ideogram).
The first image is a screenshot taken INSIDE a simple 3D model of a room from an architect's design app (first-person walkthrough). The image model will receive this screenshot as its input image and must turn it into a photorealistic interior photograph.
Top priority: EXACTLY the same camera position, angle, height, lens and framing; the same walls, openings and the same furniture pieces in the same places. Beautiful but faithful.

Write ONE prompt in English that:
1. Opens with a direct edit instruction: convert this 3D interior render into a photorealistic interior photograph, keeping the identical camera viewpoint, perspective, framing and composition.
2. States the camera using the camera data given (eye-level, height, looking direction, lens).
3. Describes the room as visible: room type, walls, windows and doors in view, ceiling lights, and every furniture piece in view with its place in the frame. Say explicitly: do not add or remove furniture, walls, windows or doors.
4. Maps the model's flat colours to real materials using the interior style given (wood species and tone, upholstery fabric and colour, worktop stone, flooring, wall paint, metal finish). If reference photos follow the first image, take materials, colours and mood from them but never their geometry.
5. Lighting: natural daylight from the visible windows balanced with warm artificial light from the fixtures in the model; soft realistic shadows.
6. Adds only small styling accessories (cushions, books, a vase, a plant) that do not change the layout.
7. Includes the architect's extra wishes (they may be written in Turkish — translate them faithfully). If a wish conflicts with the camera or layout, keep the camera and layout.
8. Ends with: no text, no watermark, no people, no CGI or plastic look, no distorted geometry.

Output only the prompt text as one paragraph, without quotes, headings, markdown or commentary. Maximum 1600 characters.`;

function programSummary(p: Program) {
  const blocks = p.blocks ?? [];
  const sel = blocks[p.blockIndex ?? 0];
  const floors = (sel?.floors?.length ? sel.floors : p.floors).map((f) => ({ name: f.name, level: f.level, rooms: f.rooms?.length }));
  return {
    buildingType: p.buildingType,
    style: p.style,
    roof: p.roof,
    materials: p.materials,
    facade: p.facade,
    massing: p.design?.massing ?? p.massing,
    floors,
    blocks: blocks.length ? blocks.map((b) => ({ name: b.name, floors: b.floors?.length ?? 0, sameAs: b.sameAs })) : undefined,
    site: p.site,
  };
}

/** Görüntü modeli için talimatı Claude'a yazdırır; olmazsa şablona döner. */
export async function writeRenderPrompt(client: Anthropic | null, inp: PromptInput, opts: { model?: string; signal?: AbortSignal } = {}): Promise<PromptResult> {
  const refCount = inp.refs?.length ?? 0;
  const fallback = (): PromptResult => ({ prompt: renderPrompt(inp.program, inp.extra ?? "", refCount, inp.camera), source: "template" });
  if (!client) return fallback();
  const img = (d: string) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(d);
    return m ? { type: "image" as const, source: { type: "base64" as const, media_type: m[1] as "image/jpeg", data: m[2] } } : null;
  };
  const view = img(inp.view);
  if (!view) return fallback();
  const refs = (inp.refs ?? []).slice(0, 3).map(img).filter((x): x is NonNullable<typeof x> => !!x);
  const text = [
    `Camera data from the 3D app (authoritative): ${inp.camera ? cameraText(inp.camera) : "not available; infer it from the screenshot"}`,
    inp.camera?.interior
      ? `Room: ${inp.camera.interior.room} (type ${inp.camera.interior.roomType}); interior style: ${inp.camera.interior.style}; furniture in the room: ${inp.camera.interior.furniture.join(", ") || "none"}.`
      : `Building program (JSON, Turkish values): ${JSON.stringify(programSummary(inp.program))}`,
    refs.length ? `${refs.length} reference photo(s) from the architect follow the screenshot (materials and mood only).` : "No reference photos.",
    `Target image model: ${inp.modelId ?? "qwen"}.`,
    `Architect's extra wishes: ${inp.extra?.trim() ? inp.extra.trim() : "(none)"}`,
    `For reference, the app's generic template prompt (improve on it, be specific to what you see): ${renderPrompt(inp.program, "", refs.length, inp.camera)}`,
  ].join("\n\n");
  try {
    const msg = await client.beta.messages
      .stream(
        {
          model: opts.model ?? DEFAULT_MODEL,
          max_tokens: 4000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system: inp.camera?.interior ? INTERIOR_SYSTEM : SYSTEM,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: inp.camera?.interior ? "Screenshot from inside the 3D model (the input image for the image model):" : "Screenshot of the 3D model (the input image for the image model):" },
              view,
              ...refs.flatMap((r, i) => [{ type: "text" as const, text: `Reference photo ${i + 1}:` }, r]),
              { type: "text", text },
            ],
          }],
        },
        { signal: opts.signal },
      )
      .finalMessage();
    const out = (msg.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" ").replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
    if (out.length < 80 || msg.stop_reason === "refusal") return fallback();
    return { prompt: out.slice(0, 1900), source: "claude", usage: msg.usage, model: msg.model };
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("İptal", "AbortError");
    return fallback();
  }
}
