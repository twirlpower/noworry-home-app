-- ============================================================================
-- NoWorry Home — Migration 006: seasonal maintenance templates (Colorado)
-- Run order: 001 schema, 002 rls_v1, 003 rls_v2, 004 maintenance, 005 safety,
--            then 006.
-- Extends the maintenance_templates seed from 004. Idempotent: re-running
-- only refreshes descriptions and inserts rows that aren't already present
-- (keyed on system_type + title), so it never duplicates 004's rows.
-- ============================================================================

-- 1. Add Front Range / altitude context to the templates 004 already seeded.
--    (UPDATE by title — safe to re-run; no semantic duplicates created.)
update maintenance_templates set description =
  'Replace the furnace/AC air filter. At Denver''s 5,280 ft the blower moves '
  'thinner air and runs longer — check monthly in heating/cooling season and '
  'swap at least quarterly.'
  where title = 'Replace HVAC filter';

update maintenance_templates set description =
  'Annual heating service before winter. High-altitude furnaces cycle harder '
  'and longer; verify combustion, heat exchanger, and CO safety.'
  where title = 'Furnace inspection & tune-up';

update maintenance_templates set description =
  'Annual cooling service before summer. Thin dry air and intense Front Range '
  'sun increase load; clean coils and check refrigerant charge.'
  where title = 'A/C inspection & tune-up';

update maintenance_templates set description =
  'Inspect for hail, wind, and UV damage — Colorado is a top hail-loss state '
  'and high-altitude UV ages roofing faster. Document for insurance.'
  where title = 'Roof inspection';

-- 2. New system-specific Colorado templates not seeded by 004.
insert into maintenance_templates (system_type, title, description, frequency_months, season)
select v.system_type::home_system_type, v.title, v.description, v.frequency_months, v.season
from (values
  ('plumbing',  'Winterize sprinkler system',
   'Blow out irrigation lines before the first hard freeze (often early Oct on the Front Range) to prevent burst pipes.',
   12, 'fall'),
  ('plumbing',  'Spring sprinkler activation',
   'Recharge and test irrigation after freeze risk passes (typically mid-May in Denver); check heads and backflow.',
   12, 'spring'),
  ('appliance', 'Clean dryer vent',
   'Clear lint from the dryer duct. Colorado''s very dry air makes lint more combustible — annual minimum.',
   12, null)
) as v(system_type, title, description, frequency_months, season)
where not exists (
  select 1 from maintenance_templates m
  where m.title = v.title
    and m.system_type is not distinct from v.system_type::home_system_type
);

-- 3. New home-level Colorado templates (system_type null) not seeded by 004.
insert into maintenance_templates (system_type, title, description, frequency_months, season)
select null, v.title, v.description, v.frequency_months, v.season
from (values
  ('Replace smoke/CO detector batteries',
   'Replace alarm batteries annually (distinct from the 6-month test). Swap detector units every 10 years.',
   12, 'fall'),
  ('Exterior paint & caulk check',
   'Inspect siding, trim, and window/door caulk. Intense high-altitude UV and freeze-thaw degrade sealant fast; recaulk as needed.',
   12, 'summer'),
  ('Snow removal prep',
   'Service the snow blower, stock pet-safe ice melt, stage shovels, and mark driveway edges before the first storm.',
   12, 'fall')
) as v(title, description, frequency_months, season)
where not exists (
  select 1 from maintenance_templates m
  where m.title = v.title and m.system_type is null
);
