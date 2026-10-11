/**
 * Code.gs — entry point (doGet), setup awal, dan lapisan API untuk google.script.run.
 * Hanya fungsi tingkat atas yang dapat dipanggil dari browser; semua modul berupa objek.
 * Setiap API: identitas & role diperiksa di server; operasi tulis memakai LockService.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  if (['Styles', 'Scripts'].indexOf(name) < 0) return '';
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function run_(write, fn) {
  var lock = null;
  try {
    if (write) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) throw new AppError('SERVER_BUSY', 'Sistem sedang sibuk. Silakan coba lagi.');
    }
    return { ok: true, data: fn() };
  } catch (e) {
    if (e && e.isAppError) return { ok: false, code: e.code, message: e.message };
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, code: 'SERVER_ERROR', message: 'Terjadi kendala. Silakan coba lagi atau hubungi administrator.' };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) { /* abaikan */ } }
  }
}

/* ===================== SETUP (jalankan sekali dari editor) ===================== */
function setupSistem() {
  var log = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!SpreadsheetApp.getActiveSpreadsheet() && !PropertiesService.getScriptProperties().getProperty('SS_ID')) {
      var ss = SpreadsheetApp.create('Database Absensi Pegawai');
      PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
      log.push('Spreadsheet baru dibuat: ' + ss.getUrl());
    }
    DB.ensureSchema(log);
    var users = DB.all(APP.SHEETS.USERS);
    if (users.length) { Auth.requireAdmin(); } // setelah terpasang, hanya admin yang boleh menjalankan ulang

    // Konfigurasi default (hanya kunci yang belum ada)
    var have = {}; DB.all(APP.SHEETS.CFG).forEach(function (r) { have[r.config_key] = 1; });
    var now = U.nowStr();
    var cfgRows = APP.DEFAULT_CONFIG.filter(function (d) { return !have[d[0]]; }).map(function (d) {
      return { config_key: d[0], config_value: d[1], description: d[2], updated_by: 'setup', updated_at: now };
    });
    DB.appendMany(APP.SHEETS.CFG, cfgRows);
    if (cfgRows.length) log.push('Konfigurasi default ditambahkan: ' + cfgRows.length);

    // Jadwal default (hanya jika kosong): Senin–Kamis 08.15–16.30, Jumat 08.15–17.00
    if (!DB.all(APP.SHEETS.SCH).length) {
      var sch = [1, 2, 3, 4, 5].map(function (d) {
        return { schedule_id: U.id('SCH'), day_of_week: d, start_time: '08:15', end_time: d === 5 ? '17:00' : '16:30', effective_from: '', effective_to: '', unit: '*', active: 'Y' };
      });
      DB.appendMany(APP.SHEETS.SCH, sch);
      log.push('Jadwal default dibuat (Sabtu/Minggu libur).');
    }
    // Lokasi contoh NONAKTIF — admin wajib mengisi koordinat resmi
    if (!DB.all(APP.SHEETS.LOC).length) {
      DB.append(APP.SHEETS.LOC, { location_id: U.id('LOC'), name: 'Kantor Utama (ISI KOORDINAT)', latitude: 0, longitude: 0, radius_m: 100, max_accuracy_m: 30, active: 'N', allowed_units: '*', updated_by: 'setup', updated_at: now });
      log.push('Lokasi contoh dibuat NONAKTIF. Isi koordinat resmi lalu aktifkan lewat menu Lokasi.');
    }
    // Admin pertama = akun yang menjalankan setup
    if (!users.length) {
      var email = U.normEmail(Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'admin@absensi.local');
      var id = 'EMP-0001';
      var salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
      var hash = Auth.hashPassword('admin123', salt);
      DB.append(APP.SHEETS.EMP, { employee_id: id, employee_number: '0001', full_name: 'Administrator', email: email, unit: 'Administrasi', position: 'Administrator', status: 'AKTIF', created_at: now, updated_at: now });
      DB.append(APP.SHEETS.USERS, { user_id: U.id('USR'), email_normalized: email, employee_id: id, role: 'ADMIN', status: 'AKTIF', password_hash: hash, password_salt: salt, created_at: now, updated_at: now });
      log.push('Administrator pertama: ' + email + ' (Password default: admin123)');
    }
    // Inisialisasi password akun lama jika belum memiliki password_hash
    var allUsers = DB.all(APP.SHEETS.USERS);
    var allEmps = DB.all(APP.SHEETS.EMP);
    allUsers.forEach(function (u) {
      if (!u.password_hash) {
        var emp = allEmps.filter(function (e) { return e.employee_id === u.employee_id; })[0];
        var defPwd = u.role === 'ADMIN' ? 'admin123' : ((emp && emp.employee_number) || '123456');
        var s = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
        var h = Auth.hashPassword(defPwd, s);
        DB.update(APP.SHEETS.USERS, 'user_id', u.user_id, { password_salt: s, password_hash: h, updated_at: now });
        log.push('Password default dibuat untuk: ' + u.email_normalized + ' (' + defPwd + ')');
      }
    });
    Leave._folder();
    log.push('Folder lampiran siap (privat).');
    Audit.log('SETUP', 'Sistem', '', null, { log: log.length }, 'setupSistem dijalankan', U.normEmail(Session.getActiveUser().getEmail()));
  } finally { lock.releaseLock(); }
  console.log(log.join('\n'));
  return log;
}

