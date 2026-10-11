/**
 * Database.gs — akses Google Sheets (batch, memo per eksekusi) dan setup idempoten.
 * Kolom dipetakan berdasarkan nama header, bukan posisi.
 */
var DB = {
  _ss: null,
  _memo: {},
  _hmemo: {},

  ss: function () {
    if (DB._ss) return DB._ss;
    var id = (APP && APP.SS_ID) || PropertiesService.getScriptProperties().getProperty('SS_ID');
    var ss = null;
    if (id) {
      try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
    }
    if (!ss) {
      try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
    }
    if (!ss) throw new AppError('SETUP_REQUIRED', 'Spreadsheet database (ID: ' + (id || '-') + ') belum dapat dibuka. Pastikan ID Spreadsheet benar dan telah diberi izin akses.');
    DB._ss = ss;
    return ss;
  },
  sheet: function (name) {
    var sh = DB.ss().getSheetByName(name);
    if (!sh) throw new AppError('SETUP_REQUIRED', 'Database belum disiapkan. Jalankan setupSistem() dari editor Apps Script.');
    return sh;
  },
  hdr: function (name) {
    if (DB._hmemo[name]) return DB._hmemo[name];
    var sh = DB.sheet(name);
    var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    DB._hmemo[name] = h;
    return h;
  },
  _norm: function (v) {
    if (v instanceof Date) return U.fmt(v, 'yyyy-MM-dd HH:mm:ss');
    return v == null ? '' : v;
  },
  all: function (name) {
    if (DB._memo[name]) return DB._memo[name];
    var sh = DB.sheet(name), h = DB.hdr(name), last = sh.getLastRow(), out = [];
    if (last > 1) {
      var vals = sh.getRange(2, 1, last - 1, h.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        var o = { __row: i + 2 };
        for (var j = 0; j < h.length; j++) o[h[j]] = DB._norm(vals[i][j]);
        out.push(o);
      }
    }
    DB._memo[name] = out;
    return out;
  },
  find: function (name, col, id) {
    var rows = DB.all(name);
    for (var i = 0; i < rows.length; i++) if (String(rows[i][col]) === String(id)) return rows[i];
    return null;
  },
  _row: function (h, o) { return h.map(function (c) { return o[c] === undefined ? '' : o[c]; }); },
  _flush: function (name) { delete DB._memo[name]; },

  appendMany: function (name, objs) {
    if (!objs.length) return;
    var sh = DB.sheet(name), h = DB.hdr(name);
    var rows = objs.map(function (o) { return DB._row(h, o); });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, h.length).setValues(rows);
    DB._flush(name);
  },
  append: function (name, obj) { DB.appendMany(name, [obj]); },

  update: function (name, col, id, patch) {
    var rec = DB.find(name, col, id);
    if (!rec) throw new AppError('NOT_FOUND', 'Data tidak ditemukan.');
    var sh = DB.sheet(name), h = DB.hdr(name);
    var merged = {};
    h.forEach(function (c) { merged[c] = Object.prototype.hasOwnProperty.call(patch, c) ? patch[c] : rec[c]; });
    sh.getRange(rec.__row, 1, 1, h.length).setValues([DB._row(h, merged)]);
    DB._flush(name);
    return merged;
  },
  remove: function (name, col, id) {
    var rec = DB.find(name, col, id);
    if (!rec) throw new AppError('NOT_FOUND', 'Data tidak ditemukan.');
    DB.sheet(name).deleteRow(rec.__row);
    DB._flush(name);
  },
  upsertMany: function (name, col, objs) {
    if (!objs.length) return;
    var sh = DB.sheet(name), h = DB.hdr(name), recs = DB.all(name), idx = {};
    recs.forEach(function (r) { idx[String(r[col])] = r.__row; });
    var last = sh.getLastRow();
    var data = last > 1 ? sh.getRange(2, 1, last - 1, h.length).getValues() : [];
    var byId = {};
    objs.forEach(function (o) { byId[String(o[col])] = o; });
    var append = [], changed = false;
    Object.keys(byId).forEach(function (id) {
      var row = DB._row(h, byId[id]);
      if (idx[id]) { data[idx[id] - 2] = row; changed = true; } else append.push(row);
    });
    if (changed) sh.getRange(2, 1, data.length, h.length).setValues(data);
    if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, h.length).setValues(append);
    DB._flush(name);
  },

  /** Membuat sheet/header/format. Idempoten. */
  ensureSchema: function (log) {
    var ss = DB.ss();
    Object.keys(APP.SCHEMA).forEach(function (name) {
      var want = APP.SCHEMA[name], sh = ss.getSheetByName(name);
      if (!sh) { sh = ss.insertSheet(name); log.push('Sheet dibuat: ' + name); }
      var cur = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
      want.forEach(function (c) {
        if (cur.indexOf(c) < 0) { cur.push(c); sh.getRange(1, cur.length).setValue(c); log.push('Kolom ditambah: ' + name + '.' + c); }
      });
      sh.getRange(1, 1, 1, cur.length).setFontWeight('bold').setBackground('#e8eefc');
      sh.setFrozenRows(1);
      var rows = Math.max(sh.getMaxRows() - 1, 1);
      cur.forEach(function (c, i) {
        var rg = sh.getRange(2, i + 1, rows, 1);
        if (APP.NUM_COLS.indexOf(c) >= 0) rg.setNumberFormat('General'); else rg.setNumberFormat('@');
      });
    });
    ['Sheet1', 'Lembar1'].forEach(function (n) {
      var s = ss.getSheetByName(n);
      if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
    });
    DB._hmemo = {}; DB._memo = {};
  }
};
