-- Hand-off routing pools (docs/contracts.md K3): how many active agents can take a case, by country and pool.
-- Counts only; no agent names or contact details leave the warehouse.
with a as (select * from {{ ref('silver_service_agents') }} where agent_status = 'Active')
select country_of_origin as country, 'fraud' as pool, count(*) as active_agents from a where specialty = 'fraud' group by 1
union all select country_of_origin, 'complaints', count(*) from a where specialty = 'complaints' group by 1
union all select country_of_origin, 'portuguese_speakers', count(*) from a where speaks_portuguese group by 1
union all select country_of_origin, 'general', count(*) from a group by 1
