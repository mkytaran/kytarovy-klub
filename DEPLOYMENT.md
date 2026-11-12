# Nasazení Kytarového klubu

Aplikace používá GitHub Pages pro statické soubory, Cloudflare Worker pro API a Supabase pro účty a data.

## Požadavky

- GitHub Pages zapnuté pro větev `main` a kořen repozitáře. Veřejná adresa aplikace je `https://mkytaran.github.io/kytarovy-klub/`.
- Worker `kytarovy-klub-api` nasazený z adresáře `worker` příkazem `npx wrangler deploy`.
- Supabase projekt s aplikovanými migracemi `supabase/migrations/001_initial_schema.sql` a `002_session_version.sql`.
- Tajemství Workeru `SUPABASE_SECRET_KEY` nastavené pomocí `npx wrangler secret put SUPABASE_SECRET_KEY`. Použij Supabase secret key; nikdy ho nevkládej do souborů ani GitHubu.

`worker/wrangler.toml` obsahuje veřejné nastavení Supabase URL, publishable key, povolený původ aplikace a Durable Object bindingy. Tajemství ukládej jako Cloudflare Worker secrets.

## První vytvoření učitelského účtu

Pokud v `public.profiles` ještě není učitelský účet:

1. V adresáři `worker` nastav jednorázové náhodné tajemství alespoň 32 znaků:

   ```sh
   npx wrangler secret put SUPABASE_BOOTSTRAP_SECRET
   ```

2. Spusť `node bootstrap-teacher.mjs`. Skript skrytě vyžádá bootstrap tajemství, jméno učitele a heslo dvakrát. Tajemství musí přesně odpovídat hodnotě nastavené v předchozím kroku; heslo musí mít 12 až 128 znaků.
3. Po úspěšném vytvoření učitele tajemství ihned odstraň:

   ```sh
   npx wrangler secret delete SUPABASE_BOOTSTRAP_SECRET
   ```

Skript vytvoří účet v Supabase projektu nastaveném pro Worker. Bootstrap funguje pouze tehdy, když učitelský účet ještě neexistuje. Nevytvářej druhý účet, pokud už jeden existuje.

## Obnovení hesla učitele

Pokud učitelský účet existuje, ale heslo je potřeba změnit:

1. Nastav nové dočasné tajemství pomocí `npx wrangler secret put SUPABASE_BOOTSTRAP_SECRET`.
2. V adresáři `worker` spusť `node reset-teacher-password.mjs`. Skript skrytě vyžádá tajemství a nové heslo dvakrát.
3. Po úspěšném resetu tajemství odstraň příkazem `npx wrangler secret delete SUPABASE_BOOTSTRAP_SECRET`.

Reset vyžaduje právě jeden aktivní účet učitele. Jestliže účet chybí, použij první vytvoření účtu; jestliže účet existuje, ale není aktivní, ověř jeho stav v `public.profiles`.

## Zveřejnění změn

1. Nahraj změny statické aplikace do větve `main`; GitHub Pages je zveřejní na `https://mkytaran.github.io/kytarovy-klub/`.
2. Změny Workeru nasaď z adresáře `worker` příkazem `npx wrangler deploy`.
3. Po změně databázového schématu aplikuj příslušnou SQL migraci v Supabase SQL Editoru.

Bootstrap skript a resetovací skript jsou v `worker/`. Pro samotné přihlášení ani běžný provoz není bootstrap tajemství potřeba. Nikdy neukládej hesla ani tajemství do repozitáře.

## Soukromí a provoz

- Supabase ukládá profily a bodové zápisy. Tajný Supabase klíč má pouze Worker; nepoužívej ho v klientském JavaScriptu.
- Přihlašovací heslo má 12 až 128 znaků. Učitelské a žákovské účty se přihlašují jménem a heslem.
- Přihlášení je chráněno limitem pěti chybných pokusů na účet a šedesáti na IP adresu během 15 minut. Po dosažení limitu se přihlášení dočasně uzamkne.
- PWA ukládá přihlašovací token v místním úložišti, nikdy heslo. Service worker ukládá pouze veřejné soubory aplikace. Na sdíleném zařízení se vždy odhlaš.
- Relace vyprší po osmi hodinách bez kontaktu se serverem. Změna hesla nebo deaktivace účtu zneplatní staré relace.
- Aplikaci lze otevřít offline, ale přihlášení a práce s daty vyžadují internet.

Před ukládáním údajů nezletilých ověř pravidla školy a požadavky na ochranu osobních údajů pro použité služby.
