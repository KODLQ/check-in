-- Invite and co-host tokens without look-alike characters (0/O, 1/l/I), so a link read aloud or
-- retyped from a screenshot still works. Same lengths, and the new alphabet is a subset of base62,
-- so every existing token and every token check ([A-Za-z0-9]{12} / {22}) keeps working.
-- 57 symbols: 12 chars ~ 70 bits (spec: at least 64), 22 chars ~ 128 bits.
create or replace function public.generate_random_token(p_length int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  result text := '';
  bytes bytea;
  b int;
  i int;
begin
  if p_length is null or p_length < 1 or p_length > 256 then
    raise exception 'invalid_length' using errcode = '22023';
  end if;
  while char_length(result) < p_length loop
    bytes := extensions.gen_random_bytes(32);
    for i in 0..31 loop
      b := get_byte(bytes, i);
      -- Rejection sampling avoids modulo bias: 228 = 57 * 4.
      if b < 228 and char_length(result) < p_length then
        result := result || substr(alphabet, (b % 57) + 1, 1);
      end if;
    end loop;
  end loop;
  return result;
end;
$$;
