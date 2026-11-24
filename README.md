# Distinta acciaio – estensione per Trimble Connect

Estensione per il **visualizzatore 3D di Trimble Connect**. Legge gli elementi di carpenteria metallica del modello IFC caricato e offre:

- **Distinte**: per profilo, per famiglia, piatti per spessore e bulloneria. Il peso è diviso in profilati leggeri, pesanti e molto pesanti, profili saldati e piatti.
- **Report**:
  - un PDF con grafici e immagini del modello colorato per categoria e per gruppo;
  - un Excel con tutte le tabelle.
- **Assemblati / sciolti**:
  - selezioni nel modello una trave, delle piastre o un intero assieme e li assegni al gruppo **Assemblati**, **Sciolti** o **Scale/altro**;
  - il modello si colora per gruppo e i pesi si aggiornano subito.

Il programma non modifica il modello.

---

## 1. Pubblicare su GitHub (una volta sola)

1. Su GitHub crea un nuovo repository **pubblico**, per esempio `distinta-acciaio`. GitHub Pages gratuito funziona solo con i repository pubblici.
2. Carica tutti i file di questa cartella, comprese le cartelle `js`, `vendor`, `demo` e `.github`.
   - Il modo più semplice è **Add file → Upload files**, trascinando dentro il *contenuto* della cartella.
   - La cartella `.github` è nascosta: su Windows attiva «Elementi nascosti» in Esplora file, su Mac premi `Cmd+Maiusc+.`.
3. Vai in **Settings → Pages** e alla voce **Source** scegli **GitHub Actions**.
4. Vai nella scheda **Actions**: dopo un minuto circa il processo «Pubblica su GitHub Pages» diventa verde. Il manifest viene scritto automaticamente con l’indirizzo giusto.

L’indirizzo del manifest sarà:

```
https://TUO-UTENTE.github.io/distinta-acciaio/manifest.json
```

> **Se la cartella `.github` non viene caricata**: in Settings → Pages scegli **Deploy from a branch** (ramo `main`, cartella `/root`). Poi apri `manifest.json` su GitHub, premi la matita e sostituisci `TUO-UTENTE` e `NOME-REPOSITORY` con i tuoi valori in tutte e tre le righe.

Per provarla senza Trimble Connect apri `https://TUO-UTENTE.github.io/distinta-acciaio/demo/`. È un simulatore del visualizzatore con un modello di esempio, e puoi caricare anche un tuo file IFC.

## 2. Aggiungerla al progetto Trimble Connect

Serve essere **amministratore del progetto**.

1. Apri il progetto in Trimble Connect per browser.
2. **Impostazioni → App e funzionalità** (*Settings → Apps & Capabilities*) → **+ Aggiungi personalizzata** (*Add Custom*).
3. Incolla l’indirizzo del `manifest.json` e conferma.
4. Apri un modello nel visualizzatore 3D: «Distinta acciaio» compare tra le estensioni del pannello laterale.

## 3. Uso

- **Aggiorna** rilegge gli oggetti dei modelli caricati. Usalo quando carichi o togli un modello.
- **Distinta**: un clic su una riga seleziona e inquadra quegli elementi nel modello.
- **Assemblati/sciolti**:
  - selezioni nel modello e premi **Assemblati**, **Sciolti**, **Scale/altro** o **Togli**. Se selezioni un assieme, vengono assegnate tutte le sue parti;
  - **piastre a contatto** aggiunge alla selezione le piastre il cui ingombro tocca gli elementi selezionati. È approssimato: controlla prima di assegnare;
  - **stesso profilo** aggiunge tutti gli elementi con lo stesso profilo;
  - **Seleziona** / **Solo questi** su ogni gruppo lo selezionano o lo isolano nel modello. **Mostra tutto** ripristina la vista;
  - in «Opzioni e assegnazioni» scegli come contare i non assegnati, e puoi esportare, importare o cancellare le assegnazioni.
- **Report**: PDF, Excel e CSV. Le immagini del modello usano l’inquadratura attuale del visualizzatore.

### Nascondere, annullare, salvare

- Con **«Nascondi dopo l’assegnazione»** attivo, ogni pezzo assegnato sparisce dal modello, così vedi cosa resta da fare. **Nascondi assegnati** nasconde tutti quelli già fatti, **Mostra tutto** li fa ricomparire.
- **↶ Annulla** (oppure **Ctrl+Z** con il pannello attivo) annulla l’ultima assegnazione, fino a 100 passi. I pezzi ricompaiono e tornano selezionati nel modello.
- Le assegnazioni si salvano da sole, dopo ogni modifica:
  - **nel browser**;
  - **nel progetto Trimble Connect**, come file `Distinta acciaio - assegnazioni.json` nella cartella principale. Al primo uso Trimble Connect chiede il permesso di accesso. Così le ritrovi su qualsiasi computer e le vedono anche i colleghi.
- Le assegnazioni sono legate all’identificativo IFC (GUID), quindi restano valide anche con una nuova versione del modello.
- **Esporta / Importa assegnazioni** resta disponibile come copia di sicurezza.

### Da dove arrivano i dati

L’estensione legge le proprietà IFC degli oggetti tramite la Workspace API di Trimble Connect:

- **profilo**: proprietà come *Profile* o *ProfileName*, oppure il nome dell’oggetto;
- **peso**: *Weight*, *Net weight*, *Mass*;
- **altri dati**: volume, lunghezza, materiale, marca.

Le unità vengono controllate con un catalogo profili (HEA, HEB, HEM, IPE, UPN, UPE, IPN, tubi, angolari) e, se il peso è sbagliato di un fattore 1000, viene corretto e segnalato.

Quando un elemento non ha né peso né volume, il peso è stimato da sezione × lunghezza.

---

File principali: `index.html` (interfaccia), `js/tcdata.js` (lettura da Trimble Connect), `js/core.js` (calcoli e catalogo), `js/app.js` (interfaccia, colori, report), `manifest.json`, `demo/` (simulatore).
