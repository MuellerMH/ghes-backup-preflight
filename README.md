# ghes-backup-preflight

Ein Snapshot-Verzeichnis von GitHub Enterprise Server `backup-utils`
(`ghe-backup`) sieht auf den ersten Blick vollständig aus — und ist es beim
genaueren Hinsehen oft nicht: ein fehlender Datenbank-Dump, eine Zielversion
außerhalb des erlaubten Restore-Fensters oder ein kaputtes `repositories/`-
Verzeichnis fallen sonst erst während der eigentlichen Migration oder im
Ernstfall-Restore auf. `ghes-backup-preflight` prüft einen Snapshot vorher,
lokal und ohne Netzwerkzugriff, auf genau diese drei Dinge.

## Installation

```bash
npm install -g .
```

oder direkt aus dem geklonten Repo, ohne Installation:

```bash
node bin/ghes-backup-preflight.js <pfad-zum-snapshot-verzeichnis>
```

Voraussetzung: Node.js >= 18. Keine externen Abhängigkeiten.

## Benutzung

```bash
ghes-backup-preflight <pfad-zum-snapshot-verzeichnis> [--target-version X.Y] [--json]
```

### Beispiel

```bash
$ ghes-backup-preflight /backups/ghe-20261024/ --target-version 3.21
✓ [PASS] version vorhanden
✓ [PASS] settings.json vorhanden
✓ [PASS] uuid vorhanden
✓ [PASS] strategy vorhanden
✓ [PASS] repositories vorhanden
✓ [PASS] storage vorhanden
ℹ [INFO] pages nicht vorhanden (optional, nicht jede Instanz hat Pages aktiv)
✓ [PASS] Snapshot 3.20 kann auf Ziel 3.21 zurückgespielt werden (Delta 1)
✓ [PASS] logischer Datenbank-Dump vorhanden: mysql.sql.gz

Ergebnis: PASS – Snapshot ist migrationsbereit.
```

Exit Code `0`, wenn keine Prüfung FAIL ergibt, sonst `1`. Mit `--json` liefert
das Tool stattdessen ein maschinenlesbares Objekt `{ "checks": [...], "ok":
true|false }` auf stdout, für den Einsatz in Skripten oder CI.

Ohne `--target-version` wird nur die gefundene Snapshot-Version als INFO
ausgegeben, ohne Bewertung gegen eine Zielversion.

## Was geprüft wird

1. **Vollständigkeit** — die Pflichteinträge eines gültigen Snapshots:
   `version`, `settings.json`, `uuid`, `strategy`, `repositories/`,
   `storage/`. Jeder fehlende Eintrag ist ein FAIL. `pages/` ist optional
   (nicht jede Instanz hat GitHub Pages aktiv) und fehlt daher nur als INFO.
2. **Versionskompatibilität** — ein Restore ist laut GitHub-Dokumentation nur
   von einer Snapshot-Version X auf eine Zielinstanz mit Feature-Version X,
   X+1 oder X+2 möglich (z. B. 3.20 → 3.20/3.21/3.22), niemals auf eine
   ältere Zielversion und niemals mehr als zwei Feature-Versionen voraus. Die
   Patch-Version (dritte Zahl) spielt für diese Regel keine Rolle.
3. **Datenbank-Dump-Präsenz** — entweder der logische Dump (`mysql.sql.gz`)
   oder beide Dateien des binären xtrabackup-Dumps
   (`xtrabackup_checkpoints` und `mysql-binary-backup-sentinel`) müssen
   vorhanden sein.

## Warum das wichtig ist

Das Restore-Versionsfenster (X/X+1/X+2) ist in der offiziellen GitHub-
Dokumentation festgelegt und gilt unabhängig davon, wie frisch oder
vollständig ein Snapshot sonst aussieht — eine Zielinstanz außerhalb dieses
Fensters lässt den Restore scheitern, egal wie sauber die restlichen Dateien
sind. Ein fehlender oder unvollständiger Datenbank-Dump ist dabei eine der
häufigsten Überraschungen, weil er sich von der reinen Dateigröße des
Snapshots aus nicht erkennen lässt.

## Bekannte Grenze

Version 1 prüft nur Verzeichnis-Snapshots, so wie `ghe-backup` sie ablegt. Ein
noch gepacktes TAR-Export-Archiv wird nicht automatisch entpackt — das Tool
gibt dafür eine klare Fehlermeldung aus und verweist auf `tar xf <datei>` zum
vorherigen Entpacken, statt mit einem unklaren Fehler abzubrechen.

## Von GitSecOps / MHM Digitale Lösungen

`ghes-backup-preflight` wird von GitSecOps (MHM Digitale Lösungen UG)
bereitgestellt; ein Erstgespräch lässt sich über den entsprechenden Button
auf [gitsecops.de](https://gitsecops.de) vereinbaren.

## Lizenz

MIT, siehe [LICENSE](LICENSE).

## Disclaimer

Dies ist kein offizielles GitHub-Produkt und steht in keiner Verbindung zu
GitHub, Inc. Es handelt sich um ein inoffizielles Hilfsmittel ohne jede
Zusicherung von Richtigkeit oder Eignung für einen bestimmten Zweck. Vor
einer echten Migration oder einem Restore bleibt die offizielle
GitHub-Enterprise-Server-Dokumentation die maßgebliche Quelle.
