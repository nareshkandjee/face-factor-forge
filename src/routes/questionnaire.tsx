import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { loadQuestionnaire, saveQuestionnaire, type Questionnaire } from "@/lib/questionnaire-store";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/questionnaire")({
  component: QuestionnairePage,
});

const TOTAL = 8;

const STYLES = ["Sportif/dynamique", "Artistique/créatif", "Intello/sérieux", "Aventurier/voyageur", "Fêtard/social", "Glamour/chic", "Naturel/authentique"];
const VIBES = ["Mystérieux et charismatique", "Drôle et accessible", "Sportif et viril (ou féminin)", "Sophistiqué et élégant", "Aventureux et libre", "Cool et décontracté"];
const DRESS = ["Casual streetwear", "Smart casual", "Sportswear", "Élégant-costume", "Bohème-original", "Mix de tout"];
const SCENES = ["Portrait studio pro", "Extérieur urbain", "Nature (montagne, plage, forêt)", "Soirée/bar", "En activité (sport, voyage, musique)", "Avec animaux", "En voiture-moto"];

function QuestionnairePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [q, setQ] = useState<Questionnaire>({ age_min: 22, age_max: 32 });

  useEffect(() => { setQ({ age_min: 22, age_max: 32, ...loadQuestionnaire() }); }, []);
  useEffect(() => { saveQuestionnaire(q); }, [q]);

  const canNext = (() => {
    switch (step) {
      case 1: return !!q.gender;
      case 2: return !!q.looking_for;
      case 3: return !!q.age_min && !!q.age_max;
      case 4: return (q.styles_liked?.length ?? 0) >= 1;
      case 5: return !!q.vibe;
      case 6: return !!q.dress_style;
      case 7: return (q.scenes?.length ?? 0) >= 1;
      case 8: return !!q.city && q.city.trim().length >= 2;
      default: return false;
    }
  })();

  const next = () => {
    if (!canNext) return;
    if (step === TOTAL) { navigate({ to: "/upload" }); return; }
    setStep((s) => s + 1);
  };
  const prev = () => setStep((s) => Math.max(1, s - 1));

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      {/* Progress */}
      <div className="mx-auto w-full max-w-2xl px-5 pt-8">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>Question {step} / {TOTAL}</span>
          <span>{Math.round((step / TOTAL) * 100)}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-gradient-primary transition-all duration-500" style={{ width: `${(step / TOTAL) * 100}%` }} />
        </div>
      </div>

      <main className="mx-auto w-full max-w-2xl px-5 py-12 flex-1">
        {step === 1 && (
          <Step title="Tu es" subtitle="Pour qu'on génère des photos qui te ressemblent.">
            <RadioCards
              options={[{ v: "homme", l: "Homme" }, { v: "femme", l: "Femme" }, { v: "autre", l: "Autre" }]}
              value={q.gender}
              onChange={(v) => setQ({ ...q, gender: v as Questionnaire["gender"] })}
            />
          </Step>
        )}
        {step === 2 && (
          <Step title="Tu cherches" subtitle="On orientera le style en conséquence.">
            <RadioCards
              options={[{ v: "femme", l: "Femme" }, { v: "homme", l: "Homme" }, { v: "les_deux", l: "Les deux" }]}
              value={q.looking_for}
              onChange={(v) => setQ({ ...q, looking_for: v as Questionnaire["looking_for"] })}
            />
          </Step>
        )}
        {step === 3 && (
          <Step title="Tranche d'âge" subtitle="L'âge des personnes que tu veux rencontrer.">
            <div className="space-y-8 rounded-3xl border border-border bg-surface/60 p-6">
              <AgeSlider label="Âge minimum" value={q.age_min ?? 22} onChange={(v) => setQ({ ...q, age_min: Math.min(v, (q.age_max ?? 65) - 1) })} />
              <AgeSlider label="Âge maximum" value={q.age_max ?? 32} onChange={(v) => setQ({ ...q, age_max: Math.max(v, (q.age_min ?? 18) + 1) })} />
              <div className="text-center text-sm text-muted-foreground">Entre <strong className="text-foreground">{q.age_min}</strong> et <strong className="text-foreground">{q.age_max}</strong> ans</div>
            </div>
          </Step>
        )}
        {step === 4 && (
          <Step title="Le style qui te plaît" subtitle="Max 2 choix.">
            <CheckboxCards options={STYLES} values={q.styles_liked ?? []} max={2} onChange={(values) => setQ({ ...q, styles_liked: values })} />
          </Step>
        )}
        {step === 5 && (
          <Step title="La vibe que tu veux dégager" subtitle="Un seul choix.">
            <RadioCards options={VIBES.map(v => ({ v, l: v }))} value={q.vibe} onChange={(v) => setQ({ ...q, vibe: v })} />
          </Step>
        )}
        {step === 6 && (
          <Step title="Ton style vestimentaire" subtitle="Comment tu t'habilles d'habitude.">
            <RadioCards options={DRESS.map(v => ({ v, l: v }))} value={q.dress_style} onChange={(v) => setQ({ ...q, dress_style: v })} />
          </Step>
        )}
        {step === 7 && (
          <Step title="Types de scènes voulues" subtitle="Max 3 choix.">
            <CheckboxCards options={SCENES} values={q.scenes ?? []} max={3} onChange={(values) => setQ({ ...q, scenes: values })} />
          </Step>
        )}
        {step === 8 && (
          <Step title="Ta ville ou région" subtitle="Pour adapter les décors extérieurs.">
            <Input
              autoFocus
              placeholder="Ex : Paris, Lyon, Marseille..."
              value={q.city ?? ""}
              onChange={(e) => setQ({ ...q, city: e.target.value })}
              className="h-14 text-base"
            />
          </Step>
        )}

        <div className="mt-10 flex items-center justify-between">
          <Button variant="ghost" onClick={prev} disabled={step === 1} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Précédent
          </Button>
          <Button onClick={next} disabled={!canNext} className="gap-2 bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow disabled:opacity-40 disabled:shadow-none">
            {step === TOTAL ? "Continuer vers l'upload" : "Suivant"} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </main>
    </div>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted-foreground">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function RadioCards({ options, value, onChange }: { options: { v: string; l: string }[]; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-3">
      {options.map((opt) => {
        const active = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            className={cn(
              "flex items-center justify-between rounded-2xl border bg-surface/60 px-5 py-4 text-left text-base font-medium transition-all",
              active ? "border-primary shadow-glow bg-primary/10" : "border-border hover:border-primary/50"
            )}
          >
            {opt.l}
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border-2 transition", active ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
              {active && <Check className="h-3 w-3" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CheckboxCards({ options, values, max, onChange }: { options: string[]; values: string[]; max: number; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) => {
    if (values.includes(opt)) onChange(values.filter((v) => v !== opt));
    else if (values.length < max) onChange([...values, opt]);
  };
  return (
    <div>
      <div className="mb-3 text-xs text-muted-foreground">{values.length} / {max} sélectionnés</div>
      <div className="grid gap-3">
        {options.map((opt) => {
          const active = values.includes(opt);
          const disabled = !active && values.length >= max;
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt)}
              className={cn(
                "flex items-center justify-between rounded-2xl border bg-surface/60 px-5 py-4 text-left text-base font-medium transition-all",
                active ? "border-primary shadow-glow bg-primary/10" : "border-border hover:border-primary/50",
                disabled && "opacity-40 cursor-not-allowed hover:border-border"
              )}
            >
              {opt}
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border-2 transition", active ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                {active && <Check className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgeSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-lg font-bold text-primary">{value} ans</span>
      </div>
      <Slider min={18} max={65} step={1} value={[value]} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
