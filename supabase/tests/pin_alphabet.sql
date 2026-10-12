-- PIN alphabet parity (VMT 12/10): same samples as web/src/test/fixtures/pin-samples.json.
-- Expect: mismatches = 0.
select count(*) filter (where coalesce(replace(private.user_pin_problem('A-' || b), 'avora_pin_', ''), '') <> coalesce(e, '')) as mismatches,
       count(*) as samples
from (values
  ('LMNPQ23L', null),
  ('ABCLEFGH', null),
  ('LLLL2345', 'edges'),
  ('LAKE2345', 'edges'),
  ('MNPQ23RS', null),
  ('MINHNAM8', 'confusing'),
  ('ABCDEFGO', 'confusing'),
  ('ABCDEF1H', 'confusing'),
  ('ABCD0EFG', 'confusing'),
  ('ABCDIEFG', 'confusing'),
  ('2BCDEFGL', 'edges'),
  ('AL23456C', 'letters'),
  ('ABL2345D', null),
  ('GRABXYZL', 'blocked'),
  ('ABCDEFG', 'format'),
  ('ABCD-EFG', 'format')
) v(b, e);
