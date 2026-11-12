# Nasazení Kytarového klubu

Aplikace používá repozitář [mkytaran/kytarovy-klub](https://github.com/mkytaran/kytarovy-klub) a GitHub Pages pro veřejné statické soubory; Google Apps Script zajišťuje přihlášení a práci se soukromou tabulkou. Žáci ji otevírají přes URL nasazené webové aplikace Apps Scriptu, která vloží stránku GitHub Pages do rámce a zprostředkuje volání serveru. Samotný přístup na GitHub Pages API nepovolí.

## 1. Připrav soukromou Google tabulku

1. Vytvoř novou Google tabulku a ponech ji soukromou.
2. Otevři **Rozšíření → Apps Script**. V projektu vytvoř nebo nahraď soubor `Kód.gs` obsahem stejnojmenného souboru z projektu.
3. Vytvoř HTML soubor s názvem `Host` a vlož do něj obsah místního souboru `Host.html`.
4. V Apps Scriptu otevři **Nastavení projektu → Vlastnosti skriptu** a přidej:

   | Název | Hodnota |
   |---|---|
   | `SPREADSHEET_ID` | ID tabulky z její URL |
   | `PIN_PEPPER` | Náhodné tajemství alespoň 32 znaků |
   | `APP_URL` | `https://mkytaran.github.io/kytarovy-klub/` |
   | `BOOTSTRAP_SECRET` | Samostatné náhodné tajemství alespoň 32 znaků |

   Tajemství ukládej jen do vlastností skriptu. Nevkládej je do souborů projektu, tabulky ani GitHubu. `APP_URL` musí být stránka z domény `*.github.io`.
5. V editoru vyber `setupKytarovyKlub` a klikni na **Spustit**. Potvrď oprávnění. Skript vytvoří listy `Accounts` a `Scores` se správnými záhlavími. Pokud už list obsahuje jiné neprázdné záhlaví, skript skončí s chybou a data nepřepíše. Přípravu lze později zopakovat z nabídky **Kytarový klub → Připravit tabulku**.
6. Vyber `setupTeacherAccount` a spusť jej. Zadej jméno učitele, šestimístný číselný kód a dočasné bootstrap tajemství. Po vytvoření prvního účtu se `BOOTSTRAP_SECRET` automaticky odstraní. Kód si bezpečně poznamenej; tabulka ukládá jen jeho HMAC otisk.

Hlavičky, které skript vytvoří:

- `Accounts`: `id | name | normalizedName | role | pinSalt | pinHash | avatar | active | authVersion | createdAt`
- `Scores`: `id | studentId | studentName | score | date | createdAt`

Soubor `Kód.gs` je záměrně v `.gitignore`; zkopíruj ho ručně do editoru Apps Scriptu. Ostatní zdrojové soubory, včetně `Host.html`, jsou veřejné. Do nich tajemství nepatří.

## 2. Nahraj statickou aplikaci na GitHub Pages

Nahraj soubory webové aplikace do repozitáře [mkytaran/kytarovy-klub](https://github.com/mkytaran/kytarovy-klub). V nastavení repozitáře otevři **Settings → Pages**, zapni sestavení z větve `main` a složky `/(root)` a ulož. Po zveřejnění bude adresa aplikace:

`https://mkytaran.github.io/kytarovy-klub/`

Tato adresa musí přesně odpovídat vlastnosti `APP_URL` v Apps Scriptu. V `index.html` je také veřejná URL nasazení Apps Scriptu v metaznačce `apps-script-url`; pokud vytvoříš nové nasazení s jinou URL, aktualizuj ji a nahraj stránku znovu. Přímé otevření stránky na GitHub Pages nyní funguje samostatně a lze ji nainstalovat jako PWA.

## 3. Nasaď Apps Script

1. Zkopíruj aktuální `Kód.gs` a `Host.html` do projektu Apps Scriptu.
2. V Apps Scriptu klikni na **Nasadit → Spravovat nasazení**, uprav nasazení webové aplikace na novou verzi a nasaď změny. Pokud nasazení ještě neexistuje, klikni na **Nové nasazení** a jako typ vyber **Webová aplikace**.
3. Nastav **Spustit jako: Já** a přístup pro **Kdokoli**. Díky tomu žáci nepotřebují Google účet; jejich oprávnění ověřuje aplikace. Pokud pravidla účtu nebo školy veřejný přístup nedovolují, nasazení takto nepůjde použít.
4. URL nasazení končící `/exec` musí souhlasit s metaznačkou `apps-script-url` v `index.html`. Pokud se změnila, uprav ji a publikuj změnu na GitHub Pages.
5. Stránku `https://mkytaran.github.io/kytarovy-klub/` otevři v podporovaném prohlížeči a zvol **Instalovat aplikaci** nebo **Přidat na plochu**. Na iPhonu/iPadu použij v Safari **Sdílet → Přidat na plochu**. Původní odkaz `/exec` zůstává funkční jako webová verze.

## Soukromí a omezení

- Tabulka musí zůstat soukromá. Přístup k ní má vlastník Apps Scriptu; nesdílej ji se žáky.
- Kódy mají přesně šest číslic. Aplikace ukládá HMAC otisky chráněné `PIN_PEPPER`, nikoli čitelné kódy.
- Žáci vidí své zápisy a třídní žebříček; učitel vidí historii celé třídy a spravuje žáky.
- Přihlášení se uchovává pouze v paměti stránky a nejvýše šest hodin. Po změně kódu nebo odebrání účtu se stará relace zneplatní.
- Apps Script omezuje neúspěšná přihlášení na pět pokusů pro jméno a šedesát pokusů za patnáct minut pro neznámá jména. Limity používají dočasnou cache a mohou se při jejím vyprázdnění uvolnit; Google Apps Script navíc neposkytuje této aplikaci spolehlivou IP adresu klienta. Ochrana proti automatizovanému hádání proto není tak robustní jako u specializovaného API. Šestimístné kódy předávej soukromě.
- Service worker ukládá do cache pouze veřejné soubory aplikace. Přihlašovací údaje, relace ani data třídy se do cache ani místního úložiště neukládají. Aplikaci lze otevřít i bez připojení, ale přihlášení a veškerá práce s daty vyžadují internet.
- Apps Script má kvóty a limity souběžných běhů; pro malou třídu obvykle postačí, ale nejde o službu s garantovanou dostupností.

Před ukládáním údajů nezletilých ověř pravidla školy a požadavky na ochranu osobních údajů pro použité služby.
