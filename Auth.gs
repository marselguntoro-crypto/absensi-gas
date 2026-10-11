/**
 * Auth.gs — autentikasi sesi, token login, kata sandi, dan role.
 * Mendukung login kata sandi (token HMAC) serta fallback SSO akun Google.
 */
var Auth = {
  _cur: null,
  _token: null,

  setToken: function (t) {
    Auth._token = t || null;
    Auth._cur = null;
  },

  getSecret: function () {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('AUTH_SECRET');
    if (!secret) {
      secret = Utilities.getUuid() + '-' + Utilities.getUuid();
      props.setProperty('AUTH_SECRET', secret);
    }
    return secret;
  },

  toHex: function (bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 0) b += 256;
      var h = b.toString(16);
      if (h.length < 2) hex += '0';
      hex += h;
    }
    return hex;
  },

  hashPassword: function (password, salt) {
    var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + ':' + String(salt), Utilities.Charset.UTF_8);
    return Auth.toHex(raw);
  },

  verifyPassword: function (password, salt, hash) {
    if (!password || !salt || !hash) return false;
    var computed = Auth.hashPassword(password, salt);
    return computed === String(hash).toLowerCase();
  },

  createToken: function (user) {
    var payload = JSON.stringify({
      uid: user.user_id,
      em: user.email_normalized,
      exp: new Date().getTime() + (30 * 24 * 3600 * 1000) // 30 hari
    });
    var p64 = Utilities.base64EncodeWebSafe(payload);
    var sigBytes = Utilities.computeHmacSha256Signature(payload, Auth.getSecret(), Utilities.Charset.UTF_8);
    var sig64 = Utilities.base64EncodeWebSafe(sigBytes);
    return p64 + '.' + sig64;
  },

  verifyToken: function (token) {
    if (!token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length !== 2) return null;
    try {
      var p64 = parts[0], sig64 = parts[1];
      var payloadStr = Utilities.newBlob(Utilities.base64DecodeWebSafe(p64)).getDataAsString('UTF-8');
      var expectedSigBytes = Utilities.computeHmacSha256Signature(payloadStr, Auth.getSecret(), Utilities.Charset.UTF_8);
      var expectedSig64 = Utilities.base64EncodeWebSafe(expectedSigBytes);
      if (sig64 !== expectedSig64) return null;
      var data = JSON.parse(payloadStr);
      if (!data.exp || data.exp < new Date().getTime()) return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  verifiedEmail: function () {
    var c = Auth.current();
    return c.email;
  },

  current: function () {
    if (Auth._cur) return Auth._cur;

    // 1. Cek Token Login
    if (Auth._token) {
      var data = Auth.verifyToken(Auth._token);
      if (data && data.uid) {
        var u = DB.all(APP.SHEETS.USERS).filter(function (r) { return r.user_id === data.uid; })[0];
        if (u) {
          var emp = DB.find(APP.SHEETS.EMP, 'employee_id', u.employee_id);
          if (u.status !== 'AKTIF' || !emp || emp.status !== 'AKTIF') {
            throw new AppError('USER_INACTIVE', 'Akun Anda tidak aktif. Hubungi administrator.');
          }
          Auth._cur = { email: u.email_normalized, user: u, employee: emp, role: u.role, isAdmin: u.role === 'ADMIN' };
          return Auth._cur;
        }
      }
    }

    // 2. Fallback: Cek Google Workspace Session
    var email = '';
    try { email = Session.getActiveUser().getEmail(); } catch (x) { email = ''; }
    email = U.normEmail(email);
    if (email) {
      var uByEmail = DB.all(APP.SHEETS.USERS).filter(function (r) { return r.email_normalized === email; })[0];
      if (uByEmail) {
        var empByEmail = DB.find(APP.SHEETS.EMP, 'employee_id', uByEmail.employee_id);
        if (uByEmail.status !== 'AKTIF' || !empByEmail || empByEmail.status !== 'AKTIF') {
          throw new AppError('USER_INACTIVE', 'Akun Anda tidak aktif. Hubungi administrator.');
        }
        Auth._cur = { email: email, user: uByEmail, employee: empByEmail, role: uByEmail.role, isAdmin: uByEmail.role === 'ADMIN' };
        return Auth._cur;
      }
    }

    throw new AppError('AUTH_REQUIRED', 'Silakan masuk menggunakan akun Anda.');
  },

  requireAdmin: function () {
    var c = Auth.current();
    if (!c.isAdmin) {
      Audit.log('ACCESS_DENIED', 'Admin', c.email, null, { reason: 'FORBIDDEN' }, '');
      throw new AppError('FORBIDDEN', 'Anda tidak memiliki hak akses untuk operasi ini.');
    }
    return c;
  },

  login: function (identity, password) {
    identity = U.clean(identity, 100);
    password = String(password == null ? '' : password);
    if (!identity || !password) {
      throw new AppError('AUTH_FAILED', 'Email/NIP dan Kata Sandi wajib diisi.');
    }

    var normId = U.normEmail(identity);
    var users = DB.all(APP.SHEETS.USERS);
    var emps = DB.all(APP.SHEETS.EMP);

    var targetUser = null;
    var targetEmp = null;

    // 1. Cari berdasarkan email
    targetUser = users.filter(function (u) { return u.email_normalized === normId; })[0];
    if (targetUser) {
      targetEmp = emps.filter(function (e) { return e.employee_id === targetUser.employee_id; })[0];
    } else {
      // 2. Cari berdasarkan NIP / employee_number
      targetEmp = emps.filter(function (e) {
        return String(e.employee_number || '').trim().toLowerCase() === identity.toLowerCase();
      })[0];
      if (targetEmp) {
        targetUser = users.filter(function (u) { return u.employee_id === targetEmp.employee_id; })[0];
      }
    }

    if (!targetUser || !targetEmp) {
      Audit.log('LOGIN_FAILED', 'User', identity, null, { reason: 'USER_NOT_FOUND' }, 'Percobaan login gagal', identity);
      throw new AppError('AUTH_FAILED', 'Akun dengan Email atau NIP tersebut tidak ditemukan.');
    }

    if (targetUser.status !== 'AKTIF' || targetEmp.status !== 'AKTIF') {
      Audit.log('LOGIN_FAILED', 'User', targetUser.email_normalized, null, { reason: 'USER_INACTIVE' }, 'Akun nonaktif', targetUser.email_normalized);
      throw new AppError('USER_INACTIVE', 'Akun Anda tidak aktif. Silakan hubungi administrator.');
    }

    var ok = false;
    var salt = targetUser.password_salt || '';
    var hash = targetUser.password_hash || '';

    if (hash && salt) {
      ok = Auth.verifyPassword(password, salt, hash);
    } else {
      // Belum ada password tersimpan: cek password default
      var defPass = targetUser.role === 'ADMIN' ? 'admin123' : (targetEmp.employee_number || '123456');
      if (password === defPass || password === '123456' || (targetEmp.employee_number && password === targetEmp.employee_number)) {
        ok = true;
        salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
        hash = Auth.hashPassword(password, salt);
        DB.update(APP.SHEETS.USERS, 'user_id', targetUser.user_id, {
          password_salt: salt,
          password_hash: hash,
          updated_at: U.nowStr()
        });
      }
    }

    if (!ok) {
      Audit.log('LOGIN_FAILED', 'User', targetUser.email_normalized, null, { reason: 'WRONG_PASSWORD' }, 'Kata sandi salah', targetUser.email_normalized);
      throw new AppError('AUTH_FAILED', 'Kata sandi yang Anda masukkan salah.');
    }

    var token = Auth.createToken(targetUser);
    Audit.log('LOGIN_SUCCESS', 'User', targetUser.email_normalized, null, { role: targetUser.role }, 'Login berhasil', targetUser.email_normalized);

    return {
      token: token,
      user: {
        email: targetUser.email_normalized,
        name: targetEmp.full_name,
        role: targetUser.role,
        employee_id: targetEmp.employee_id,
        unit: targetEmp.unit
      }
    };
  },

  changePassword: function (oldPassword, newPassword) {
    var c = Auth.current();
    oldPassword = String(oldPassword || '');
    newPassword = String(newPassword || '');
    if (newPassword.length < 6) {
      throw new AppError('VALIDATION', 'Kata sandi baru minimal 6 karakter.');
    }
    var u = DB.find(APP.SHEETS.USERS, 'user_id', c.user.user_id);
    if (!u) throw new AppError('NOT_FOUND', 'User tidak ditemukan.');

    if (u.password_hash && u.password_salt) {
      if (!Auth.verifyPassword(oldPassword, u.password_salt, u.password_hash)) {
        throw new AppError('AUTH_FAILED', 'Kata sandi lama Anda salah.');
      }
    }
    var salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
    var hash = Auth.hashPassword(newPassword, salt);
    DB.update(APP.SHEETS.USERS, 'user_id', u.user_id, {
      password_salt: salt,
      password_hash: hash,
      updated_at: U.nowStr()
    });
    Audit.log('PASSWORD_CHANGE', 'User', u.email_normalized, null, {}, 'Ganti kata sandi mandiri', u.email_normalized);
    return true;
  },

  adminResetPassword: function (employeeId, newPassword) {
    Auth.requireAdmin();
    newPassword = String(newPassword || '');
    if (newPassword.length < 6) {
      throw new AppError('VALIDATION', 'Kata sandi baru minimal 6 karakter.');
    }
    var u = DB.all(APP.SHEETS.USERS).filter(function (x) { return x.employee_id === employeeId; })[0];
    if (!u) throw new AppError('NOT_FOUND', 'Akun pegawai tidak ditemukan.');
    var salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
    var hash = Auth.hashPassword(newPassword, salt);
    DB.update(APP.SHEETS.USERS, 'user_id', u.user_id, {
      password_salt: salt,
      password_hash: hash,
      updated_at: U.nowStr()
    });
    Audit.log('PASSWORD_RESET', 'User', u.email_normalized, null, {}, 'Reset kata sandi oleh administrator');
    return true;
  }
};
