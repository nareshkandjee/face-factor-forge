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

// ---------- 2. Generate ONE image via gpt-image-2 ----------

export const generateImage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        submissionId: z.string().uuid(),
        prompt: z.string().min(1),
        index: z.number().int().min(0).max(11),
        referenceUrls: z.array(z.string().url()).min(1).max(10),
        model: z.enum(["gpt-image-1", "gpt-image-1-mini"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY manquante côté serveur.");

    // Download all reference photos — first one is the most-preserved identity reference
    const referenceBlobs: Array<{ blob: Blob; filename: string }> = [];
    for (let i = 0; i < data.referenceUrls.length; i++) {
      const url = data.referenceUrls[i];
      const r = await fetch(url);
      if (!r.ok) {
        console.error(`[generateImage] Failed to fetch reference ${i}: ${url}`);
        continue;
      }
      const blob = await r.blob();
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      referenceBlobs.push({ blob, filename: `ref_${i}.${ext}` });
    }
    if (referenceBlobs.length === 0) throw new Error("Impossible de récupérer les photos de référence.");

    // Build multipart form-data for images/edits
    const modelUsed = data.model ?? "gpt-image-1";
    const form = new FormData();
    form.append("model", modelUsed);
    form.append("prompt", data.prompt);
    form.append("size", "1024x1536");
    form.append("quality", "high");
    // gpt-image-1 (and gpt-image-1-mini) support input_fidelity — crucial for face fidelity.
    form.append("input_fidelity", "high");
    // The first image is the strongest identity anchor.
    for (const { blob, filename } of referenceBlobs) {
      form.append("image[]", blob, filename);
    }

    const res = await fetch(`${OPENAI_API}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[generateImage] OpenAI error (model=${modelUsed}, status=${res.status}):`, text);
      // Try to parse OpenAI error envelope { error: { code, message, type } }
      let code: string | null = null;
      let message = `Erreur OpenAI (${res.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string; type?: string } };
        if (parsed.error) {
          code = parsed.error.code ?? parsed.error.type ?? null;
          if (parsed.error.message) message = parsed.error.message;
        }
      } catch {
        /* not JSON */
      }
      if (res.status === 401) {
        return { ok: false as const, index: data.index, httpStatus: 401, code: "invalid_api_key", message: "Clé OpenAI invalide." };
      }
      return {
        ok: false as const,
        index: data.index,
        httpStatus: res.status,
        code,
        message,
        modelUsed,
      };
    }

    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "no_image", message: "Pas d'image retournée par OpenAI." };
    }

    // Decode base64 → bytes → upload to Supabase Storage
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `${data.submissionId}/${data.index}_${Date.now()}.png`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("generated_photos")
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (upErr) {
      return { ok: false as const, index: data.index, httpStatus: 500, code: "upload_failed", message: `Upload échoué: ${upErr.message}` };
    }

    const { data: pub } = supabaseAdmin.storage.from("generated_photos").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    // Append URL to submissions.generated_photos_urls atomically-ish
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

    return { ok: true as const, url: publicUrl, index: data.index, modelUsed };
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
