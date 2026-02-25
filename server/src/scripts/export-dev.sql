-- export-dev.sql
-- Generates INSERT statements for prod from the dev database.
-- Run against dev DB and redirect output to a file:
--
--   psql <dev_db_url> -t -A -f export-dev.sql > import-prod.sql
--
-- Then review import-prod.sql and run it against prod:
--   psql <prod_db_url> -f import-prod.sql

-- ============================================================
-- CATEGORIES
-- ============================================================

-- Parents first (no parent), then children
SELECT
    'INSERT INTO categories (id, user_id, name, parent_id, description, color, icon, priority, is_system, created_at) '
    || 'SELECT gen_random_uuid(), u.id, '
    || quote_literal(c.name) || ', '
    || CASE WHEN p.name IS NULL THEN 'NULL'
            ELSE '(SELECT id FROM categories WHERE user_id = u.id AND name = ' || quote_literal(p.name) || ' LIMIT 1)'
       END || ', '
    || COALESCE(quote_literal(c.description), 'NULL') || ', '
    || COALESCE(quote_literal(c.color), 'NULL') || ', '
    || COALESCE(quote_literal(c.icon), 'NULL') || ', '
    || c.priority::text || ', false, NOW() '
    || 'FROM users u WHERE u.email = ' || quote_literal(u.email) || ' '
    || 'AND NOT EXISTS (SELECT 1 FROM categories WHERE user_id = u.id AND name = ' || quote_literal(c.name) || ');'
FROM categories c
JOIN users u ON c.user_id = u.id
LEFT JOIN categories p ON c.parent_id = p.id
WHERE u.email = 'paul2999@gmail.com'
  AND c.is_system = false
ORDER BY c.parent_id NULLS FIRST, c.created_at;

-- ============================================================
-- LEARNED RULES
-- ============================================================

SELECT
    'INSERT INTO learned_rules (id, user_id, account_id, match_type, match_value, target_category_id, target_folder_id, action, priority, confidence_boost, created_at) '
    || 'SELECT gen_random_uuid(), u.id, '
    -- account_id (optional)
    || CASE WHEN ar.email_address IS NULL THEN 'NULL'
            ELSE '(SELECT id FROM accounts WHERE user_id = u.id AND email_address = ' || quote_literal(ar.email_address) || ' LIMIT 1)'
       END || ', '
    || quote_literal(lr.match_type) || ', '
    || quote_literal(lr.match_value) || ', '
    -- target_category_id (optional)
    || CASE WHEN cat.name IS NULL THEN 'NULL'
            ELSE '(SELECT id FROM categories WHERE user_id = u.id AND name = ' || quote_literal(cat.name) || ' LIMIT 1)'
       END || ', '
    -- target_folder_id (optional)
    || CASE WHEN f.id IS NULL THEN 'NULL'
            ELSE '(SELECT f.id FROM folders f JOIN accounts a ON f.account_id = a.id WHERE a.user_id = u.id AND a.email_address = ' || quote_literal(af.email_address) || ' AND (f.full_path = ' || quote_literal(COALESCE(f.full_path, f.name)) || ' OR f.name = ' || quote_literal(f.name) || ') LIMIT 1)'
       END || ', '
    || quote_literal(lr.action) || ', '
    || lr.priority::text || ', '
    || lr.confidence_boost::text || ', NOW() '
    || 'FROM users u WHERE u.email = ' || quote_literal(u.email) || ' '
    || 'AND NOT EXISTS (SELECT 1 FROM learned_rules WHERE user_id = u.id AND match_type = ' || quote_literal(lr.match_type) || ' AND match_value = ' || quote_literal(lr.match_value) || ');'
FROM learned_rules lr
JOIN users u ON lr.user_id = u.id
LEFT JOIN categories cat ON lr.target_category_id = cat.id
LEFT JOIN folders f ON lr.target_folder_id = f.id
LEFT JOIN accounts af ON f.account_id = af.id
LEFT JOIN accounts ar ON lr.account_id = ar.id
WHERE u.email = 'paul2999@gmail.com'
ORDER BY lr.created_at;
