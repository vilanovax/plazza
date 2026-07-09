-- array_position(..., NULL) raises a hard error on a multidimensional array
-- (instead of a clean CHECK failure), and Postgres forbids the subquery-based
-- alternatives inside a CHECK. cardinality() alone fully addresses the original
-- concern: it counts elements across ALL dimensions, so a multidimensional array
-- can't slip past the size cap. NULL elements are already impossible from the
-- app (sanitizeProfile allowlists every element), so drop that sub-check.
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_fav_len;
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_emotes_len;

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_fav_len    CHECK (cardinality(favorite_cards) <= 2);
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_emotes_len CHECK (cardinality(emotes) <= 6);
