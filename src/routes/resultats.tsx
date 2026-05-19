import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import JSZip from "jszip";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";
import {
  generatePrompts,
  generateImage,
  markSubmissionComplete,
  getSubmission,
} from "@/lib/generation.functions";

const searchSchema = z.object({ id: z.string().uuid().optional() });

export const Route = createFileRoute("/resultats")({
  validateSearch: searchSchema,
  component: ResultsPage,
});

type Slot =
  | { status: "pending"; prompt: string }
  | { status: "generating"; prompt: string }
  | { status: "done"; prompt: string; url: string }
  | { status: "error"; prompt: string; error: string };

function ResultsPage() {
  const { id } = Route.useSearch();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [phase, setPhase] = useState<"loading" | "prompting" | "generating" | "done" | "error">(
    "loading",
  );
  const [globalError, setGlobalError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const promptsFn = useServerFn(generatePrompts);
  const imageFn = useServerFn(generateImage);
  const completeFn = useServerFn(markSubmissionComplete);
  const subFn = useServerFn(getSubmission);

  useEffect(() => {
    if (!id || startedRef.current) return;
    startedRef.current = true;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    (async () => {
      try {
        // 1. Load submission to get reference photos + check if already done
        setPhase("loading");
        const { submission } = await subFn({ data: { submissionId: id } });
        const referenceUrls = submission.photos_urls ?? [];
        if (referenceUrls.length === 0) throw new Error("Aucune photo de référence trouvée.");

        // Already completed → display existing photos
        if (submission.status === "completed" && (submission.generated_photos_urls?.length ?? 0) >= 12) {
          setSlots(
            submission.generated_photos_urls!.map((url) => ({
              status: "done" as const,
              prompt: "",
              url,
            })),
          );
          setPhase("done");
          return;
        }

        // 2. Generate 12 prompts
        setPhase("prompting");
        const promptResult = await promptsFn({ data: { submissionId: id } });
        if (!promptResult.ok) {
          setGlobalError(promptResult.message);
          setPhase("error");
          toast.error(promptResult.message);
          return;
        }
        const { prompts } = promptResult;
        setSlots(prompts.map((p) => ({ status: "pending" as const, prompt: p })));
        setPhase("generating");

        // 3. Generate 12 images SEQUENTIALLY via Lovable AI (Gemini Nano Banana Pro).
        // Plus permissif que OpenAI : 2s entre chaque appel suffit.
        for (let index = 0; index < prompts.length; index++) {
          const prompt = prompts[index]!;
          setSlots((prev) => {
            const next = [...prev];
            next[index] = { status: "generating", prompt };
            return next;
          });

          let attempt = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            attempt++;
            const result = await imageFn({
              data: { submissionId: id, prompt, index, referenceUrls },
            });

            if (result.ok) {
              console.log(`[generateImage] slot ${index} OK with model=${result.modelUsed}`);
              setSlots((prev) => {
                const next = [...prev];
                next[index] = { status: "done", prompt, url: result.url };
                return next;
              });
              break;
            }

            // 429 rate limit → wait 10s and retry once
            const isRate = result.httpStatus === 429;
            if (isRate && attempt === 1) {
              toast.warning(`Limite de débit sur la photo ${index + 1}, nouvelle tentative dans 10s...`);
              await sleep(10000);
              continue;
            }

            // Definitive failure
            console.error(`[generateImage] slot ${index} failed:`, result);
            toast.error(`Photo ${index + 1}: ${result.message ?? "erreur"}`);
            setSlots((prev) => {
              const next = [...prev];
              next[index] = { status: "error", prompt, error: result.message ?? "Erreur" };
              return next;
            });
            break;
          }

          // Throttle: 2s between requests
          if (index < prompts.length - 1) {
            await sleep(2000);
          }
        }

        // 4. Mark complete only if all 12 succeeded
        setSlots((prev) => {
          if (prev.every((s) => s.status === "done")) {
            completeFn({ data: { submissionId: id } }).catch(() => undefined);
          }
          return prev;
        });
        setPhase("done");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Une erreur est survenue.";
        setGlobalError(msg);
        setPhase("error");
        toast.error(msg);
      }
    })();
  }, [id, promptsFn, imageFn, completeFn, subFn]);

  const retrySlot = async (index: number) => {
    if (!id) return;
    const slot = slots[index];
    if (!slot || slot.status === "done") return;
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { status: "generating", prompt: slot.prompt };
      return next;
    });
    try {
      const { submission } = await subFn({ data: { submissionId: id } });
      const result = await imageFn({
        data: {
          submissionId: id,
          prompt: slot.prompt,
          index,
          referenceUrls: submission.photos_urls ?? [],
        },
      });
      if (!result.ok) {
        throw new Error(result.message ?? "Erreur génération");
      }
      setSlots((prev) => {
        const next = [...prev];
        next[index] = { status: "done", prompt: slot.prompt, url: result.url };
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur génération";
      setSlots((prev) => {
        const next = [...prev];
        next[index] = { status: "error", prompt: slot.prompt, error: msg };
        return next;
      });
      toast.error(msg);
    }
  };

  const downloadOne = async (url: string, index: number) => {
    try {
      const r = await fetch(url);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `matchshot_${index + 1}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Téléchargement impossible.");
    }
  };

  const downloadAllZip = async () => {
    const done = slots.filter((s): s is Extract<Slot, { status: "done" }> => s.status === "done");
    if (done.length === 0) return;
    toast.info("Préparation du ZIP...");
    try {
      const zip = new JSZip();
      await Promise.all(
        done.map(async (s, i) => {
          const r = await fetch(s.url);
          const blob = await r.blob();
          zip.file(`matchshot_${i + 1}.png`, blob);
        }),
      );
      const out = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(out);
      a.download = "matchshot_photos.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Création du ZIP échouée.");
    }
  };

  const doneCount = slots.filter((s) => s.status === "done").length;
  const totalSlots = slots.length || 12;
  const allDone = phase === "done" && doneCount === totalSlots;

  if (!id) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-5 py-24 text-center">
          <h1 className="text-2xl font-bold">Aucune soumission</h1>
          <p className="mt-3 text-muted-foreground">Retourne à l'accueil pour démarrer.</p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/">Accueil</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <Toaster richColors theme="dark" />
      <main className="mx-auto max-w-6xl px-5 py-12">
        <header className="text-center">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">
            Tes photos <span className="text-gradient-primary">MatchShot</span>
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            {allDone
              ? "Tes 12 photos sont prêtes 🔥"
              : "12 photos optimisées générées rien que pour toi."}
          </p>
        </header>

        {/* Progress */}
        {phase !== "error" && (
          <div className="mt-10 mx-auto max-w-lg rounded-3xl border border-border bg-surface/60 p-5">
            <div className="flex items-center gap-3">
              {allDone ? (
                <Sparkles className="h-5 w-5 text-primary" />
              ) : (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              )}
              <span className="text-sm font-medium">
                {phase === "loading" && "Chargement..."}
                {phase === "prompting" && "Préparation des directions artistiques..."}
                {phase === "generating" && `Génération en cours... (${doneCount}/${totalSlots} photos prêtes) — environ 2-3 minutes`}
                {allDone && `Terminé — ${doneCount}/${totalSlots} photos`}
              </span>
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-primary transition-all duration-500"
                style={{ width: `${(doneCount / totalSlots) * 100}%` }}
              />
            </div>
            {phase === "generating" && !allDone && (
              <p className="mt-3 text-xs text-muted-foreground text-center">
                Génération en cours, ça prend ~2-3 minutes pour respecter les limites OpenAI. Ne ferme pas la page.
              </p>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="mt-10 mx-auto max-w-lg rounded-3xl border border-destructive/40 bg-destructive/10 p-5 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
            <p className="mt-2 font-semibold">{globalError}</p>
            <Button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-full"
              variant="outline"
            >
              Réessayer
            </Button>
          </div>
        )}

        {/* Grid */}
        {slots.length > 0 && (
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {slots.map((slot, i) => (
              <div
                key={i}
                className="group relative aspect-[2/3] rounded-2xl overflow-hidden border border-border bg-muted"
              >
                {slot.status === "done" && (
                  <>
                    <img
                      src={slot.url}
                      alt={`Photo MatchShot ${i + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <button
                      onClick={() => downloadOne(slot.url, i)}
                      className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 transition opacity-0 group-hover:opacity-100"
                    >
                      <span className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow">
                        <Download className="h-4 w-4" /> Télécharger
                      </span>
                    </button>
                  </>
                )}
                {(slot.status === "generating" || slot.status === "pending") && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="text-xs">Génération...</span>
                  </div>
                )}
                {slot.status === "error" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                    <span className="text-xs text-muted-foreground">Erreur — réessayer</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retrySlot(i)}
                      className="rounded-full"
                    >
                      <RefreshCw className="mr-1 h-3 w-3" /> Retry
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Download all */}
        {doneCount > 0 && (
          <div className="mt-12 flex justify-center">
            <Button
              onClick={downloadAllZip}
              className="rounded-full bg-gradient-primary px-8 py-6 text-base font-bold text-primary-foreground shadow-glow hover:opacity-90"
            >
              <Download className="mr-2 h-5 w-5" />
              Télécharger tout en ZIP ({doneCount})
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
