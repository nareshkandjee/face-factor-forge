/**
 * Server functions for AI photo generation.
 * Calls OpenAI (text + image) on the server — OPENAI_API_KEY never reaches the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const OPENAI_API = "https://api.openai.com/v1";

// ---------- 1. Generate 12 prompts via GPT-5.4 mini ----------

const SYSTEM_PROMPT =
  "Tu es un directeur artistique expert en photos de profil pour applications de rencontres (Tinder, Hinge, Bumble). Génère 12 prompts de génération d'image en ANGLAIS, distincts et variés, optimisés pour séduire la cible décrite. Chaque prompt doit décrire UNE scène précise avec : lieu, lumière (golden hour, studio, néon, naturelle...), pose, expression, tenue cohérente avec le style indiqué, cadrage (close-up portrait, plan américain, plan large). Varie les scènes selon les types demandés. Varie les expressions (sourire franc, regard intense, rire naturel, expression réfléchie). Retourne UNIQUEMENT un JSON valide au format : {\"prompts\": [\"prompt1\", \"prompt2\", ...]} avec exactement 12 prompts en anglais.";

export const generatePrompts = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY manquante côté serveur.");

    // Load the submission to build the user prompt
    const { data: sub, error } = await supabaseAdmin
      .from("submissions")
      .select("*")
      .eq("id", data.submissionId)
      .single();
    if (error || !sub) throw new Error("Soumission introuvable.");

    const userPrompt = [
      `Genre: ${sub.gender ?? "non précisé"}`,
      `Cherche à séduire: ${sub.looking_for ?? "non précisé"}`,
      `Tranche d'âge cible: ${sub.age_min ?? "?"} - ${sub.age_max ?? "?"} ans`,
      `Styles likés: ${(sub.styles_liked ?? []).join(", ") || "aucun"}`,
      `Vibe désirée: ${sub.vibe ?? "non précisée"}`,
      `Style vestimentaire: ${sub.dress_style ?? "non précisé"}`,
      `Scènes souhaitées: ${(sub.scenes ?? []).join(", ") || "variées"}`,
      `Ville: ${sub.city ?? "non précisée"}`,
    ].join("\n");

    const res = await fetch(`${OPENAI_API}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[generatePrompts] OpenAI error:", res.status, text);
      let code: string | null = null;
      let message = `Erreur OpenAI (${res.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string; type?: string } };
        code = parsed.error?.code ?? parsed.error?.type ?? null;
        message = parsed.error?.message ?? message;
      } catch {
        /* not JSON */
      }
      if (res.status === 401) message = "Clé OpenAI invalide.";
      if (res.status === 429) message = "Quota OpenAI atteint — ajoute des crédits ou réessaie plus tard.";
      return { ok: false as const, prompts: [], httpStatus: res.status, code, message };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { prompts?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false as const, prompts: [], httpStatus: 500, code: "bad_json", message: "Réponse OpenAI mal formée." };
    }
    const prompts = Array.isArray(parsed.prompts)
      ? (parsed.prompts as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    if (prompts.length < 12) {
      return { ok: false as const, prompts: [], httpStatus: 500, code: "not_enough_prompts", message: `Seulement ${prompts.length} prompts générés.` };
    }

    return { ok: true as const, prompts: prompts.slice(0, 12) };
  });

// ---------- 2. Generate ONE image via Lovable AI (Gemini Nano Banana Pro) ----------

const LOVABLE_AI_API = "https://ai.gateway.lovable.dev/v1/chat/completions";
const IMAGE_MODEL_PRO = "google/gemini-3-pro-image-preview";
const IMAGE_MODEL_FLASH = "google/gemini-3.1-flash-image-preview";

