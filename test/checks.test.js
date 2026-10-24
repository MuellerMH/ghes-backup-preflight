'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  checkCompleteness,
  checkVersionCompatibility,
  checkDatabaseDump,
} = require('../src/checks');

/**
 * Baut ein erfundenes, vollständiges Snapshot-Verzeichnis unter einem frischen
 * temp dir und gibt dessen Pfad zurück. opts erlaubt gezieltes Weglassen/
 * Überschreiben von Einträgen für die einzelnen Testfälle.
 */
function makeSnapshot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghes-backup-preflight-test-'));

  const entries = {
    version: '3.20.3',
    'settings.json': '{}',
    uuid: 'test-uuid-0000',
    strategy: 'rsync',
    ...opts.files,
  };

  const dirs = ['repositories', 'storage', ...(opts.extraDirs || [])];
  const skipDirs = new Set(opts.skipDirs || []);
  const skipFiles = new Set(opts.skipFiles || []);

  for (const [name, content] of Object.entries(entries)) {
    if (skipFiles.has(name)) continue;
    fs.writeFileSync(path.join(dir, name), content);
  }

  for (const name of dirs) {
    if (skipDirs.has(name)) continue;
    fs.mkdirSync(path.join(dir, name));
  }

  if (opts.logicalDump !== false) {
    fs.writeFileSync(path.join(dir, 'mysql.sql.gz'), 'fake-dump-bytes');
  }

  return dir;
}

function statusesByName(results) {
  return Object.fromEntries(results.map((r) => [r.name, r.status]));
}

test('vollständiger Snapshot mit logischem Dump -> alle PASS/INFO, keine FAILs', () => {
  const dir = makeSnapshot();
  const results = checkCompleteness(dir);
  assert.ok(results.every((r) => r.status !== 'FAIL'), JSON.stringify(results));

  const dbResults = checkDatabaseDump(dir);
  assert.equal(dbResults.length, 1);
  assert.equal(dbResults[0].status, 'PASS');
});

test('vollständiger Snapshot mit binärem Dump -> PASS', () => {
  const dir = makeSnapshot({ logicalDump: false });
  fs.writeFileSync(path.join(dir, 'xtrabackup_checkpoints'), 'checkpoint');
  fs.writeFileSync(path.join(dir, 'mysql-binary-backup-sentinel'), 'sentinel');

  const dbResults = checkDatabaseDump(dir);
  assert.equal(dbResults.length, 1);
  assert.equal(dbResults[0].status, 'PASS');
});

test('weder logischer noch binärer Dump -> FAIL', () => {
  const dir = makeSnapshot({ logicalDump: false });

  const dbResults = checkDatabaseDump(dir);
  assert.equal(dbResults.length, 1);
  assert.equal(dbResults[0].status, 'FAIL');
  assert.match(dbResults[0].message, /kein Datenbank-Dump gefunden/);
});

test('nur eine der beiden binären Dump-Dateien -> FAIL (unvollständiges Paar zählt nicht)', () => {
  const dir = makeSnapshot({ logicalDump: false });
  fs.writeFileSync(path.join(dir, 'xtrabackup_checkpoints'), 'checkpoint');
  // mysql-binary-backup-sentinel fehlt bewusst

  const dbResults = checkDatabaseDump(dir);
  assert.equal(dbResults[0].status, 'FAIL');
});

test('fehlende Pflichtdatei (uuid) wird als FAIL erkannt', () => {
  const dir = makeSnapshot({ skipFiles: ['uuid'] });
  const results = statusesByName(checkCompleteness(dir));
  assert.equal(results['completeness:uuid'], 'FAIL');
  // alle anderen Pflichteinträge bleiben PASS
  assert.equal(results['completeness:version'], 'PASS');
  assert.equal(results['completeness:repositories'], 'PASS');
});

test('fehlendes repositories/-Verzeichnis wird als FAIL erkannt', () => {
  const dir = makeSnapshot({ skipDirs: ['repositories'] });
  const results = statusesByName(checkCompleteness(dir));
  assert.equal(results['completeness:repositories'], 'FAIL');
});

test('fehlendes pages/ ergibt INFO statt FAIL (optional)', () => {
  const dir = makeSnapshot();
  const results = statusesByName(checkCompleteness(dir));
  assert.equal(results['completeness:pages'], 'INFO');
});

test('vorhandenes pages/ ergibt PASS', () => {
  const dir = makeSnapshot({ extraDirs: ['pages'] });
  const results = statusesByName(checkCompleteness(dir));
  assert.equal(results['completeness:pages'], 'PASS');
});

test('Versions-Check ohne --target-version gibt nur INFO mit gefundener Version', () => {
  const dir = makeSnapshot({ files: { version: '3.20.3' } });
  const results = checkVersionCompatibility(dir, undefined);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'INFO');
  assert.match(results[0].message, /3\.20/);
});

test('Versions-Check Delta 0 -> PASS', () => {
  const dir = makeSnapshot({ files: { version: '3.20.3' } });
  const results = checkVersionCompatibility(dir, '3.20');
  assert.equal(results[0].status, 'PASS');
});

test('Versions-Check Delta 1 -> PASS', () => {
  const dir = makeSnapshot({ files: { version: '3.20.3' } });
  const results = checkVersionCompatibility(dir, '3.21');
  assert.equal(results[0].status, 'PASS');
});

test('Versions-Check Delta 2 -> PASS', () => {
  const dir = makeSnapshot({ files: { version: '3.20.3' } });
  const results = checkVersionCompatibility(dir, '3.22');
  assert.equal(results[0].status, 'PASS');
});

test('Versions-Check Delta 3 -> FAIL (mehr als zwei Feature-Versionen voraus)', () => {
  const dir = makeSnapshot({ files: { version: '3.20.3' } });
  const results = checkVersionCompatibility(dir, '3.23');
  assert.equal(results[0].status, 'FAIL');
  assert.match(results[0].message, /mehr als zwei/);
});

test('Versions-Check Zielversion älter als Snapshot -> FAIL', () => {
  const dir = makeSnapshot({ files: { version: '3.20.3' } });
  const results = checkVersionCompatibility(dir, '3.19');
  assert.equal(results[0].status, 'FAIL');
  assert.match(results[0].message, /älter/);
});

test('Versions-Check andere Hauptversion -> FAIL', () => {
  const dir = makeSnapshot({ files: { version: '3.20.3' } });
  const results = checkVersionCompatibility(dir, '4.0');
  assert.equal(results[0].status, 'FAIL');
  assert.match(results[0].message, /Hauptversion/);
});

test('fehlende version-Datei -> FAIL beim Versions-Check', () => {
  const dir = makeSnapshot({ skipFiles: ['version'] });
  const results = checkVersionCompatibility(dir, '3.20');
  assert.equal(results[0].status, 'FAIL');
});
