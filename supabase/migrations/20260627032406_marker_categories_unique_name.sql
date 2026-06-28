-- enforce unique custom category names within a space (case-insensitive).
-- system categories (is_system = true, null space_id) are unaffected.
create unique index marker_categories_space_name_uniq
  on public.marker_categories (space_id, lower(name))
  where is_system = false;