type AttemptPlan = { model: string; timeoutMs: number; waitAfterMs: number };
const ATTEMPTS: AttemptPlan[] = [
  { model: IMAGE_MODEL_PRO, timeoutMs: 300_000, waitAfterMs: 3_000 },
  { model: IMAGE_MODEL_PRO, timeoutMs: 300_000, waitAfterMs: 5_000 },
  { model: IMAGE_MODEL_FLASH, timeoutMs: 120_000, waitAfterMs: 0 },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const IDENTITY_PREFIX = `IDENTITY LOCK — CRITICAL:

This is the EXACT SAME PERSON as in the reference images. The first reference image shows the primary identity to preserve.

PRESERVE EXACTLY (do not alter):
- Eye shape, eye color, eye spacing
- Nose bridge width and nose tip shape
- Lip shape and mouth width
- Jawline contour and chin shape
- Cheekbone height and face width
- Skin tone, skin texture, and ethnicity
- Hair color, hair texture, hairline
- Facial hair pattern if present
- Overall face geometry and proportions

The generated person MUST be immediately recognizable as the same individual from the reference images. Do not blend with other faces. Do not idealize features. Maintain authentic ethnic characteristics.

SCENE TO GENERATE:
`;

const IDENTITY_SUFFIX = `

NEGATIVE (avoid):
- Different person, face swap, altered facial structure
- Idealized European features replacing original ethnicity
- Plastic surgery appearance, over-smoothed skin
- Generic male model look, uncanny valley
- Distorted anatomy, unnatural proportions`;

export const generateImage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        submissionId: z.string().uuid(),
        prompt: z.string().min(1),
        index: z.number().int().min(0).max(11),
        referenceUrls: z.array(z.string().url()).min(1).max(14),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY manquante côté serveur.");

    // Download all reference photos and convert to base64 data URLs
    const referenceDataUrls: string[] = [];
    for (let i = 0; i < data.referenceUrls.length; i++) {
      const url = data.referenceUrls[i];
      const r = await fetch(url);
      if (!r.ok) {
        console.error(`[generateImage] Failed to fetch reference ${i}: ${url}`);
        continue;
      }
      const buf = new Uint8Array(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "image/jpeg";
      // Base64 encode
      let binary = "";
      for (let j = 0; j < buf.byteLength; j++) binary += String.fromCharCode(buf[j]!);
      const b64 = btoa(binary);
      referenceDataUrls.push(`data:${mime};base64,${b64}`);
    }
    if (referenceDataUrls.length === 0) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "no_references", message: "Impossible de récupérer les photos de référence." };
    }

    const fullPrompt = IDENTITY_PREFIX + data.prompt + IDENTITY_SUFFIX;
    const userContent: Array<Record<string, unknown>> = [
      { type: "text", text: fullPrompt },
      ...referenceDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
    ];
    const baseBody = {
      messages: [{ role: "user", content: userContent }],
      modalities: ["image", "text"],
    };
    const payloadKB = (JSON.stringify(baseBody).length / 1024).toFixed(1);
    const imgLabel = `${data.index + 1}/12`;

    let lastErr: {
      httpStatus: number;
      code: string | null;
      message: string;
      modelUsed: string;
    } = { httpStatus: 500, code: "unknown", message: "Aucune tentative.", modelUsed: IMAGE_MODEL_PRO };
    let imageUrl: string | undefined;
    let modelUsedFinal = IMAGE_MODEL_PRO;
    let fallbackTriggered = false;

    for (let attempt = 0; attempt < ATTEMPTS.length; attempt++) {
      const plan = ATTEMPTS[attempt]!;
      if (plan.model !== IMAGE_MODEL_PRO) fallbackTriggered = true;
      const startedAt = new Date();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), plan.timeoutMs);
      console.log(
        `[generateImage] image=${imgLabel} attempt=${attempt + 1}/${ATTEMPTS.length} model=${plan.model} timeoutMs=${plan.timeoutMs} payload=${payloadKB}KB start=${startedAt.toISOString()} fallback=${fallbackTriggered}`,
      );

      try {
        const res = await fetch(LOVABLE_AI_API, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: plan.model, ...baseBody }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const endedAt = new Date();
        const durationMs = endedAt.getTime() - startedAt.getTime();
        console.log(
          `[generateImage] image=${imgLabel} attempt=${attempt + 1} model=${plan.model} status=${res.status} duration=${durationMs}ms end=${endedAt.toISOString()}`,
        );

        if (!res.ok) {
          const text = await res.text();
          let code: string | null = null;
          let message = `Erreur Lovable AI (${res.status}).`;
          try {
            const parsed = JSON.parse(text) as { error?: { code?: string; message?: string; type?: string } };
            if (parsed.error) {
              code = parsed.error.code ?? parsed.error.type ?? null;
              if (parsed.error.message) message = parsed.error.message;
            }
          } catch { /* not JSON */ }
          if (res.status === 429) message = "Limite de débit Lovable AI atteinte, réessaie dans un instant.";
          if (res.status === 402) message = "Crédits Lovable AI épuisés — ajoute des crédits au workspace.";
          console.error(`[generateImage] image=${imgLabel} attempt=${attempt + 1} body=`, text.slice(0, 300));
          lastErr = { httpStatus: res.status, code, message, modelUsed: plan.model };

          const retriable = res.status === 504 || res.status === 503 || res.status === 502 || res.status === 408;
          if (retriable && attempt < ATTEMPTS.length - 1) {
            await sleep(plan.waitAfterMs);
            continue;
          }
          // Non-retriable (429, 402, 401, 400, etc.) → fail immediately
          return { ok: false as const, index: data.index, ...lastErr };
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
        };
        const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (!url || !url.startsWith("data:")) {
          console.error(`[generateImage] image=${imgLabel} no image in response`);
          lastErr = { httpStatus: 500, code: "no_image", message: "Pas d'image retournée par Gemini.", modelUsed: plan.model };
          if (attempt < ATTEMPTS.length - 1) { await sleep(plan.waitAfterMs); continue; }
          return { ok: false as const, index: data.index, ...lastErr };
        }
        imageUrl = url;
        modelUsedFinal = plan.model;
        break;
      } catch (e) {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt.getTime();
        const isAbort = e instanceof Error && e.name === "AbortError";
        console.error(
          `[generateImage] image=${imgLabel} attempt=${attempt + 1} model=${plan.model} ${isAbort ? "TIMEOUT" : "FETCH_ERROR"} after ${durationMs}ms:`,
          e instanceof Error ? e.message : e,
        );
        lastErr = {
          httpStatus: isAbort ? 504 : 500,
          code: isAbort ? "timeout" : "fetch_error",
          message: isAbort ? `Timeout après ${plan.timeoutMs / 1000}s sur ${plan.model}.` : "Erreur réseau Lovable AI.",
          modelUsed: plan.model,
        };
        if (attempt < ATTEMPTS.length - 1) { await sleep(plan.waitAfterMs); continue; }
        return { ok: false as const, index: data.index, ...lastErr };
      }
    }

    if (!imageUrl) {
      return { ok: false as const, index: data.index, ...lastErr };
    }

    // Parse data URL: data:image/png;base64,XXXX
    const match = /^data:([^;]+);base64,(.+)$/.exec(imageUrl);
    if (!match) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "bad_data_url", message: "Format d'image inattendu.", modelUsed: modelUsedFinal };
    }
    const contentType = match[1]!;
    const b64 = match[2]!;
    const ext = contentType.split("/")[1]?.split("+")[0] ?? "png";

    // Upload to Supabase Storage
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `${data.submissionId}/${data.index}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("generated_photos")
      .upload(path, bytes, { contentType, upsert: false });
    if (upErr) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "upload_failed", message: `Upload échoué: ${upErr.message}` };
    }

    const { data: pub } = supabaseAdmin.storage.from("generated_photos").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    // Append URL to submissions.generated_photos_urls
    const { data: cur } = await supabaseAdmin
      .from("submissions")
      .select("generated_photos_urls")
      .eq("id", data.submissionId)
      .single();
    const next = [...(cur?.generated_photos_urls ?? []), publicUrl];
    await supabaseAdmin
      .from("submissions")
      .update({ generated_photos_urls: next })
      .eq("id", data.submissionId);

    return { ok: true as const, url: publicUrl, index: data.index, modelUsed: modelUsedFinal };
  });

// ---------- 3. Mark submission complete ----------

export const markSubmissionComplete = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin
      .from("submissions")
      .update({ status: "completed" })
      .eq("id", data.submissionId);
    return { ok: true };
  });

// ---------- 4. Load a submission (for results page hydration) ----------

export const getSubmission = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: sub, error } = await supabaseAdmin
      .from("submissions")
      .select("*")
      .eq("id", data.submissionId)
      .single();
    if (error || !sub) throw new Error("Soumission introuvable.");
    return { submission: sub };
  });
