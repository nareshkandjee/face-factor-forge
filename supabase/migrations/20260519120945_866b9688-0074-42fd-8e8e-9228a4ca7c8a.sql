
CREATE TABLE public.submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gender TEXT,
  looking_for TEXT,
  age_min INT,
  age_max INT,
  styles_liked TEXT[] DEFAULT '{}',
  vibe TEXT,
  dress_style TEXT,
  scenes TEXT[] DEFAULT '{}',
  city TEXT,
  photos_urls TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert submissions"
  ON public.submissions FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Anyone can read submissions"
  ON public.submissions FOR SELECT TO anon, authenticated USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('user_photos', 'user_photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read user_photos"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'user_photos');

CREATE POLICY "Public upload user_photos"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'user_photos');

CREATE POLICY "Public delete user_photos"
  ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'user_photos');
