/**
 * Server functions for AI photo generation.
 * - generatePrompts: OpenAI (text)
 * - trainPersonalModel: Fal.ai Flux LoRA portrait trainer
 * - generateImage: Fal.ai Flux LoRA inference with personal LoRA
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fal } from "@fal-ai/client";
import JSZip from "jszip";

const OPENAI_API = "https://api.openai.com/v1";

// Photo count configuration
export const TEST_MODE_PHOTO_COUNT = 3;
export const PRODUCTION_PHOTO_COUNT = 12;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- 1. Generate N prompts via GPT ----------

const buildSystemPrompt = (count: number) =>
  count <= 3
    ? `Tu es un directeur artistique expert en photos de profil pour applications de rencontres (Tinder, Hinge, Bumble). Génère ${count} prompts de génération d'image en ANGLAIS, MAXIMALEMENT DIFFÉRENTS les uns des autres, optimisés pour séduire la cible décrite. Choisis les ${count} scènes les plus contrastées pour montrer la diversité : 1 portrait close-up (cadrage serré, visage), 1 plan américain en activité (sport, hobby, voyage), 1 plan large lifestyle (scène ambiance, lieu emblématique). Chaque prompt décrit UNE scène précise avec lieu, lumière, pose, expression, tenue, cadrage. Varie les expressions. Retourne UNIQUEMENT un JSON valide au format : {"prompts": ["prompt1", ...]} avec exactement ${count} prompts en anglais.`
    : `Tu es un directeur artistique expert en photos de profil pour applications de rencontres (Tinder, Hinge, Bumble). Génère ${count} prompts de génération d'image en ANGLAIS, distincts et variés, optimisés pour séduire la cible décrite. Chaque prompt doit décrire UNE scène précise avec : lieu, lumière (golden hour, studio, néon, naturelle...), pose, expression, tenue cohérente avec le style indiqué, cadrage (close-up portrait, plan américain, plan large). Varie les scènes selon les types demandés. Varie les expressions (sourire franc, regard intense, rire naturel, expression réfléchie). Retourne UNIQUEMENT un JSON valide au format : {"prompts": ["prompt1", "prompt2", ...]} avec exactement ${count} prompts en anglais.`;

export const generatePrompts = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        submissionId: z.string().uuid(),
        count: z.number().int().min(1).max(12).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY manquante côté serveur.");
    const count = data.count ?? PRODUCTION_PHOTO_COUNT;
    const systemPrompt = buildSystemPrompt(count);

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
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
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
      } catch { /* not JSON */ }
      if (res.status === 401) message = "Clé OpenAI invalide.";
      if (res.status === 429) message = "Quota OpenAI atteint — ajoute des crédits ou réessaie plus tard.";
      return { ok: false as const, prompts: [], httpStatus: res.status, code, message };
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { prompts?: unknown };
    try { parsed = JSON.parse(content); } catch {
      return { ok: false as const, prompts: [], httpStatus: 500, code: "bad_json", message: "Réponse OpenAI mal formée." };
    }
    const prompts = Array.isArray(parsed.prompts)
      ? (parsed.prompts as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    if (prompts.length < count) {
      return { ok: false as const, prompts: [], httpStatus: 500, code: "not_enough_prompts", message: `Seulement ${prompts.length} prompts générés.` };
    }
    return { ok: true as const, prompts: prompts.slice(0, count) };
  });

// ---------- 2. Train a personal LoRA via Fal.ai ----------

function configureFal() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY manquante côté serveur.");
  fal.config({ credentials: key });
}

