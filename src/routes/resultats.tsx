import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkles } from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({ id: z.string().optional() });

export const Route = createFileRoute("/resultats")({
  validateSearch: searchSchema,
  component: ResultsPage,
});

function ResultsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-5 py-24 text-center">
        <div className="relative mx-auto h-24 w-24">
          <div className="absolute inset-0 rounded-full bg-gradient-primary blur-2xl opacity-60 animate-pulse" />
          <div className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-primary shadow-glow">
            <Sparkles className="h-10 w-10 text-primary-foreground animate-pulse" />
          </div>
        </div>

        <h1 className="mt-10 text-3xl md:text-5xl font-extrabold tracking-tight">
          Tes photos sont en cours <span className="text-gradient-primary">de génération...</span>
        </h1>
        <p className="mt-4 text-muted-foreground">
          Notre IA travaille pour créer 12 photos optimisées rien que pour toi. Tu recevras une notification dès que c'est prêt — généralement entre 10 et 20 minutes.
        </p>

        <div className="mt-12 mx-auto max-w-md rounded-3xl border border-border bg-surface/60 p-6 text-left">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium">Analyse de tes selfies</span>
          </div>
          <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-primary animate-pulse" />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Ne ferme pas cette fenêtre. La génération continue même si tu reviens plus tard sur cette page.
          </p>
        </div>
      </main>
    </div>
  );
}
