'use strict';

const fs = require('fs');
const path = require('path');

// Pflichteinträge eines validen backup-utils-Snapshots (ghe-backup).
// pages/ ist bewusst NICHT hier drin, da optional (nicht jede Instanz hat Pages aktiv).
const REQUIRED_ENTRIES = ['version', 'settings.json', 'uuid', 'strategy', 'repositories', 'storage'];

const OPTIONAL_DIR_ENTRIES = ['pages'];

const LOGICAL_DUMP_FILE = 'mysql.sql.gz';
const BINARY_DUMP_FILES = ['xtrabackup_checkpoints', 'mysql-binary-backup-sentinel'];

/**
 * Baut ein Check-Ergebnisobjekt. status ist 'PASS' | 'FAIL' | 'INFO'.
 */
function result(name, status, message) {
  return { name, status, message };
}

/**
 * Prüfung 1: Vollständigkeit des Snapshot-Verzeichnisses.
 * Jeder fehlende Pflichteintrag ergibt ein eigenes FAIL mit Dateiname.
 * Ein fehlendes pages/ ergibt ein INFO, kein FAIL (optional).
 *
 * @param {string} snapshotDir Pfad zum Snapshot-Verzeichnis
 * @returns {Array<object>} Liste von Check-Ergebnissen
 */
function checkCompleteness(snapshotDir) {
  const results = [];

  for (const entry of REQUIRED_ENTRIES) {
    const entryPath = path.join(snapshotDir, entry);
    if (fs.existsSync(entryPath)) {
      results.push(result(`completeness:${entry}`, 'PASS', `${entry} vorhanden`));
    } else {
      results.push(result(`completeness:${entry}`, 'FAIL', `Pflichteintrag fehlt: ${entry}`));
    }
  }

  for (const entry of OPTIONAL_DIR_ENTRIES) {
    const entryPath = path.join(snapshotDir, entry);
    if (fs.existsSync(entryPath)) {
      results.push(result(`completeness:${entry}`, 'PASS', `${entry} vorhanden (optional)`));
    } else {
      results.push(result(`completeness:${entry}`, 'INFO', `${entry} nicht vorhanden (optional, nicht jede Instanz hat Pages aktiv)`));
    }
  }

  return results;
}

/**
 * Liest die Snapshot-Versionsdatei und extrahiert Major.Minor.
 *
 * @param {string} snapshotDir Pfad zum Snapshot-Verzeichnis
 * @returns {{raw: string, major: number, minor: number}|null} null, wenn die Datei fehlt oder nicht lesbar ist
 */
function readSnapshotVersion(snapshotDir) {
  const versionFile = path.join(snapshotDir, 'version');
  if (!fs.existsSync(versionFile)) {
    return null;
  }
  const raw = fs.readFileSync(versionFile, 'utf8').trim();
  const match = raw.match(/^(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return { raw, major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Prüfung 2: Versionskompatibilität.
 * Ohne targetVersion: nur INFO mit der gefundenen Snapshot-Version.
 * Mit targetVersion: Restore ist nur gültig, wenn Major gleich bleibt und die
 * Ziel-Feature-Version (zweite Zahl) zwischen 0 und 2 über der Snapshot-Feature-Version liegt
 * (nie älter als der Snapshot, nie mehr als zwei Feature-Versionen voraus).
 *
 * @param {string} snapshotDir Pfad zum Snapshot-Verzeichnis
 * @param {string|undefined} targetVersion z.B. "3.21"
 * @returns {Array<object>} Liste von Check-Ergebnissen
 */
function checkVersionCompatibility(snapshotDir, targetVersion) {
  const version = readSnapshotVersion(snapshotDir);

  if (!version) {
    return [result('version:read', 'FAIL', 'version-Datei fehlt oder konnte nicht gelesen werden')];
  }

  if (!targetVersion) {
    return [result('version:info', 'INFO', `gefundene Snapshot-Version: ${version.major}.${version.minor}`)];
  }

  const targetMatch = String(targetVersion).match(/^(\d+)\.(\d+)/);
  if (!targetMatch) {
    return [result('version:compat', 'FAIL', `--target-version ungültig: ${targetVersion}`)];
  }
  const targetMajor = Number(targetMatch[1]);
  const targetMinor = Number(targetMatch[2]);

  if (targetMajor !== version.major) {
    return [result(
      'version:compat',
      'FAIL',
      `andere Hauptversion: Snapshot ${version.major}.${version.minor}, Ziel ${targetMajor}.${targetMinor}`
    )];
  }

  const delta = targetMinor - version.minor;

  if (delta < 0) {
    return [result(
      'version:compat',
      'FAIL',
      `Zielversion ${targetMajor}.${targetMinor} ist älter als Snapshot-Version ${version.major}.${version.minor}`
    )];
  }

  if (delta > 2) {
    return [result(
      'version:compat',
      'FAIL',
      `Zielversion ${targetMajor}.${targetMinor} ist mehr als zwei Feature-Versionen vor Snapshot-Version ${version.major}.${version.minor} (Delta ${delta})`
    )];
  }

  return [result(
    'version:compat',
    'PASS',
    `Snapshot ${version.major}.${version.minor} kann auf Ziel ${targetMajor}.${targetMinor} zurückgespielt werden (Delta ${delta})`
  )];
}

/**
 * Prüfung 3: Datenbank-Dump-Präsenz.
 * Entweder logischer Dump (mysql.sql.gz) oder beide Dateien des binären
 * xtrabackup-Dumps müssen vorhanden sein.
 *
 * @param {string} snapshotDir Pfad zum Snapshot-Verzeichnis
 * @returns {Array<object>} Liste mit genau einem Check-Ergebnis
 */
function checkDatabaseDump(snapshotDir) {
  const hasLogical = fs.existsSync(path.join(snapshotDir, LOGICAL_DUMP_FILE));
  const hasBinary = BINARY_DUMP_FILES.every((file) => fs.existsSync(path.join(snapshotDir, file)));

  if (hasLogical) {
    return [result('database:dump', 'PASS', `logischer Datenbank-Dump vorhanden: ${LOGICAL_DUMP_FILE}`)];
  }

  if (hasBinary) {
    return [result('database:dump', 'PASS', `binärer Datenbank-Dump vorhanden: ${BINARY_DUMP_FILES.join(', ')}`)];
  }

  return [result('database:dump', 'FAIL', 'kein Datenbank-Dump gefunden')];
}

module.exports = {
  REQUIRED_ENTRIES,
  OPTIONAL_DIR_ENTRIES,
  LOGICAL_DUMP_FILE,
  BINARY_DUMP_FILES,
  readSnapshotVersion,
  checkCompleteness,
  checkVersionCompatibility,
  checkDatabaseDump,
};
