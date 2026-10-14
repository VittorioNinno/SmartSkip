# SMART SKIP

Estensione per browser (Chrome e Microsoft Edge) orientata all'automazione del salto delle introduzioni e dei riepiloghi sulle principali piattaforme di streaming, dotata di una libreria centralizzata per la persistenza delle preferenze.

---

## Architettura e Piattaforme

* **Piattaforme Supportate**: Crunchyroll, Netflix, Prime Video, Disney+.
* **Persistenza**: Utilizzo di `chrome.storage.local` per la memorizzazione delle regole e `Set` di sessione per la prevenzione dei salti duplicati.
* **Gestione DOM**: Polling ciclico (`setInterval`) ottimizzato per il rilevamento dei selettori e traversal ricorsivo dello Shadow DOM per la gestione di Disney+.

---

## Struttura del Modulo

* `manifest.json`: Configurazione Manifest V3 e dichiarazione dei permessi per i content scripts.
* `content.js`: Script di iniezione per il tracciamento dei nodi UI, l'estrazione dei metadati e l'esecuzione del trigger di salto.
* `popup.html` / `popup.js`: Interfaccia di controllo rapido per lo stato globale e la gestione della memoria.
* `options.html` / `options.js`: Dashboard di amministrazione delle serie registrate, dotata di filtri, ricerca e ordinamento.

---

## Installazione Locale

1. Clonare o scaricare il repository.
2. Aprire la pagina delle estensioni del browser (`edge://extensions` o `chrome://extensions`).
3. Abilitare la modalità sviluppatore.
4. Selezionare "Carica estensione decompressa" puntando alla directory di lavoro.

---

## Licenza

Distribuito sotto licenza MIT.
