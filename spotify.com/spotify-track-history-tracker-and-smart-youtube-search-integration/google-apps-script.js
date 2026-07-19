var SHEET_NAME_SPOTIFY = "Spotify";
var SHEET_NAME_SOUNDCLOUD = "SoundCloud";
var SHEET_NAMES = [SHEET_NAME_SPOTIFY, SHEET_NAME_SOUNDCLOUD];

function doGet(e) {
  var source = normalizeSource(e && e.parameter && e.parameter.source);
  if (!source) {
    return jsonError(400, "Missing or invalid 'source' parameter (expected 'spotify' or 'soundcloud')");
  }

  var sheet;
  try {
    sheet = getSourceSheet(source);
  } catch (err) {
    return jsonError(500, "Failed to open sheet: " + err.toString());
  }

  try {
    migrateSourceSheetIds(sheet, source);
  } catch (err) {
    // migration is best-effort; don't fail the read
  }

  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    return jsonResponse(JSON.stringify([]));
  }

  var data = sheet.getRange(1, 1, lastRow, 1).getValues();
  var ids = [];
  for (var i = 0; i < data.length; i++) {
    var raw = data[i][0];
    var id = canonicalizeTrackId(raw, source);
    if (id) ids.push(id);
  }
  return jsonResponse(JSON.stringify(ids));
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonError(503, "Server busy - could not acquire lock within 10s");
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonError(400, "Empty request body");
    }
    var params;
    try {
      params = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonError(400, "Invalid JSON: " + parseErr.toString());
    }
    if (!params || typeof params !== "object") {
      return jsonError(400, "Request body must be a JSON object");
    }

    var rawTargetId = params.id;
    var action = params.action || "add";
    var source = normalizeSource(params.source) || inferSourceFromId(rawTargetId);
    if (!source) {
      return jsonError(400, "Missing 'source' and could not infer from id");
    }
    if (action !== "add" && action !== "remove") {
      return jsonError(400, "Invalid action: " + action + " (expected 'add' or 'remove')");
    }

    var targetId = canonicalizeTrackId(rawTargetId, source);
    if (!targetId) {
      return jsonError(400, "Missing or empty 'id'");
    }

    var sheet = getSourceSheet(source);
    migrateSourceSheetIds(sheet, source);

    var foundCell = findTrackCell(sheet, targetId, source);

    if (action === "remove") {
      if (foundCell) {
        sheet.deleteRow(foundCell.getRow());
        return jsonResponse(JSON.stringify({ status: "deleted", id: targetId }));
      }
      return jsonResponse(JSON.stringify({ status: "not_found", id: targetId }));
    }

    // action === "add"
    if (foundCell) {
      if (String(foundCell.getValue() || "") !== targetId) {
        foundCell.setValue(targetId);
      }
      updateRowTimestamp(sheet, foundCell.getRow());
      return jsonResponse(JSON.stringify({ status: "updated", id: targetId }));
    }

    sheet.appendRow([targetId, params.name || "", new Date()]);
    return jsonResponse(JSON.stringify({ status: "inserted", id: targetId }));

  } catch (err) {
    return jsonError(500, err.toString());
  } finally {
    lock.releaseLock();
  }
}

