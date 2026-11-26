-- Gelo (geleiras e calotas) em todo corpo com superficie solida que ainda
-- nao o tem. Codigo novo, depois do maior do corpo; gigantes gasosos ficam
-- de fora. Nao mexe na revisao: o rascunho aberto no navegador continua
-- valendo, e o editor junta o material novo ao restaura-lo.
INSERT INTO "materials" ("body_id", "code", "name", "phase", "color", "texture", "sort")
SELECT
  b."id",
  (SELECT max(m."code") + 1 FROM "materials" m WHERE m."body_id" = b."id"),
  'Gelo',
  'solid',
  '#e9f1f5',
  '{"pattern":"ruido","color2":"#c9d8e0","intensity":0.35,"scale":48}'::jsonb,
  (SELECT coalesce(max(m."sort"), 0) + 1 FROM "materials" m WHERE m."body_id" = b."id")
FROM "bodies" b
WHERE EXISTS (SELECT 1 FROM "materials" m WHERE m."body_id" = b."id" AND m."phase" = 'solid')
  AND NOT EXISTS (SELECT 1 FROM "materials" m WHERE m."body_id" = b."id" AND lower(trim(m."name")) = 'gelo');
