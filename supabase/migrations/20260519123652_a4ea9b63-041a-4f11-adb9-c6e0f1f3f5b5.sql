
-- Add column for generated photo URLs
ALTER TABLE public.submissions
ADD COLUMN IF NOT EXISTS generated_photos_urls TEXT[] NOT NULL DEFAULT '{}'::text[];

-- Allow updates to submissions (status + generated_photos_urls)
DROP POLICY IF EXISTS "Anyone can update submissions" ON public.submissions;
CREATE POLICY "Anyone can update submissions"
ON public.submissions
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Create bucket for generated photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated_photos', 'generated_photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for generated_photos bucket
DROP POLICY IF EXISTS "Public read generated_photos" ON storage.objects;
CREATE POLICY "Public read generated_photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated_photos');

DROP POLICY IF EXISTS "Public upload generated_photos" ON storage.objects;
CREATE POLICY "Public upload generated_photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'generated_photos');