function updateRowTimestamp(sheet, rowNumber) {
  var maxColumn = sheet.getMaxColumns();
  if (maxColumn < 3) {
    sheet.insertColumnsAfter(maxColumn, 3 - maxColumn);
  }
  sheet.getRange(rowNumber, 3).setValue(new Date());
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(status, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "error", code: status, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeSource(source) {
  source = String(source || "").toLowerCase().trim();
  if (source === "spotify" || source === "soundcloud") return source;
  return "";
}

function inferSourceFromId(targetId) {
  targetId = String(targetId || "");
  if (targetId.indexOf("soundcloud:") === 0) return "soundcloud";
  if (targetId.indexOf("/") === 0 || targetId.indexOf("soundcloud:") === 0) return "soundcloud";
  return "spotify";
}

function canonicalizeTrackId(targetId, source) {
  targetId = String(targetId || "").trim();
  source = normalizeSource(source) || inferSourceFromId(targetId);
  if (!targetId) return "";

  if (source === "soundcloud") {
    return targetId
      .replace(/^soundcloud:\/?/, "")
      .replace(/^\/+/, "");
  }

  // spotify
  return targetId
    .replace(/^spotify:\/?/, "")
    .replace(/^track\//, "")
    .replace(/^\/+/, "");
}

function getTrackIdVariants(targetId, source) {
  var canonicalId = canonicalizeTrackId(targetId, source);
  if (!canonicalId) return [];

  var variants = [canonicalId];
  if (source === "soundcloud") {
    variants.push("soundcloud:" + canonicalId);
    variants.push("soundcloud:/" + canonicalId);
    variants.push("/" + canonicalId);
  } else {
    variants.push("spotify:" + canonicalId);
    variants.push("spotify:/" + canonicalId);
    variants.push("track/" + canonicalId);
    variants.push("/track/" + canonicalId);
  }

  var seen = {};
  return variants.filter(function (id) {
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function findTrackCell(sheet, targetId, source) {
  var variants = getTrackIdVariants(targetId, source);
  for (var i = 0; i < variants.length; i++) {
    var finder = sheet.getRange("A:A").createTextFinder(variants[i]).matchEntireCell(true);
    var foundCell = finder.findNext();
    if (foundCell) return foundCell;
  }
  return null;
}

function getSourceSheet(source) {
  source = normalizeSource(source);
  if (!source) {
    throw new Error("getSourceSheet called with invalid source: " + source);
  }
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = source === "soundcloud" ? SHEET_NAME_SOUNDCLOUD : SHEET_NAME_SPOTIFY;
  var existingSheet = spreadsheet.getSheetByName(sheetName);
  if (existingSheet) {
    if (source === "soundcloud") {
      migrateSoundCloudRows(spreadsheet, existingSheet);
    }
    migrateSourceSheetIds(existingSheet, source);
    return existingSheet;
  }

  if (source === "spotify") {
    var legacySheet = findLegacySpotifySheet(spreadsheet);
    if (legacySheet) {
      legacySheet.setName(sheetName);
      migrateSoundCloudRows(spreadsheet, null);
      migrateSourceSheetIds(legacySheet, source);
      return legacySheet;
    }
  }

  var createdSheet = spreadsheet.insertSheet(sheetName);
  if (source === "soundcloud") {
    migrateSoundCloudRows(spreadsheet, createdSheet);
  }
  migrateSourceSheetIds(createdSheet, source);
  return createdSheet;
}

function findLegacySpotifySheet(spreadsheet) {
  var sheets = spreadsheet.getSheets();
  var activeSheet = spreadsheet.getActiveSheet();

  if (activeSheet && !isManagedSheetName(activeSheet.getName()) && activeSheet.getLastRow() > 0) {
    return activeSheet;
  }

  for (var i = 0; i < sheets.length; i++) {
    if (!isManagedSheetName(sheets[i].getName()) && sheets[i].getLastRow() > 0) {
      return sheets[i];
    }
  }

  for (var j = 0; j < sheets.length; j++) {
    if (!isManagedSheetName(sheets[j].getName())) {
      return sheets[j];
    }
  }

  return null;
}

function isManagedSheetName(sheetName) {
  return SHEET_NAMES.indexOf(sheetName) !== -1;
}

function migrateSoundCloudRows(spreadsheet, knownSoundCloudSheet) {
  var soundCloudSheet = knownSoundCloudSheet || spreadsheet.getSheetByName(SHEET_NAME_SOUNDCLOUD);
  if (!soundCloudSheet) return;

  var existingIds = getExistingIds(soundCloudSheet, "soundcloud");
  var sheets = spreadsheet.getSheets();

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (sheet.getName() === SHEET_NAME_SOUNDCLOUD) continue;

    var lastRow = sheet.getLastRow();
    if (lastRow < 1) continue;
    var lastColumn = Math.max(sheet.getLastColumn(), 3);

    var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    var rowsToDelete = [];

    for (var rowIndex = 0; rowIndex < values.length; rowIndex++) {
      var row = values[rowIndex];
      var rawId = String(row[0] || "");
      if (rawId.indexOf("soundcloud:") !== 0) continue;
      var canonicalId = canonicalizeTrackId(rawId, "soundcloud");
      row[0] = canonicalId;

      if (!existingIds[canonicalId]) {
        soundCloudSheet.appendRow(row);
        existingIds[canonicalId] = true;
      }
      rowsToDelete.push(rowIndex + 1);
    }

    for (var deleteIndex = rowsToDelete.length - 1; deleteIndex >= 0; deleteIndex--) {
      sheet.deleteRow(rowsToDelete[deleteIndex]);
    }
  }
}

function migrateSourceSheetIds(sheet, source) {
  source = normalizeSource(source);
  if (!sheet || !source) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return;

  var range = sheet.getRange(1, 1, lastRow, 1);
  var values = range.getValues();
  var changed = false;

  for (var i = 0; i < values.length; i++) {
    var raw = values[i][0];
    var id = String(raw || "");
    if (!id) continue;

    var canonicalId = canonicalizeTrackId(id, source);
    if (canonicalId && canonicalId !== id) {
      values[i][0] = canonicalId;
      changed = true;
    }
  }

  if (changed) range.setValues(values);
}

function getExistingIds(sheet, source) {
  var existingIds = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return existingIds;

  var values = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = canonicalizeTrackId(values[i][0], source);
    if (id) existingIds[id] = true;
  }
  return existingIds;
}

function warmupSourceMigrations() {
  var spotifySheet = getSourceSheet("spotify");
  var soundCloudSheet = getSourceSheet("soundcloud");
  return {
    status: "ok",
    spotifySheetName: spotifySheet.getName(),
    soundCloudSheetName: soundCloudSheet.getName()
  };
}

function warmupSoundCloudMigration() {
  return warmupSourceMigrations();
}
