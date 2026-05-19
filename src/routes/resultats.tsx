import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import JSZip from "jszip";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, Sparkles, AlertTriangle, FlaskConical, Brain } from "lucide-react";
import {
  generatePrompts,
  generateImage,
  trainPersonalModel,
  markSubmissionComplete,
  getSubmission,
  TEST_MODE_PHOTO_COUNT,
  PRODUCTION_PHOTO_COUNT,
} from "@/lib/generation.functions";

const searchSchema = z.object({
  id: z.string().uuid().optional(),
  test: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const Route = createFileRoute("/resultats")({
  validateSearch: searchSchema,
  component: ResultsPage,
});

type Slot =
  | { status: "pending"; prompt: string }
  | { status: "generating"; prompt: string }
  | { status: "done"; prompt: string; url: string }
  | { status: "error"; prompt: string; error: string };

type Phase = "loading" | "training" | "prompting" | "generating" | "done" | "error";

const TRAINING_TIPS = [
  "💡 Le sais-tu ? Les profils avec un sourire franc reçoivent 14% de likes en plus",
  "💡 L'ordre des photos compte : ta meilleure photo en premier, toujours",
  "💡 Inclure une photo plein corps double le taux de matchs (étude Hinge 2024)",
  "💡 Évite les selfies miroir, ils diminuent l'attractivité perçue de 27%",
  "💡 Une photo en activité (sport, voyage, hobby) génère 2x plus de conversations",
];
const TRAINING_DURATION_MS = 6 * 60 * 1000;

function ResultsPage() {
  const { id, test } = Route.useSearch();
  const isTestMode = test === 1;
  const photoCount = isTestMode ? TEST_MODE_PHOTO_COUNT : PRODUCTION_PHOTO_COUNT;
  const [slots, setSlots] = useState<Slot[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [trainingStart, setTrainingStart] = useState<number | null>(null);
  const [trainingElapsed, setTrainingElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [loraInfo, setLoraInfo] = useState<{ loraUrl: string; triggerWord: string } | null>(null);
  const startedRef = useRef(false);

  const promptsFn = useServerFn(generatePrompts);
  const imageFn = useServerFn(generateImage);
  const trainFn = useServerFn(trainPersonalModel);
  const completeFn = useServerFn(markSubmissionComplete);
  const subFn = useServerFn(getSubmission);

  // Training progress ticker + tips rotation
  useEffect(() => {
    if (phase !== "training" || !trainingStart) return;
    const tick = setInterval(() => setTrainingElapsed(Date.now() - trainingStart), 1000);
    const tipTimer = setInterval(() => setTipIndex((i) => (i + 1) % TRAINING_TIPS.length), 8000);
    return () => { clearInterval(tick); clearInterval(tipTimer); };
  }, [phase, trainingStart]);

  useEffect(() => {
    if (!id || startedRef.current) return;
    startedRef.current = true;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    (async () => {
      try {
        // 1. Load submission
        setPhase("loading");
        const { submission } = await subFn({ data: { submissionId: id } });

        // Already completed → display existing photos
        if (submission.status === "completed" && (submission.generated_photos_urls?.length ?? 0) >= photoCount) {
          setSlots(
            submission.generated_photos_urls!.map((url) => ({
              status: "done" as const, prompt: "", url,
            })),
          );
          setPhase("done");
          return;
        }

        // 2. Train LoRA (or reuse if already trained)
        let loraUrl = submission.lora_url as string | null;
        let triggerWord = submission.trigger_word as string | null;
        if (!loraUrl || !triggerWord) {
          setPhase("training");
          setTrainingStart(Date.now());
          const trainResult = await trainFn({ data: { submissionId: id } });
          if (!trainResult.ok) {
            setGlobalError(trainResult.message);
            setPhase("error");
            toast.error(trainResult.message);
            return;
          }
          loraUrl = trainResult.loraUrl;
          triggerWord = trainResult.triggerWord;
        }
        setLoraInfo({ loraUrl, triggerWord });

        // 3. Generate prompts
        setPhase("prompting");
        const promptResult = await promptsFn({ data: { submissionId: id, count: photoCount } });
        if (!promptResult.ok) {
          setGlobalError(promptResult.message);
          setPhase("error");
          toast.error(promptResult.message);
          return;
        }
        const { prompts } = promptResult;
        setSlots(prompts.map((p) => ({ status: "pending" as const, prompt: p })));
        setPhase("generating");

        // 4. Generate images sequentially via Flux LoRA
        for (let index = 0; index < prompts.length; index++) {
          const prompt = prompts[index]!;
          setSlots((prev) => {
            const next = [...prev];
            next[index] = { status: "generating", prompt };
            return next;
          });

          const result = await imageFn({
            data: { submissionId: id, prompt, index, loraUrl, triggerWord },
          });

          if (result.ok) {
            console.log(`[generateImage] slot ${index} OK`);
            setSlots((prev) => {
              const next = [...prev];
              next[index] = { status: "done", prompt, url: result.url };
              return next;
            });
          } else {
            console.error(`[generateImage] slot ${index} failed:`, result);
            toast.error(`Photo ${index + 1}: ${result.message ?? "erreur"}`);
            setSlots((prev) => {
              const next = [...prev];
              next[index] = { status: "error", prompt, error: result.message ?? "Erreur" };
              return next;
            });
          }

          if (index < prompts.length - 1) await sleep(2000);
        }

        // 5. Mark complete only if all succeeded
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
  }, [id, photoCount, promptsFn, imageFn, trainFn, completeFn, subFn]);

  const retrySlot = async (index: number) => {
    if (!id || !loraInfo) return;
    const slot = slots[index];
    if (!slot || slot.status === "done") return;
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { status: "generating", prompt: slot.prompt };
      return next;
    });
    try {
      const result = await imageFn({
        data: {
          submissionId: id,
          prompt: slot.prompt,
          index,
          loraUrl: loraInfo.loraUrl,
          triggerWord: loraInfo.triggerWord,
        },
      });
      if (!result.ok) throw new Error(result.message ?? "Erreur génération");
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
  const totalSlots = slots.length || photoCount;
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

  const trainingProgress = Math.min(99, Math.round((trainingElapsed / TRAINING_DURATION_MS) * 100));

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <Toaster richColors theme="dark" />
      <main className="mx-auto max-w-6xl px-5 py-12">
        {isTestMode && (
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-xs font-semibold text-amber-300">
            <FlaskConical className="h-3.5 w-3.5" /> Mode test ({TEST_MODE_PHOTO_COUNT} photos)
          </div>
        )}

        {/* Training phase — dedicated full-width UI */}
        {phase === "training" && (
          <div className="mx-auto max-w-xl text-center py-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Brain className="h-8 w-8 animate-pulse" />
            </div>
            <h1 className="mt-6 text-3xl md:text-4xl font-extrabold tracking-tight">
              🧠 L'IA apprend ton visage...
            </h1>
            <p className="mt-3 text-muted-foreground">
              Cela prend 5 à 7 minutes. On entraîne un modèle IA personnel rien que pour toi.
            </p>

            <div className="mt-8 h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-primary transition-all duration-1000 ease-linear"
                style={{ width: `${trainingProgress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {Math.floor(trainingElapsed / 60000)} min {String(Math.floor((trainingElapsed % 60000) / 1000)).padStart(2, "0")}s écoulées · ~{trainingProgress}%
            </p>

            <div className="mt-10 rounded-2xl border border-border bg-surface/60 p-6 min-h-[80px] flex items-center justify-center">
              <p key={tipIndex} className="text-sm text-foreground animate-in fade-in duration-700">
                {TRAINING_TIPS[tipIndex]}
              </p>
            </div>

            <p className="mt-6 text-xs text-muted-foreground italic">
              Ne ferme pas la page. On y est presque.
            </p>
          </div>
        )}

        {/* Header (hidden during training phase) */}
        {phase !== "training" && (
          <header className="text-center">
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">
              Tes photos <span className="text-gradient-primary">MatchShot</span>
            </h1>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              {allDone
                ? `Tes ${photoCount} photos sont prêtes 🔥`
                : `${photoCount} photos optimisées générées rien que pour toi.`}
            </p>
          </header>
        )}

        {/* Progress (non-training phases) */}
        {phase !== "error" && phase !== "training" && (
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
                {phase === "generating" && `Génération en cours... Photo ${Math.min(doneCount + 1, totalSlots)}/${totalSlots}`}
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
                Temps estimé restant : ~{Math.max(1, Math.ceil((totalSlots - doneCount) / 2))} minute{totalSlots - doneCount > 2 ? "s" : ""}
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
        {slots.length > 0 && phase !== "training" && (
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
        {doneCount > 0 && phase !== "training" && (
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
