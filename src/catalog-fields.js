// Anonymous SELECT permissions in Supabase must match this public allowlist.
export const publicProductColumns = [
  'id', 'title', 'category', 'tag', 'status', 'image_url', 'images',
  'kaspi_url', 'video_url', 'sort', 'created_at', 'updated_at'
].join(',');
