-- Catálogo de procedimentos da clínica.
-- Renomeia os equivalentes (mantém vendas, agendamentos, compras e anúncios ligados),
-- desativa os que a clínica não oferece (o histórico continua nos relatórios) e cria os que faltam.

UPDATE "procedures" SET "name" = 'Botox'
 WHERE "name" = 'Toxina botulínica' AND NOT EXISTS (SELECT 1 FROM "procedures" WHERE "name" = 'Botox');
UPDATE "procedures" SET "name" = 'Preenchimento'
 WHERE "name" = 'Preenchimento labial' AND NOT EXISTS (SELECT 1 FROM "procedures" WHERE "name" = 'Preenchimento');
UPDATE "procedures" SET "name" = 'Bioestimulador'
 WHERE "name" = 'Bioestimulador de colágeno' AND NOT EXISTS (SELECT 1 FROM "procedures" WHERE "name" = 'Bioestimulador');
UPDATE "procedures" SET "name" = 'Ultraformer MPT'
 WHERE "name" = 'Ultraformer' AND NOT EXISTS (SELECT 1 FROM "procedures" WHERE "name" = 'Ultraformer MPT');

INSERT INTO "procedures" ("id", "name", "defaultPriceCents", "active")
SELECT 'prc_' || replace(gen_random_uuid()::text, '-', ''), n, NULL, true
  FROM unnest(ARRAY[
    'Preenchimento', 'Botox', 'Bioestimulador', 'Lavieen', 'Ultraformer MPT',
    'Combo botox + Preenchimento', 'Combo botox + Bioestimulador'
  ]) AS n
 WHERE NOT EXISTS (SELECT 1 FROM "procedures" p WHERE p."name" = n);

UPDATE "procedures" SET "active" = ("name" IN (
  'Preenchimento', 'Botox', 'Bioestimulador', 'Lavieen', 'Ultraformer MPT',
  'Combo botox + Preenchimento', 'Combo botox + Bioestimulador'
));
