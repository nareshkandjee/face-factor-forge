import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Upload, Sparkles, Heart } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-5xl px-5 pt-20 pb-24 md:pt-28 md:pb-32 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs font-medium text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Beta — 100% basé sur tes vraies photos
          </div>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight">
            Tes meilleures photos pour <span className="text-gradient-primary">Tinder</span>,
            <br className="hidden md:block" /> générées par IA
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base md:text-lg text-muted-foreground">
            Uploade tes selfies, réponds à 8 questions, reçois <strong className="text-foreground">12 photos pro</strong> optimisées pour matcher 3x plus.
          </p>
          <div className="mt-10 flex justify-center">
            <Link
              to="/questionnaire"
              className="rounded-full bg-gradient-primary px-8 py-4 text-base font-bold text-primary-foreground shadow-glow transition-transform hover:scale-[1.04]"
            >
              Commencer maintenant
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">~3 minutes • Aucune carte requise</p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-extrabold">Comment ça marche</h2>
          <p className="mt-3 text-muted-foreground">Trois étapes, zéro friction.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Upload, title: "Tu uploads tes selfies", desc: "5 à 10 photos, face et profil. On garde ton vrai visage." },
            { icon: Heart, title: "Tu nous dis qui tu veux matcher", desc: "8 questions rapides pour cibler ton style et ton audience." },
            { icon: Sparkles, title: "On génère 12 photos parfaites", desc: "Scènes pro, looks variés, optimisées pour les apps." },
          ].map((step, i) => (
            <div key={i} className="rounded-3xl border border-border bg-surface/60 p-7 shadow-card hover:border-primary/50 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
                <step.icon className="h-6 w-6" />
              </div>
              <div className="mt-5 text-sm font-medium text-primary">Étape {i + 1}</div>
              <h3 className="mt-1 text-xl font-bold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BEFORE / AFTER */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-5xl font-extrabold">Avant <span className="text-gradient-primary">/</span> Après</h2>
          <p className="mt-3 text-muted-foreground">De selfies basiques à photos qui font swiper.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2].map((n) => (
            <div key={n} className="rounded-3xl border border-border bg-surface/60 p-3 shadow-card">
              <div className="grid grid-cols-2 gap-3">
                <div className="aspect-[3/4] rounded-2xl bg-muted flex items-center justify-center text-muted-foreground text-sm">
                  Avant
                </div>
                <div className="aspect-[3/4] rounded-2xl bg-gradient-to-br from-primary/30 to-primary-glow/20 border border-primary/30 flex items-center justify-center text-sm font-medium">
                  Après ✨
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-5 py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-5xl font-extrabold">Questions fréquentes</h2>
        </div>
        <Accordion type="single" collapsible className="space-y-3">
          {[
            { q: "C'est éthique ?", a: "Oui. On utilise uniquement TES selfies comme base. Les photos générées te ressemblent à 100% — on optimise le cadrage, la lumière et le contexte, pas ton visage." },
            { q: "Combien ça coûte ?", a: "La beta est gratuite pour valider le produit. Plus tard, on prévoit un pack à prix abordable (autour de 19€)." },
            { q: "Mes photos sont-elles sécurisées ?", a: "Tes photos sont stockées de façon sécurisée et supprimées après génération. On ne les partage avec personne." },
            { q: "Combien de temps ça prend ?", a: "Le questionnaire prend 2 minutes, l'upload 1 minute, la génération entre 10 et 20 minutes." },
            { q: "Sur quelles apps ça marche ?", a: "Tinder, Hinge, Bumble, Fruitz, Happn — toutes les apps de rencontre." },
          ].map((item, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="rounded-2xl border border-border bg-surface/60 px-5">
              <AccordionTrigger className="text-left font-semibold hover:no-underline">{item.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mt-14 text-center">
          <Link
            to="/questionnaire"
            className="inline-flex rounded-full bg-gradient-primary px-8 py-4 text-base font-bold text-primary-foreground shadow-glow transition-transform hover:scale-[1.04]"
          >
            Commencer maintenant
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