export const trainPersonalModel = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    try {
      configureFal();

      const { data: sub, error } = await supabaseAdmin
        .from("submissions")
        .select("*")
        .eq("id", data.submissionId)
        .single();
      if (error || !sub) throw new Error("Soumission introuvable.");

      // Skip if already trained
      if (sub.lora_url && sub.trigger_word) {
        console.log(`[trainPersonalModel] already trained for ${data.submissionId}`);
        return { ok: true as const, loraUrl: sub.lora_url, triggerWord: sub.trigger_word, cached: true };
      }

      const photoUrls = (sub.photos_urls ?? []) as string[];
      if (photoUrls.length < 10) {
        return { ok: false as const, message: `Pas assez de photos (${photoUrls.length}/10 min).` };
      }

      // Build ZIP of reference photos
      console.log(`[trainPersonalModel] downloading ${photoUrls.length} photos…`);
      const zip = new JSZip();
      for (let i = 0; i < photoUrls.length; i++) {
        const r = await fetch(photoUrls[i]!);
        if (!r.ok) {
          console.error(`[trainPersonalModel] failed to fetch photo ${i}`);
          continue;
        }
        const buf = new Uint8Array(await r.arrayBuffer());
        const ext = (r.headers.get("content-type") ?? "image/jpeg").split("/")[1]?.split("+")[0] ?? "jpg";
        zip.file(`photo_${String(i).padStart(2, "0")}.${ext}`, buf);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipFile = new File([zipBlob], "training.zip", { type: "application/zip" });

      console.log(`[trainPersonalModel] uploading ZIP to Fal storage…`);
      const zipUrl = await fal.storage.upload(zipFile);

      const triggerWord = `matchshot_user_${data.submissionId.slice(0, 8).replace(/-/g, "")}`;
      console.log(`[trainPersonalModel] starting training, trigger=${triggerWord}`);

      const startedAt = Date.now();
      const result = await fal.subscribe("fal-ai/flux-lora-portrait-trainer", {
        input: {
          images_data_url: zipUrl,
          trigger_phrase: triggerWord,
          steps: 1000,
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            console.log(`[trainPersonalModel] in progress (${Math.round((Date.now() - startedAt) / 1000)}s)`);
          }
        },
      });

      const out = result.data as { diffusers_lora_file?: { url?: string }; lora_file?: { url?: string } };
      const loraUrl = out.diffusers_lora_file?.url ?? out.lora_file?.url;
      if (!loraUrl) {
        console.error(`[trainPersonalModel] no lora url in response`, result);
        return { ok: false as const, message: "Pas d'URL LoRA retournée par Fal.ai." };
      }

      await supabaseAdmin
        .from("submissions")
        .update({ lora_url: loraUrl, trigger_word: triggerWord })
        .eq("id", data.submissionId);

      console.log(`[trainPersonalModel] done in ${Math.round((Date.now() - startedAt) / 1000)}s → ${loraUrl}`);
      return { ok: true as const, loraUrl, triggerWord, cached: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur training LoRA.";
      console.error("[trainPersonalModel] failed:", msg);
      return { ok: false as const, message: msg };
    }
  });

// ---------- 3. Generate ONE image via Fal.ai Flux LoRA ----------

export const generateImage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        submissionId: z.string().uuid(),
        prompt: z.string().min(1),
        index: z.number().int().min(0).max(11),
        loraUrl: z.string().url(),
        triggerWord: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      configureFal();
    } catch (e) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "no_fal_key", message: e instanceof Error ? e.message : "FAL_KEY manquante." };
    }

    const fullPrompt = `${data.triggerWord} person, ${data.prompt}, photorealistic, natural skin texture, candid photo`;
    const imgLabel = `${data.index + 1}`;

    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 90_000;

    let lastErr: { httpStatus: number; code: string; message: string } = {
      httpStatus: 500, code: "unknown", message: "Aucune tentative.",
    };
    let outputUrl: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      console.log(`[generateImage] image=${imgLabel} attempt=${attempt}/${MAX_ATTEMPTS} model=fal-ai/flux-lora start`);
      try {
        const result = await Promise.race([
          fal.subscribe("fal-ai/flux-lora", {
            input: {
              prompt: fullPrompt,
              loras: [{ path: data.loraUrl, scale: 1.0 }],
              image_size: "portrait_4_3",
              num_inference_steps: 28,
              guidance_scale: 3.5,
              num_images: 1,
              enable_safety_checker: true,
            },
            logs: false,
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
        ]);

        const out = result.data as { images?: Array<{ url?: string }> };
        const url = out.images?.[0]?.url;
        const durationMs = Date.now() - startedAt;
        console.log(`[generateImage] image=${imgLabel} attempt=${attempt} done in ${durationMs}ms url=${url ? "ok" : "MISSING"}`);

        if (!url) {
          lastErr = { httpStatus: 500, code: "no_image", message: "Pas d'image retournée par Flux." };
          if (attempt < MAX_ATTEMPTS) { await sleep(3000); continue; }
          return { ok: false as const, index: data.index, ...lastErr };
        }
        outputUrl = url;
        break;
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[generateImage] image=${imgLabel} attempt=${attempt} FAILED after ${durationMs}ms:`, msg);
        lastErr = { httpStatus: msg === "timeout" ? 504 : 500, code: msg === "timeout" ? "timeout" : "fal_error", message: msg };
        if (attempt < MAX_ATTEMPTS) { await sleep(3000); continue; }
        return { ok: false as const, index: data.index, ...lastErr };
      }
    }

    if (!outputUrl) return { ok: false as const, index: data.index, ...lastErr };

    // Download the image from Fal and re-upload to Supabase Storage for stable hosting
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "download_failed", message: "Impossible de télécharger l'image générée." };
    }
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.split("/")[1]?.split("+")[0] ?? "jpg";
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const path = `${data.submissionId}/${data.index}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("generated_photos")
      .upload(path, bytes, { contentType, upsert: false });
    if (upErr) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "upload_failed", message: `Upload échoué: ${upErr.message}` };
    }
    const { data: pub } = supabaseAdmin.storage.from("generated_photos").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

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

    return { ok: true as const, url: publicUrl, index: data.index, modelUsed: "fal-ai/flux-lora" };
  });

// ---------- 4. Mark submission complete ----------

export const markSubmissionComplete = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await supabaseAdmin
      .from("submissions")
      .update({ status: "completed" })
      .eq("id", data.submissionId);
    return { ok: true };
  });

// ---------- 5. Load a submission ----------

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
