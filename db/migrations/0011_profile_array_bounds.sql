-- Tighten the profile array bounds: cardinality() counts every element across
-- all dimensions, so a multidimensional array can't slip past a first-dimension
-- array_length() check. Also forbid NULL elements. (The app already allowlists
-- every value; these are defense-in-depth.)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_fav_len;
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_emotes_len;

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_fav_len
  CHECK (cardinality(favorite_cards) <= 2 AND array_position(favorite_cards, NULL) IS NULL);
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_emotes_len
  CHECK (cardinality(emotes) <= 6 AND array_position(emotes, NULL) IS NULL);
