# SMART SKIP

Estensione per browser (Chrome e Microsoft Edge) che salta automaticamente intro, riepiloghi, titoli di coda e anteprime sulle principali piattaforme di streaming. Ogni serie ha le sue regole, raccolte in una libreria consultabile e modificabile.

---

## Funzionalità

* **Quattro tipi di salto**: intro, riepilogo (*recap*), titoli di coda (*outro*) e anteprima (*preview*), ognuno con la propria regola per ogni serie.
* **Prima visione rispettata**: la prima volta che un tipo di segmento compare per una serie, viene registrato nella libreria e lasciato scorrere. Dalla volta successiva si applica la regola salvata.
* **Regole per serie**: per ogni tipo si sceglie "salta in automatico" oppure "non saltare mai".
* **Interruttori nel popup**: uno principale e uno per ciascun tipo di salto, con effetto immediato.
* **Libreria**: serie raggruppate per piattaforma, con ricerca, filtro per piattaforma e ordinamento A-Z / Z-A.

---

## Piattaforme supportate

| Piattaforma | Intro | Riepilogo | Titoli di coda | Anteprima |
|---|:---:|:---:|:---:|:---:|
| Crunchyroll | ✓ | ✓ | ✓ | ✓ |
| Netflix | ✓ | – | – | – |
| Prime Video | ✓ | – | – | – |
| Disney+ | ✓ | – | – | – |

I selettori di Crunchyroll usano le etichette italiane (`aria-label`). Quelle inglesi sono ipotesi non ancora verificate.

---

## Architettura

* **Piattaforme guidate da configurazione**: l'array `PLATFORMS` in `content.js` descrive ogni servizio (`id`, `label`, `hostnames`, `skipButtons`, `getTitle`). Aggiungere un servizio significa aggiungere una voce, senza toccare la logica.
* **Polling**: un ciclo da 800 ms cerca i pulsanti dei tipi supportati dalla piattaforma. Viene gestito al massimo un pulsante nuovo per ciclo, per evitare scritture concorrenti sullo stesso record.
* **Pulsanti nascosti**: alcuni siti (Crunchyroll) tengono i pulsanti nel DOM e li nascondono. Un pulsante non visibile (opacità 0, `display: none`, `pointer-events: none`) conta come assente; il click parte solo se è visibile.
* **Protezione della prima visione**: dopo la registrazione di un tipo, per 3 minuti e nello stesso episodio (stesso `pathname` della pagina) non viene saltato nulla. Così un pulsante ridisegnato dal sito non viene scambiato per un segmento nuovo, mentre l'episodio successivo viene gestito normalmente.
* **Disney+**: il pulsante si trova in due Shadow DOM annidati e viene raggiunto con un percorso diretto (`skip-overlay` › `skip-button` › `button`), senza scansioni dell'intero documento.
* **Persistenza**: `chrome.storage.local`.

### Dati salvati

| Chiave | Contenuto |
|---|---|
| `isExtensionEnabled` | Interruttore principale (`true` / `false`) |
| `enabledSkipTypes` | Interruttori per tipo, es. `{ "intro": true, "recap": false }` (un tipo assente conta come attivo) |
| `series_<piattaforma>_<titolo>` | Record di una serie (vedi sotto) |

```json
{
  "title": "The Faraway Paladin",
  "platform": "CRUNCHYROLL",
  "rules": { "intro": "auto_skip", "recap": "never_skip", "outro": "auto_skip" }
}
```

I tipi compaiono in `rules` solo dopo essere stati incontrati. Le regole possibili sono `auto_skip` e `never_skip`.

---

## Struttura del progetto

* `manifest.json`: Manifest V3, permesso `storage`, content script sulle piattaforme supportate.
* `content.js`: rilevamento della piattaforma, ricerca dei pulsanti, lettura del titolo, registrazione e applicazione delle regole.
* `popup.html` / `popup.js`: interruttore principale, interruttori per tipo, accesso alla libreria e azzeramento della memoria (con conferma).
* `options.html` / `options.js`: libreria delle serie registrate.
* `icon.png`: icona dell'estensione.

I nomi nel codice sono in inglese, mentre i testi dell'interfaccia sono in italiano.

---

## Aggiungere una piattaforma

1. Aggiungere il pattern dell'indirizzo in `content_scripts.matches` di `manifest.json`.
2. Aggiungere una voce all'array `PLATFORMS` in `content.js`:

```js
{
    id: 'nomeservizio',          // usato nella chiave di storage: non cambiarlo dopo il rilascio
    label: 'NOME SERVIZIO',      // mostrato nella libreria
    hostnames: ['nomeservizio.com'],
    skipButtons: {
        [SKIP_TYPES.INTRO]: 'button.skip-intro',   // selettore CSS...
        [SKIP_TYPES.OUTRO]: () => /* ...oppure funzione che restituisce l'elemento */ null
    },
    getTitle: () => document.querySelector('.titolo')?.textContent?.trim() || null
}
```

3. Aggiungere il filtro nel menu delle piattaforme in `options.html` (il valore è l'etichetta in minuscolo).

---

## Installazione locale

1. Clonare o scaricare il repository.
2. Aprire la pagina delle estensioni del browser (`edge://extensions` o `chrome://extensions`).
3. Abilitare la modalità sviluppatore.
4. Selezionare "Carica estensione decompressa" puntando alla directory di lavoro.

Dopo ogni modifica ai file: ricaricare l'estensione dalla stessa pagina e **ricaricare anche le schede** dei siti di streaming, perché quelle già aperte continuano a usare il vecchio `content.js`.

---

## Limiti noti

* Se si ricarica la scheda a metà di un segmento appena registrato, quel segmento viene saltato (la protezione vive solo nella pagina).
* L'episodio è riconosciuto dal percorso dell'indirizzo: se un sito non lo cambia tra un episodio e l'altro, serve un identificatore specifico per quella piattaforma.
* I selettori dipendono dalle pagine dei servizi, che possono cambiare senza preavviso.

---

## Licenza

Distribuito sotto licenza MIT.