/* ===================== API ===================== */
function api_init() {
  return run_(false, function () {
    var c = Auth.current(), cfg = Cfg.all();
    return {
      user: { email: c.email, name: c.employee.full_name, role: c.role, employee_id: c.employee.employee_id, unit: c.employee.unit },
      today: U.today(), now: U.nowStr(), tz: APP.TZ, day_types: APP.DAY_TYPES, max_attachment_kb: Number(cfg.max_attachment_kb) || 2048,
      rule_version: cfg.rule_version
    };
  });
}
function api_login(identity, password) { return run_(false, function () { return Auth.login(identity, password); }); }
function api_changePassword(oldPassword, newPassword) { return run_(true, function () { return Auth.changePassword(oldPassword, newPassword); }); }
function api_resetPassword(employeeId, newPassword) { return run_(true, function () { return Auth.adminResetPassword(employeeId, newPassword); }); }
function api_myToday() { return run_(false, function () { return Attendance.today(); }); }
function api_checkin(p) { return run_(true, function () { return Attendance.checkin(p); }); }
function api_myHistory(month) { return run_(false, function () { return Attendance.history(month); }); }
function api_leaveSubmit(p) { return run_(true, function () { return Leave.submit(p || {}); }); }
function api_leaveMine() { return run_(false, function () { return Leave.mine(); }); }
function api_leaveCancel(id) { return run_(true, function () { return Leave.cancel(id); }); }
function api_leaveAttachment(id) { return run_(false, function () { return Leave.attachment(id); }); }

/* ---- Admin ---- */
function api_dashboard(date, unit) { return run_(false, function () { return Reports.dashboard(date, unit); }); }
function api_attList(f) { return run_(false, function () { return Attendance.list(f); }); }
function api_attVoid(id, reason) { return run_(true, function () { return Attendance.voidTx(id, reason); }); }
function api_attManual(o) { return run_(true, function () { return Attendance.addManual(o || {}); }); }
function api_empList(f) { return run_(false, function () { return Employee.list(f); }); }
function api_empSave(o) { return run_(true, function () { return Employee.save(o || {}); }); }
function api_empStatus(id, status, reason) { return run_(true, function () { return Employee.setStatus(id, status, reason); }); }
function api_empImport(rows, commit) { return run_(!!commit, function () { return Employee.importRows(rows, !!commit); }); }
function api_locList() { return run_(false, function () { return Location.list(); }); }
function api_locSave(o) { return run_(true, function () { return Location.save(o || {}); }); }
function api_schList() { return run_(false, function () { return Cal.scheduleList(); }); }
function api_schSave(o) { return run_(true, function () { return Cal.scheduleSave(o || {}); }); }
function api_calList(year) { return run_(false, function () { return Cal.calendarList(year); }); }
function api_calSave(o) { return run_(true, function () { return Cal.calendarSave(o || {}); }); }
function api_calDelete(id, reason) { return run_(true, function () { return Cal.calendarDelete(id, reason); }); }
function api_calImport(rows, reason) { return run_(true, function () { return Cal.calendarImport(rows, reason); }); }
function api_leaveAdminList(f) { return run_(false, function () { return Leave.adminList(f); }); }
function api_leaveDecide(id, decision, note) { return run_(true, function () { return Leave.decide(id, decision, note); }); }
function api_report(f) { return run_(false, function () { return Reports.build(f); }); }
function api_reportExport(f, kind, format) { return run_(true, function () { return Reports.export(f, kind, format); }); }
function api_recapSave(f) { return run_(true, function () { return Reports.saveRecap(f); }); }
function api_auditList(f) { return run_(false, function () { return Audit.list(f); }); }
function api_attemptList(f) { return run_(false, function () { return Audit.attempts(f); }); }
function api_cfgList() { return run_(false, function () { return Cfg.list(); }); }
function api_cfgSave(key, value, reason) { return run_(true, function () { return Cfg.set(key, value, reason); }); }

/* ===================== Universal API Dispatcher ===================== */
var API = {
  api_init: api_init,
  api_login: api_login,
  api_changePassword: api_changePassword,
  api_resetPassword: api_resetPassword,
  api_myToday: api_myToday,
  api_checkin: api_checkin,
  api_myHistory: api_myHistory,
  api_leaveSubmit: api_leaveSubmit,
  api_leaveMine: api_leaveMine,
  api_leaveCancel: api_leaveCancel,
  api_leaveAttachment: api_leaveAttachment,
  api_dashboard: api_dashboard,
  api_attList: api_attList,
  api_attVoid: api_attVoid,
  api_attManual: api_attManual,
  api_empList: api_empList,
  api_empSave: api_empSave,
  api_empStatus: api_empStatus,
  api_empImport: api_empImport,
  api_locList: api_locList,
  api_locSave: api_locSave,
  api_schList: api_schList,
  api_schSave: api_schSave,
  api_calList: api_calList,
  api_calSave: api_calSave,
  api_calDelete: api_calDelete,
  api_calImport: api_calImport,
  api_leaveAdminList: api_leaveAdminList,
  api_leaveDecide: api_leaveDecide,
  api_report: api_report,
  api_reportExport: api_reportExport,
  api_recapSave: api_recapSave,
  api_auditList: api_auditList,
  api_attemptList: api_attemptList,
  api_cfgList: api_cfgList,
  api_cfgSave: api_cfgSave
};

function api_call(token, fnName, args) {
  Auth.setToken(token);
  var handler = API[fnName];
  if (!handler || typeof handler !== 'function') {
    return { ok: false, code: 'NOT_FOUND', message: 'Fungsi API tidak dikenal: ' + fnName };
  }
  return handler.apply(null, args || []);
}
