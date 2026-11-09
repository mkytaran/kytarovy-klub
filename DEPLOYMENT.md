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

Tato adresa musí přesně odpovídat vlastnosti `APP_URL` v Apps Scriptu. Přímé otevření stránky na GitHub Pages zobrazí výzvu k použití odkazu Apps Scriptu; přihlašování funguje pouze přes nasazenou webovou aplikaci.

## 3. Nasaď Apps Script

1. V Apps Scriptu klikni na **Nasadit → Nové nasazení** a jako typ vyber **Webová aplikace**.
2. Nastav **Spustit jako: Já** a přístup pro **Kdokoli**. Díky tomu žáci nepotřebují Google účet; jejich oprávnění ověřuje aplikace. Pokud pravidla účtu nebo školy veřejný přístup nedovolují, nasazení takto nepůjde použít.
3. Nasaď aplikaci a otevři vygenerovanou URL končící `/exec`. Tu předej žákům; jde o jediný správný vstup do aplikace.
4. Při změnách serverového kódu vytvoř nové nasazení nebo uprav existující nasazení na novou verzi. Změny `Host.html` na GitHub Pages se zveřejňují běžným způsobem.

## Soukromí a omezení

- Tabulka musí zůstat soukromá. Přístup k ní má vlastník Apps Scriptu; nesdílej ji se žáky.
- Kódy mají přesně šest číslic. Aplikace ukládá HMAC otisky chráněné `PIN_PEPPER`, nikoli čitelné kódy.
- Žáci vidí své zápisy a třídní žebříček; učitel vidí historii celé třídy a spravuje žáky.
- Přihlášení se uchovává pouze v paměti stránky a nejvýše šest hodin. Po změně kódu nebo odebrání účtu se stará relace zneplatní.
- Apps Script omezuje neúspěšná přihlášení na pět pokusů pro jméno a šedesát pokusů za patnáct minut pro neznámá jména. Limity používají dočasnou cache a mohou se při jejím vyprázdnění uvolnit; Google Apps Script navíc neposkytuje této aplikaci spolehlivou IP adresu klienta. Ochrana proti automatizovanému hádání proto není tak robustní jako u specializovaného API. Šestimístné kódy předávej soukromě.
- Data se záměrně neukládají do offline cache. V tomto nasazení se stránka GitHub Pages zobrazuje uvnitř Apps Scriptu; instalace jako samostatná PWA a offline provoz nejsou zaručené. Aplikace potřebuje internet.
- Apps Script má kvóty a limity souběžných běhů; pro malou třídu obvykle postačí, ale nejde o službu s garantovanou dostupností.

Před ukládáním údajů nezletilých ověř pravidla školy a požadavky na ochranu osobních údajů pro použité služby.
