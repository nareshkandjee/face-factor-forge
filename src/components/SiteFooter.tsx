export function SiteFooter() {
  return (
    <footer className="border-t border-border/50 mt-24">
      <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} MatchShot. Tous droits réservés.</p>
        <div className="flex gap-6">
          <a href="mailto:hello@matchshot.app" className="hover:text-foreground transition">Contact</a>
          <a href="#" className="hover:text-foreground transition">Mentions légales</a>
          <a href="#" className="hover:text-foreground transition">Confidentialité</a>
        </div>
      </div>
    </footer>
  );
}
