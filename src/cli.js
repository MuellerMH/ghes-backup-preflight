'use strict';

const fs = require('fs');
const {
  checkCompleteness,
  checkVersionCompatibility,
  checkDatabaseDump,
} = require('./checks');

const USAGE = 'Usage: ghes-backup-preflight <pfad-zum-snapshot-verzeichnis> [--target-version X.Y] [--json]';

/**
 * Parst argv (ohne 'node' und Skriptpfad) in { snapshotDir, targetVersion, json, help }.
 * Wirft einen Error mit lesbarer Meldung bei ungültigen Argumenten.
 */
function parseArgs(argv) {
  const args = { snapshotDir: null, targetVersion: undefined, json: false, help: false };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--target-version') {
      i += 1;
      args.targetVersion = argv[i];
      if (!args.targetVersion) {
        throw new Error('--target-version benötigt einen Wert, z.B. --target-version 3.21');
      }
    } else if (arg.startsWith('--target-version=')) {
      args.targetVersion = arg.slice('--target-version='.length);
    } else {
      positional.push(arg);
    }
  }

  if (!args.help) {
    if (positional.length === 0) {
      throw new Error(`Pfad zum Snapshot-Verzeichnis fehlt.\n${USAGE}`);
    }
    args.snapshotDir = positional[0];
  }

  return args;
}

/**
 * Führt alle drei Prüfungen gegen das Snapshot-Verzeichnis aus und liefert
 * { checks, ok }. Setzt voraus, dass snapshotDir existiert und ein Verzeichnis ist.
 */
function runPreflight(snapshotDir, targetVersion) {
  const checks = [
    ...checkCompleteness(snapshotDir),
    ...checkVersionCompatibility(snapshotDir, targetVersion),
    ...checkDatabaseDump(snapshotDir),
  ];
  const ok = checks.every((check) => check.status !== 'FAIL');
  return { checks, ok };
}

function statusSymbol(status) {
  if (status === 'PASS') return '✓';
  if (status === 'INFO') return 'ℹ';
  return '✗';
}

function printReport(report) {
  for (const check of report.checks) {
    console.log(`${statusSymbol(check.status)} [${check.status}] ${check.message}`);
  }
  console.log('');
  console.log(report.ok ? 'Ergebnis: PASS – Snapshot ist migrationsbereit.' : 'Ergebnis: FAIL – Snapshot ist nicht migrationsbereit, siehe FAILs oben.');
}

/**
 * Einstiegspunkt der CLI. Gibt den Exit-Code zurück (0 = alle Prüfungen PASS/INFO, 1 sonst).
 */
function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  if (!fs.existsSync(args.snapshotDir)) {
    console.error(`Pfad nicht gefunden: ${args.snapshotDir}`);
    return 1;
  }

  const stat = fs.statSync(args.snapshotDir);
  if (!stat.isDirectory()) {
    console.error(
      `${args.snapshotDir} ist keine Verzeichnis-Snapshot, sondern eine Datei.\n` +
      'Nur Verzeichnis-Snapshots unterstützt, TAR-Export vorher entpacken (tar xf <datei>).'
    );
    return 1;
  }

  const report = runPreflight(args.snapshotDir, args.targetVersion);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  return report.ok ? 0 : 1;
}

module.exports = { main, parseArgs, runPreflight };
