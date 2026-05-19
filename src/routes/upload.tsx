import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { loadQuestionnaire, clearQuestionnaire } from "@/lib/questionnaire-store";
import { Upload as UploadIcon, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

const MAX_FILES = 10;
const MIN_FILES = 6;
const MAX_SIZE = 10 * 1024 * 1024;

type LocalFile = { id: string; file: File; preview: string };

function UploadPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const valid: LocalFile[] = [];
    for (const file of list) {
      if (!["image/jpeg", "image/png", "image/jpg"].includes(file.type)) {
        toast.error(`${file.name} : format non supporté (JPG/PNG uniquement).`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name} : trop volumineux (max 10MB).`);
        continue;
      }
      valid.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) });
    }
    setFiles((prev) => {
      const merged = [...prev, ...valid].slice(0, MAX_FILES);
      if (prev.length + valid.length > MAX_FILES) toast.error(`Maximum ${MAX_FILES} photos.`);
      return merged;
    });
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const remove = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const submit = async () => {
    if (files.length < MIN_FILES) return;
    setSubmitting(true);
    try {
      const sessionId = crypto.randomUUID();
      const urls: string[] = [];

      for (const lf of files) {
        const ext = lf.file.name.split(".").pop() || "jpg";
        const path = `${sessionId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("user_photos").upload(path, lf.file, {
          contentType: lf.file.type, upsert: false,
        });
        if (error) throw error;
        const { data } = supabase.storage.from("user_photos").getPublicUrl(path);
        urls.push(data.publicUrl);
      }

      const q = loadQuestionnaire();
      const { data: insert, error: insertErr } = await supabase.from("submissions").insert({
        gender: q.gender ?? null,
        looking_for: q.looking_for ?? null,
        age_min: q.age_min ?? null,
        age_max: q.age_max ?? null,
        styles_liked: q.styles_liked ?? [],
        vibe: q.vibe ?? null,
        dress_style: q.dress_style ?? null,
        scenes: q.scenes ?? [],
        city: q.city ?? null,
        photos_urls: urls,
        status: "generating",
      }).select("id").single();
      if (insertErr) throw insertErr;

      clearQuestionnaire();
      navigate({ to: "/resultats", search: { id: insert.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur d'envoi";
      toast.error(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <Toaster richColors theme="dark" />
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">Upload tes selfies</h1>
        <p className="mt-3 text-muted-foreground max-w-xl">
          Pour de meilleurs résultats, upload entre <strong className="text-foreground">{MIN_FILES} et {MAX_FILES} photos</strong> de toi. <strong className="text-foreground">IMPORTANT</strong> : ta meilleure photo en <strong className="text-foreground">PREMIER</strong> (visage clair, regard caméra, plein cadre). Inclus au minimum : 1 photo de face, 1 photo de 3/4 gauche, 1 photo de 3/4 droite. Pas de lunettes de soleil, pas de casquettes, visage qui occupe 30 à 50% du cadre, éclairage uniforme.
        </p>

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-8 block cursor-pointer rounded-3xl border-2 border-dashed bg-surface/40 p-10 text-center transition-all ${dragging ? "border-primary bg-primary/10 scale-[1.01]" : "border-border hover:border-primary/60"}`}
        >
          <input
            type="file" accept="image/jpeg,image/png" multiple hidden
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
            <UploadIcon className="h-6 w-6" />
          </div>
          <p className="mt-4 font-semibold">Glisse tes photos ici ou clique pour parcourir</p>
          <p className="mt-1 text-xs text-muted-foreground">JPG ou PNG • Max 10MB par photo</p>
        </label>

        {files.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Tes photos ({files.length}/{MAX_FILES})</h2>
              <span className={`text-sm ${files.length >= MIN_FILES ? "text-primary" : "text-muted-foreground"}`}>
                {files.length >= MIN_FILES ? "✓ Prêt à générer" : `Encore ${MIN_FILES - files.length} photo(s) min.`}
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {files.map((f) => (
                <div key={f.id} className="relative aspect-square rounded-xl overflow-hidden border border-border group">
                  <img src={f.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 backdrop-blur text-foreground opacity-0 group-hover:opacity-100 transition hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-10 flex justify-center">
          <Button
            onClick={submit}
            disabled={files.length < MIN_FILES || submitting}
            className="rounded-full bg-gradient-primary px-8 py-6 text-base font-bold text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-40 disabled:shadow-none"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? "Envoi en cours..." : "Générer mes photos"}
          </Button>
        </div>
      </main>
    </div>
  );
}
