/**
 * Employee.gs — master pegawai, role, penonaktifan, dan impor.
 */
var Employee = {
  _maxSeq: function () {
    var max = 0;
    DB.all(APP.SHEETS.EMP).forEach(function (e) {
      var m = /^EMP-(\d+)$/.exec(e.employee_id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return max;
  },
  _norm: function (o) {
    o = o || {};
    var v = {
      employee_number: U.clean(o.employee_number, 30), full_name: U.clean(o.full_name, 100),
      email: U.normEmail(o.email), unit: U.clean(o.unit, 80), position: U.clean(o.position, 80),
      role: String(o.role || 'PEGAWAI').toUpperCase()
    };
    var errs = [];
    if (v.full_name.length < 2) errs.push('Nama lengkap wajib (min. 2 karakter)');
    if (!U.isEmail(v.email)) errs.push('Email tidak valid');
    if (['ADMIN', 'PEGAWAI'].indexOf(v.role) < 0) errs.push('Role harus ADMIN atau PEGAWAI');
    return { v: v, errs: errs };
  },
  _activeAdmins: function () {
    return DB.all(APP.SHEETS.USERS).filter(function (u) { return u.role === 'ADMIN' && u.status === 'AKTIF'; });
  },

  units: function () {
    var s = {};
    DB.all(APP.SHEETS.EMP).forEach(function (e) { if (e.unit) s[e.unit] = 1; });
    return Object.keys(s).sort();
  },

  list: function (f) {
    Auth.requireAdmin();
    f = f || {};
    var users = {};
    DB.all(APP.SHEETS.USERS).forEach(function (u) { users[u.employee_id] = u; });
    var q = String(f.q || '').toLowerCase();
    var rows = DB.all(APP.SHEETS.EMP).filter(function (e) {
      if (f.status && e.status !== f.status) return false;
      if (f.unit && e.unit !== f.unit) return false;
      return !q || (e.full_name + ' ' + e.email + ' ' + e.employee_number + ' ' + e.unit).toLowerCase().indexOf(q) >= 0;
    }).map(function (e) {
      return {
        employee_id: e.employee_id, employee_number: e.employee_number, full_name: e.full_name, email: e.email,
        unit: e.unit, position: e.position, status: e.status, role: (users[e.employee_id] || {}).role || 'PEGAWAI'
      };
    });
    var p = U.page(rows, f.page, f.size || 25);
    p.units = Employee.units();
    return p;
  },

  save: function (o) {
    var admin = Auth.requireAdmin();
    var n = Employee._norm(o);
    if (n.errs.length) throw new AppError('VALIDATION', n.errs.join('; '));
    var v = n.v, id = o.employee_id ? String(o.employee_id) : '';
    var emps = DB.all(APP.SHEETS.EMP), users = DB.all(APP.SHEETS.USERS), now = U.nowStr();
    if (emps.some(function (e) { return U.normEmail(e.email) === v.email && e.employee_id !== id; }) ||
      users.some(function (u) { return u.email_normalized === v.email && u.employee_id !== id; }))
      throw new AppError('VALIDATION', 'Email sudah digunakan pegawai lain.');
    if (v.employee_number && emps.some(function (e) { return String(e.employee_number) === v.employee_number && e.employee_id !== id; }))
      throw new AppError('VALIDATION', 'NIP/nomor pegawai sudah digunakan.');

    if (!id) {
      id = 'EMP-' + ('0000' + (Employee._maxSeq() + 1)).slice(-4);
      var emp = { employee_id: id, employee_number: v.employee_number, full_name: v.full_name, email: v.email, unit: v.unit, position: v.position, status: 'AKTIF', created_at: now, updated_at: now };
      var salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
      var rawPwd = (o.password && String(o.password).trim()) || (v.employee_number || '123456');
      var hash = Auth.hashPassword(rawPwd, salt);
      DB.append(APP.SHEETS.EMP, emp);
      DB.append(APP.SHEETS.USERS, { user_id: U.id('USR'), email_normalized: v.email, employee_id: id, role: v.role, status: 'AKTIF', password_hash: hash, password_salt: salt, created_at: now, updated_at: now });
      Audit.log('EMPLOYEE_CREATE', 'Pegawai', id, null, { emp: emp, role: v.role }, '');
      return { employee_id: id };
    }
    var cur = DB.find(APP.SHEETS.EMP, 'employee_id', id), usr = users.filter(function (u) { return u.employee_id === id; })[0];
    if (!cur || !usr) throw new AppError('NOT_FOUND', 'Pegawai tidak ditemukan.');
    if (usr.role === 'ADMIN' && v.role !== 'ADMIN') {
      if (admin.employee.employee_id === id) throw new AppError('VALIDATION', 'Anda tidak dapat menurunkan role akun sendiri.');
      if (Employee._activeAdmins().length <= 1) throw new AppError('VALIDATION', 'Harus tersisa minimal satu administrator aktif.');
    }
    var before = { emp: { employee_number: cur.employee_number, full_name: cur.full_name, email: cur.email, unit: cur.unit, position: cur.position }, role: usr.role };
    DB.update(APP.SHEETS.EMP, 'employee_id', id, { employee_number: v.employee_number, full_name: v.full_name, email: v.email, unit: v.unit, position: v.position, updated_at: now });
    var userPatch = { email_normalized: v.email, role: v.role, updated_at: now };
    if (o.password && String(o.password).trim().length >= 6) {
      var editSalt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
      userPatch.password_salt = editSalt;
      userPatch.password_hash = Auth.hashPassword(String(o.password).trim(), editSalt);
    }
    DB.update(APP.SHEETS.USERS, 'user_id', usr.user_id, userPatch);
    Audit.log('EMPLOYEE_UPDATE', 'Pegawai', id, before, { emp: { employee_number: v.employee_number, full_name: v.full_name, email: v.email, unit: v.unit, position: v.position }, role: v.role }, U.clean(o.reason, 300));
    return { employee_id: id };
  },

  setStatus: function (id, status, reason) {
    var admin = Auth.requireAdmin();
    if (['AKTIF', 'NONAKTIF'].indexOf(status) < 0) throw new AppError('VALIDATION', 'Status tidak valid.');
    reason = U.clean(reason, 300);
    if (!reason) throw new AppError('VALIDATION', 'Alasan wajib diisi.');
    var emp = DB.find(APP.SHEETS.EMP, 'employee_id', id);
    var usr = DB.all(APP.SHEETS.USERS).filter(function (u) { return u.employee_id === id; })[0];
    if (!emp || !usr) throw new AppError('NOT_FOUND', 'Pegawai tidak ditemukan.');
    if (status === 'NONAKTIF') {
      if (admin.employee.employee_id === id) throw new AppError('VALIDATION', 'Anda tidak dapat menonaktifkan akun sendiri.');
      if (usr.role === 'ADMIN' && Employee._activeAdmins().length <= 1) throw new AppError('VALIDATION', 'Harus tersisa minimal satu administrator aktif.');
    }
    var now = U.nowStr();
    DB.update(APP.SHEETS.EMP, 'employee_id', id, { status: status, updated_at: now });
    DB.update(APP.SHEETS.USERS, 'user_id', usr.user_id, { status: status, updated_at: now });
    Audit.log('EMPLOYEE_STATUS', 'Pegawai', id, { status: emp.status }, { status: status }, reason);
    return true;
  },

  /** rows: [{employee_number, full_name, email, unit, position, role}]; commit=false → hanya pratinjau. */
  importRows: function (rows, commit) {
    Auth.requireAdmin();
    if (!Array.isArray(rows) || !rows.length) throw new AppError('VALIDATION', 'Tidak ada baris untuk diimpor.');
    if (rows.length > 500) throw new AppError('VALIDATION', 'Maksimal 500 baris per impor.');
    var emps = DB.all(APP.SHEETS.EMP), users = DB.all(APP.SHEETS.USERS);
    var emails = {}, nums = {}, errors = [], valid = [];
    emps.forEach(function (e) { emails[U.normEmail(e.email)] = 1; if (e.employee_number) nums[String(e.employee_number)] = 1; });
    users.forEach(function (u) { emails[u.email_normalized] = 1; });
    rows.forEach(function (r, i) {
      var n = Employee._norm(r), errs = n.errs.slice(), v = n.v;
      if (emails[v.email]) errs.push('Email sudah terdaftar/duplikat');
      if (v.employee_number && nums[v.employee_number]) errs.push('NIP sudah terdaftar/duplikat');
      if (errs.length) errors.push({ row: i + 1, message: errs.join('; ') });
      else { emails[v.email] = 1; if (v.employee_number) nums[v.employee_number] = 1; valid.push(v); }
    });
    var res = { total: rows.length, valid: valid.length, errors: errors, committed: false };
    if (commit && !errors.length) {
      var seq = Employee._maxSeq(), now = U.nowStr(), E = [], Us = [];
      valid.forEach(function (v) {
        var id = 'EMP-' + ('0000' + (++seq)).slice(-4);
        var salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
        var rawPwd = v.employee_number || '123456';
        var hash = Auth.hashPassword(rawPwd, salt);
        E.push({ employee_id: id, employee_number: v.employee_number, full_name: v.full_name, email: v.email, unit: v.unit, position: v.position, status: 'AKTIF', created_at: now, updated_at: now });
        Us.push({ user_id: U.id('USR'), email_normalized: v.email, employee_id: id, role: v.role, status: 'AKTIF', password_hash: hash, password_salt: salt, created_at: now, updated_at: now });
      });
      DB.appendMany(APP.SHEETS.EMP, E);
      DB.appendMany(APP.SHEETS.USERS, Us);
      Audit.log('EMPLOYEE_IMPORT', 'Pegawai', '', null, { count: E.length }, 'Impor massal');
      res.committed = true;
    }
    return res;
  }
};
