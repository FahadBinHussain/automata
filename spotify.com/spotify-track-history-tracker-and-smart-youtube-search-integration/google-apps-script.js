function doGet(e) {
  var source = normalizeSource(e.parameter && e.parameter.source);
  var sheet = source ? getSourceSheet(source) : SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (source) {
    migrateSourceSheetIds(sheet, source);
  }

  if (sheet.getLastRow() === 0) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var ids = data.map(function(row) {
    var id = row[0];
    return source ? canonicalizeTrackId(id, source) : id;
  }).filter(function(id) { return id && id.length > 0; });
  return ContentService.createTextOutput(JSON.stringify(ids)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); 

  try {
    var params = JSON.parse(e.postData.contents);
    var rawTargetId = params.id;
    var action = params.action || "add"; // Default to 'add' if not specified
    var source = normalizeSource(params.source) || inferSourceFromId(rawTargetId);
    var targetId = canonicalizeTrackId(rawTargetId, source);
    
    var sheet = getSourceSheet(source);
    migrateSourceSheetIds(sheet, source);
    
    // Use TextFinder for fast searching
    var foundCell = findTrackCell(sheet, targetId, source);

    if (action === "remove") {
      if (foundCell) {
        // Delete the row where the ID was found
        sheet.deleteRow(foundCell.getRow());
        return ContentService.createTextOutput(JSON.stringify({"status": "deleted"}));
      } else {
        return ContentService.createTextOutput(JSON.stringify({"status": "not_found"}));
      }
    } 
    
    // ACTION IS ADD/UPDATE
    else {
      if (foundCell) {
        // Update existing date
        if (String(foundCell.getValue() || "") !== targetId) {
          foundCell.setValue(targetId);
        }
        foundCell.offset(0, 2).setValue(new Date());
        return ContentService.createTextOutput(JSON.stringify({"status": "updated"}));
      } else {
        // Create new
        sheet.appendRow([targetId, params.name, new Date()]);
        return ContentService.createTextOutput(JSON.stringify({"status": "inserted"}));
      }
    }

  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": err.toString()}));
  } finally {
    lock.releaseLock();
  }
}

function normalizeSource(source) {
  source = String(source || "").toLowerCase();
  if (source === "spotify" || source === "soundcloud") return source;
  return "";
}

function inferSourceFromId(targetId) {
  targetId = String(targetId || "");
  if (targetId.indexOf("soundcloud:") === 0) return "soundcloud";
  return "spotify";
}

function canonicalizeTrackId(targetId, source) {
  targetId = String(targetId || "").trim();
  source = normalizeSource(source) || inferSourceFromId(targetId);
  if (!targetId) return "";

  if (source === "soundcloud") {
    return targetId.replace(/^soundcloud:/, "").replace(/^\/+/, "");
  }

  return targetId.replace(/^spotify:/, "").replace(/^\/+/, "");
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
  }

  var seen = {};
  return variants.filter(function(id) {
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
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = source === "soundcloud" ? "SoundCloud" : "Spotify";
  var existingSheet = spreadsheet.getSheetByName(sheetName);
  if (existingSheet) {
    migrateSoundCloudRows(spreadsheet, source === "soundcloud" ? existingSheet : null);
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
  migrateSoundCloudRows(spreadsheet, source === "soundcloud" ? createdSheet : null);
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
  return sheetName === "Spotify" || sheetName === "SoundCloud";
}

function migrateSoundCloudRows(spreadsheet, knownSoundCloudSheet) {
  var soundCloudSheet = knownSoundCloudSheet || spreadsheet.getSheetByName("SoundCloud");
  if (!soundCloudSheet) return;

  var existingIds = getExistingIds(soundCloudSheet, "soundcloud");
  var sheets = spreadsheet.getSheets();

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (sheet.getName() === "SoundCloud") continue;

    var lastRow = sheet.getLastRow();
    var lastColumn = Math.max(sheet.getLastColumn(), 3);
    if (lastRow < 1) continue;

    var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    var rowsToDelete = [];

    for (var rowIndex = 0; rowIndex < values.length; rowIndex++) {
      var row = values[rowIndex];
      var id = String(row[0] || "");
      if (id.indexOf("soundcloud:") !== 0) continue;
      var canonicalId = canonicalizeTrackId(id, "soundcloud");
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
    var id = String(values[i][0] || "");
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
    var id = String(values[i][0] || "");
    if (source) id = canonicalizeTrackId(id, source);
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
    sheetName: soundCloudSheet.getName()
  };
}

function warmupSoundCloudMigration() {
  return warmupSourceMigrations();
}
