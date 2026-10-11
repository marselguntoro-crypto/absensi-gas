/**
 * Audit.gs — jejak perubahan administratif dan percobaan tidak sah.
 */
var Audit = {
  log: function (action, entityType, entityId, before, after, reason, actorOverride) {
    var actor = actorOverride;
    if (!actor) {
      if (Auth._cur) actor = Auth._cur.user.user_id + ' <' + Auth._cur.email + '>';
      else { try { actor = Session.getActiveUser().getEmail(); } catch (e) { actor = ''; } }
    }
    var j = function (v) { return v == null ? '' : JSON.stringify(v).substr(0, 4000); };
    DB.append(APP.SHEETS.AUDIT, {
      log_id: U.id('LOG'), actor_id: actor || '', action: action, entity_type: entityType,
      entity_id: entityId == null ? '' : String(entityId), before_json: j(before), after_json: j(after),
      reason: reason || '', timestamp_server: U.nowStr()
    });
  },

  list: function (f) {
    Auth.requireAdmin();
    f = f || {};
    var q = String(f.q || '').toLowerCase(), from = f.from || '', to = f.to || '';
    var rows = DB.all(APP.SHEETS.AUDIT).filter(function (r) {
      var d = String(r.timestamp_server).substr(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (f.action && r.action !== f.action) return false;
      if (q && (r.actor_id + ' ' + r.action + ' ' + r.entity_type + ' ' + r.entity_id + ' ' + r.reason).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return a.timestamp_server < b.timestamp_server ? 1 : -1; });
    var p = U.page(rows, f.page, f.size);
    p.rows = p.rows.map(function (r) { delete r.__row; return r; });
    return p;
  },

  attempts: function (f) {
    Auth.requireAdmin();
    f = f || {};
    var emps = {};
    DB.all(APP.SHEETS.EMP).forEach(function (e) { emps[e.employee_id] = e; });
    var q = String(f.q || '').toLowerCase();
    var rows = DB.all(APP.SHEETS.TRY).filter(function (r) {
      var d = String(r.attempted_at).substr(0, 10);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      var name = (emps[r.employee_id] || {}).full_name || '';
      return !q || (name + ' ' + r.reason_code).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return a.attempted_at < b.attempted_at ? 1 : -1; });
    var p = U.page(rows, f.page, f.size);
    p.rows = p.rows.map(function (r) { r.full_name = (emps[r.employee_id] || {}).full_name || ''; delete r.__row; return r; });
    return p;
  }
};
