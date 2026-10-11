/**
 * Leave.gs — pengajuan izin/sakit, lampiran (Drive privat), persetujuan.
 */
var Leave = {
  _folder: function () {
    var props = PropertiesService.getScriptProperties(), id = props.getProperty('ATTACH_FOLDER_ID');
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* buat ulang */ } }
    var f = DriveApp.createFolder('Absensi - Lampiran Izin (PRIVAT)');
    try { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* kebijakan domain */ }
    props.setProperty('ATTACH_FOLDER_ID', f.getId());
    return f;
  },

  _sniff: function (b) {
    if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
    if (b.length > 3 && (b[0] & 255) === 0xFF && (b[1] & 255) === 0xD8) return { mime: 'image/jpeg', ext: 'jpg' };
    if (b.length > 4 && (b[0] & 255) === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
    return null;
  },

  _saveAttachment: function (att, leaveType) {
    if (!att || !att.base64) {
      if (leaveType === 'SAKIT' && String(Cfg.all().sakit_attachment_required).toUpperCase() === 'Y')
        throw new AppError('VALIDATION', 'Lampiran wajib untuk pengajuan sakit.');
      return '';
    }
    var bytes;
    try { bytes = Utilities.base64Decode(String(att.base64)); } catch (e) { throw new AppError('VALIDATION', 'Lampiran tidak dapat dibaca.'); }
    var maxKb = Cfg.num('max_attachment_kb', 2048);
    if (bytes.length > maxKb * 1024) throw new AppError('VALIDATION', 'Ukuran lampiran melebihi ' + maxKb + ' KB.');
    var kind = Leave._sniff(bytes);
    if (!kind) throw new AppError('VALIDATION', 'Tipe lampiran harus PDF, JPG, atau PNG.');
    var base = U.clean(att.name, 60).replace(/\.[^.]*$/, '').replace(/[^\w\- ]/g, '') || 'lampiran';
    var file = Leave._folder().createFile(Utilities.newBlob(bytes, kind.mime, base + '.' + kind.ext));
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) { /* abaikan */ }
    return file.getId();
  },

  submit: function (p) {
    var cur = Auth.current(), emp = cur.employee, today = U.today();
    var type = String(p.leave_type || '').toUpperCase();
    if (['IZIN', 'SAKIT'].indexOf(type) < 0) throw new AppError('VALIDATION', 'Jenis harus IZIN atau SAKIT.');
    var s = U.dateParam(p.start_date, 'mulai'), e = U.dateParam(p.end_date, 'selesai');
    if (e < s) throw new AppError('VALIDATION', 'Tanggal selesai sebelum tanggal mulai.');
    if (U.daysBetween(s, e) > 30) throw new AppError('VALIDATION', 'Maksimal rentang pengajuan 31 hari.');
    if (U.daysBetween(s, today) > 30) throw new AppError('VALIDATION', 'Pengajuan surut maksimal 30 hari.');
    if (U.daysBetween(today, s) > 180) throw new AppError('VALIDATION', 'Tanggal mulai terlalu jauh ke depan.');
    var reason = U.clean(p.reason, 500);
    if (reason.length < 5) throw new AppError('VALIDATION', 'Alasan wajib diisi (min. 5 karakter).');
    var overlap = DB.all(APP.SHEETS.LEAVE).some(function (l) {
      return l.employee_id === emp.employee_id && (l.status === 'Menunggu' || l.status === 'Disetujui') && l.start_date <= e && l.end_date >= s;
    });
    if (overlap) throw new AppError('LEAVE_OVERLAP', 'Sudah ada pengajuan aktif pada rentang tanggal tersebut.');
    var ref = Leave._saveAttachment(p.attachment, type), now = U.nowStr();
    var rec = { request_id: U.id('REQ'), employee_id: emp.employee_id, leave_type: type, start_date: s, end_date: e, reason: reason, attachment_ref: ref, status: 'Menunggu', reviewer_id: '', reviewed_at: '', review_note: '', created_at: now };
    DB.append(APP.SHEETS.LEAVE, rec);
    return { request_id: rec.request_id };
  },

  _view: function (l, emps) {
    var e = emps[l.employee_id] || {};
    return { request_id: l.request_id, employee_id: l.employee_id, full_name: e.full_name || '', unit: e.unit || '', leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date,
      reason: l.reason, has_attachment: !!l.attachment_ref, status: l.status, reviewer_id: l.reviewer_id, reviewed_at: l.reviewed_at, review_note: l.review_note, created_at: l.created_at };
  },
  _emps: function () { var m = {}; DB.all(APP.SHEETS.EMP).forEach(function (e) { m[e.employee_id] = e; }); return m; },

  mine: function () {
    var cur = Auth.current(), emps = Leave._emps();
    return DB.all(APP.SHEETS.LEAVE).filter(function (l) { return l.employee_id === cur.employee.employee_id; })
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).map(function (l) { return Leave._view(l, emps); });
  },

  cancel: function (id) {
    var cur = Auth.current(), l = DB.find(APP.SHEETS.LEAVE, 'request_id', id), today = U.today();
    if (!l || l.employee_id !== cur.employee.employee_id) throw new AppError('NOT_FOUND', 'Pengajuan tidak ditemukan.');
    var ok = l.status === 'Menunggu' || (l.status === 'Disetujui' && l.start_date > today);
    if (!ok) throw new AppError('VALIDATION', 'Pengajuan ini tidak dapat dibatalkan.');
    DB.update(APP.SHEETS.LEAVE, 'request_id', id, { status: 'Dibatalkan' });
    if (l.status === 'Disetujui') Audit.log('LEAVE_CANCEL', 'PengajuanIzin', id, { status: l.status }, { status: 'Dibatalkan' }, 'Dibatalkan pegawai');
    return true;
  },

  adminList: function (f) {
    Auth.requireAdmin();
    f = f || {};
    var emps = Leave._emps(), q = String(f.q || '').toLowerCase();
    var rows = DB.all(APP.SHEETS.LEAVE).filter(function (l) {
      if (f.status && l.status !== f.status) return false;
      var e = emps[l.employee_id] || {};
      return !q || ((e.full_name || '') + ' ' + (e.employee_number || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).map(function (l) { return Leave._view(l, emps); });
    return U.page(rows, f.page, f.size);
  },

  decide: function (id, decision, note) {
    var admin = Auth.requireAdmin();
    if (['Disetujui', 'Ditolak'].indexOf(decision) < 0) throw new AppError('VALIDATION', 'Keputusan tidak valid.');
    note = U.clean(note, 300);
    if (decision === 'Ditolak' && !note) throw new AppError('VALIDATION', 'Alasan penolakan wajib diisi.');
    var l = DB.find(APP.SHEETS.LEAVE, 'request_id', id);
    if (!l) throw new AppError('NOT_FOUND', 'Pengajuan tidak ditemukan.');
    if (l.status !== 'Menunggu') throw new AppError('VALIDATION', 'Hanya pengajuan berstatus Menunggu yang dapat diputuskan.');
    DB.update(APP.SHEETS.LEAVE, 'request_id', id, { status: decision, reviewer_id: admin.user.user_id, reviewed_at: U.nowStr(), review_note: note });
    Audit.log('LEAVE_DECISION', 'PengajuanIzin', id, { status: l.status }, { status: decision }, note || '(tanpa catatan)');
    return true;
  },

  attachment: function (id) {
    var cur = Auth.current(), l = DB.find(APP.SHEETS.LEAVE, 'request_id', id);
    if (!l || (!cur.isAdmin && l.employee_id !== cur.employee.employee_id)) throw new AppError('NOT_FOUND', 'Pengajuan tidak ditemukan.');
    if (!l.attachment_ref) throw new AppError('NOT_FOUND', 'Tidak ada lampiran.');
    var f = DriveApp.getFileById(l.attachment_ref), b = f.getBlob();
    if (cur.isAdmin && cur.employee.employee_id !== l.employee_id) Audit.log('ATTACHMENT_VIEW', 'PengajuanIzin', id, null, null, '');
    return { name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) };
  }
};
