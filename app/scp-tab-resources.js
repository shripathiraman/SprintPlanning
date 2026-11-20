/*
 * scp-tab-resources.js — Sprint Capacity Planner · Tab 2 Resources & Leave (US-12 to US-14)
 *
 * Resource list pre-filled from the sprint's Dev and BA people plus the team
 * (FR-15), with role, location, availability % and note per person (FR-18);
 * a day-by-person leave grid (FR-30); the office holidays that fall in the
 * sprint and one-off holidays for chosen locations (FR-17, FR-31).
 *
 * Everything here is stored in the plan (scp-plan.json) and saved with
 * Save plan. Leave is personal data: it never leaves this restricted page.
 */
(function (SCP) {
  'use strict';

  SCP.tabs = SCP.tabs || {};
  var tab = SCP.tabs.resources = {};
  var ui = SCP.ui = SCP.ui || {};
  var calc = SCP.calc;

  var view = {
    oneOffError: null,     // why the last one-off holiday was refused (US-14)
    addError: null         // why the last "Add resource" was refused
  };

  function S() { return SCP.state; }
  function cfg() { return SCP.state.config; }
  function plan() { return SCP.state.plan; }

  var ROLES = ['Dev', 'BA', 'Both'];

  /* ------------------------------------------------------------------ */
  /* Resource list (US-12)                                               */
  /* ------------------------------------------------------------------ */

  function find(list, id) {
    return (list || []).filter(function (r) { return r.id === id; })[0];
  }

  /** Every person named as Dev or BA on the plan's tickets: id -> { name, dev, ba }. */
  function ticketPeople(p) {
    var out = {};
    (p.tickets || []).forEach(function (t) {
      [['dev', t.dev], ['ba', t.ba]].forEach(function (k) {
        (k[1] || []).forEach(function (person) {
          var e = out[person.id] || (out[person.id] = { name: person.name, dev: false, ba: false });
          e[k[0]] = true;
        });
      });
    });
    return out;
  }

  function sourceLabel(onTickets, inTeam) {
    if (onTickets && inTeam) { return 'Tickets + team'; }
    return onTickets ? 'Tickets' : 'Team';
  }

  /**
   * Bring the resource list in line with the tickets (FR-15, US-12 AC-1, AC-2).
   * prev: the plan this one replaces, if any. Its people are the team, and
   * their role and location carry over. People the SM removed stay removed.
   * Returns true when anything changed.
   */
  tab.sync = function (p, prev) {
    if (!p) { return false; }
    var changed = false;
    if (!p.resources) { p.resources = []; changed = true; }
    if (!p.removed) { p.removed = []; }
    if (!p.leave) { p.leave = {}; }
    if (!p.oneOffs) { p.oneOffs = []; }
    if (!p.team) {
      // The team is whoever was on the last plan (and confirmed); none for a first plan.
      p.team = prev && prev.resources ? prev.resources.filter(function (r) { return !r.notInTeam; }).map(function (r) { return r.id; }) : [];
      changed = true;
    }
    var prevRes = (prev && prev.resources) || [];
    var onTickets = ticketPeople(p);

    // Team members carry over even when no ticket names them this sprint.
    prevRes.forEach(function (r) {
      if (r.notInTeam || find(p.resources, r.id) || p.removed.indexOf(r.id) !== -1) { return; }
      p.resources.push({ id: r.id, name: r.name, role: r.role, location: r.location, availability: 100, note: '',
        source: sourceLabel(!!onTickets[r.id], true), notInTeam: false });
      changed = true;
    });

    Object.keys(onTickets).forEach(function (id) {
      var t = onTickets[id];
      var existing = find(p.resources, id);
      var inTeam = p.team.indexOf(id) !== -1;
      if (existing) {
        var src = sourceLabel(true, inTeam || existing.source === 'Added');
        if (existing.source !== src && existing.source !== 'Added') { existing.source = src; changed = true; }
        return;
      }
      if (p.removed.indexOf(id) !== -1) { return; }
      var last = find(prevRes, id);
      p.resources.push({
        id: id,
        name: t.name,
        role: last ? last.role : (t.dev && t.ba ? 'Both' : (t.dev ? 'Dev' : 'BA')),
        location: last ? last.location : null,
        availability: 100,
        note: '',
        source: sourceLabel(true, inTeam),
        notInTeam: p.team.length > 0 && !inTeam
      });
      changed = true;
    });
    return changed;
  };

  /** Resources without a location: they block Capacity (US-12 AC-3). */
  tab.missingLocation = function () {
    var p = plan();
    return p && p.resources ? p.resources.filter(function (r) { return !r.location; }) : [];
  };

  function netText(r) {
    var c = calc.resourceCapacity(r, cfg(), plan());
    return c.net === null ? '—' : calc.fmt1(c.net);
  }

  function locationName(id) {
    var l = (cfg().locations || []).filter(function (x) { return x.id === id; })[0];
    return l ? l.name : '';
  }

  /* ------------------------------------------------------------------ */
  /* Rendering · resources                                               */
  /* ------------------------------------------------------------------ */

  function renderResources(p) {
    var locs = cfg().locations || [];
    var noCer = !ui.isNum(cfg().ceremonyPct);
    var rows = p.resources.map(function (r) {
      var id = ui.esc(r.id);
      var tag = r.notInTeam
        ? ' <span class="scp-tag scp-tag--warn" data-test="not-in-team">not in team</span>' +
          ' <button type="button" class="scp-link" data-act="confirm" data-id="' + id + '">Confirm</button>' +
          ' <button type="button" class="scp-link scp-link--danger" data-act="remove" data-id="' + id + '">Remove</button>'
        : '';
      var locOptions = '<option value="">' + (locs.length ? 'Choose…' : 'Add locations in Config') + '</option>' +
        locs.map(function (l) {
          return '<option value="' + ui.esc(l.id) + '"' + (l.id === r.location ? ' selected' : '') + '>' + ui.esc(l.name) + '</option>';
        }).join('');
      return '<tr data-id="' + id + '">' +
        '<th scope="row">' + ui.esc(r.name) + tag + '</th>' +
        '<td><span class="scp-tag">' + ui.esc(r.source) + '</span></td>' +
        '<td><select data-act="role" data-id="' + id + '" data-focus="role-' + id + '" aria-label="Role of ' + ui.esc(r.name) + '">' +
        ROLES.map(function (x) { return '<option' + (x === r.role ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></td>' +
        '<td><select data-act="location" data-id="' + id + '" data-focus="loc-' + id + '" class="' + (r.location ? '' : 'is-invalid') + '" aria-label="Location of ' + ui.esc(r.name) + '">' +
        locOptions + '</select></td>' +
        '<td><span class="scp-inline"><input class="scp-input scp-input--num" type="number" min="0" max="100" step="5" data-act="availability" data-id="' + id + '" data-focus="avail-' + id + '" value="' +
        ui.esc(r.availability) + '" aria-label="Availability of ' + ui.esc(r.name) + '"> %</span></td>' +
        '<td><input class="scp-input scp-input--note" data-act="note" data-id="' + id + '" data-focus="note-' + id + '" value="' + ui.esc(r.note || '') +
        '" placeholder="e.g. support rota" aria-label="Availability note for ' + ui.esc(r.name) + '"></td>' +
        '<td class="num"><b data-net="' + id + '"' + (noCer ? ' title="Set Team ceremony % in Config"' : '') + '>' + netText(r) + '</b></td>' +
        '<td class="num"><button type="button" class="scp-btn scp-btn--icon" data-act="remove" data-id="' + id + '" aria-label="Remove ' + ui.esc(r.name) + '">−</button></td>' +
        '</tr>';
    }).join('');
    var missing = tab.missingLocation();
    return '<section class="scp-card" data-test="resources">' +
      '<div class="scp-card__head"><div><h2>Resources</h2><div class="scp-muted">Pre-filled from the Dev and BA on this sprint’s tickets plus team members</div></div></div>' +
      '<table class="scp-table"><thead><tr><th>Name</th><th>Source</th><th>Role</th><th>Location</th><th>Availability</th><th>Availability note</th>' +
      '<th class="num">Net MD</th><th class="num"><span class="scp-sr">Remove</span></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="8" class="scp-muted">No people yet: the sprint’s tickets name no Dev or BA.</td></tr>') + '</tbody></table>' +
      (missing.length ? '<div class="scp-hint scp-bad" data-test="location-missing">Set a location for ' + ui.esc(missing.map(function (r) { return r.name; }).join(', ')) +
        ': Capacity and the Planning Calendar stay blocked until every resource has one.</div>' : '') +
      (noCer ? '<div class="scp-hint scp-muted">Net MD shows once Team ceremony % is set in Config.</div>' : '') +
      '<div class="scp-inline scp-addres"><input class="scp-input" data-add-name placeholder="Name" aria-label="Name of the resource to add">' +
      '<button type="button" class="scp-btn" data-act="add">+ Add resource</button></div>' +
      (view.addError ? '<div class="scp-hint scp-bad" data-test="add-error">' + ui.esc(view.addError) + '</div>' : '') +
      '</section>';
  }

  /* ------------------------------------------------------------------ */
  /* Rendering · leave grid (US-13)                                      */
  /* ------------------------------------------------------------------ */

  function renderLeave(p) {
    var days = calc.sprintDays(p, cfg());
    var head = days.map(function (d) {
      var parts = calc.fmtDay(d).split(' ');
      return '<span class="scp-grid__day"><span>' + parts[0] + '</span><b>' + parts[1] + '</b></span>';
    }).join('');
    var rows = p.resources.map(function (r) {
      var hols = {};
      calc.sprintHolidays(r.location, cfg(), p).forEach(function (h) { hols[h.date] = h.name; });
      var total = 0;
      var cells = days.map(function (d) {
        var when = calc.fmtDay(d);
        if (hols[d]) {
          return '<button type="button" class="scp-leave is-hol" disabled title="' + ui.esc(r.name + ', ' + when + ': office holiday (' + hols[d] + ')') +
            '" aria-label="' + ui.esc(r.name + ', ' + when + ': office holiday') + '">HOL</button>';
        }
        var k = calc.leaveKind(p, r.id, d);
        total += calc.leaveOn(p, r.id, d);
        var label = k ? calc.LEAVE_LABEL[k] : '';
        return '<button type="button" class="scp-leave' + (k ? ' is-' + k : '') + '" data-act="leave" data-id="' + ui.esc(r.id) +
          '" data-date="' + d + '" data-focus="leave-' + ui.esc(r.id) + '-' + d + '" aria-label="' + ui.esc(r.name + ', ' + when + ': ' + (label || 'working')) + '">' +
          label + '</button>';
      }).join('');
      return '<div class="scp-grid__row" data-test="leave-row" data-id="' + ui.esc(r.id) + '">' +
        '<span class="scp-grid__name">' + ui.esc(r.name) + (r.location ? ' <span class="scp-muted">· ' + ui.esc(locationName(r.location)) + '</span>' : '') + '</span>' +
        cells + '<b class="num" data-test="leave-total">' + calc.fmt1(total) + '</b></div>';
    }).join('');
    var cols = 'grid-template-columns: 170px repeat(' + days.length + ', minmax(36px, 1fr)) 80px';
    return '<section class="scp-card" data-test="leave">' +
      '<div class="scp-card__head"><div><h2>Leave</h2><div class="scp-muted">Click a day: free → Full day → Morning → Afternoon → free. Office holidays are locked.</div></div>' +
      '<div class="scp-legend"><span><i class="scp-sw scp-sw--full"></i>Full day</span><span><i class="scp-sw scp-sw--am"></i>Morning</span><span><i class="scp-sw scp-sw--pm"></i>Afternoon</span><span><i class="scp-sw scp-sw--hol"></i>Office holiday</span></div></div>' +
      '<div class="scp-scroll"><div class="scp-grid">' +
      '<div class="scp-grid__row scp-grid__head" style="' + cols + '"><span></span>' + head + '<span class="num">Leave days</span></div>' +
      rows.replace(/class="scp-grid__row" data-test="leave-row"/g, 'class="scp-grid__row" style="' + cols + '" data-test="leave-row"') +
      '</div></div></section>';
  }

  /* ------------------------------------------------------------------ */
  /* Rendering · holidays in this sprint (US-14)                         */
  /* ------------------------------------------------------------------ */

  /** One row per holiday date and name, with every location and person it hits (FR-31). */
  tab.holidayRows = function () {
    var p = plan();
    var byKey = {};
    var order = [];
    (cfg().locations || []).forEach(function (l) {
      calc.sprintHolidays(l.id, cfg(), p).forEach(function (h) {
        var key = h.date + '|' + h.name + '|' + h.source;
        if (!byKey[key]) { byKey[key] = { date: h.date, name: h.name, source: h.source, locations: [], people: [] }; order.push(key); }
        byKey[key].locations.push(l.name);
        p.resources.filter(function (r) { return r.location === l.id; }).forEach(function (r) { byKey[key].people.push(r.name); });
      });
    });
    return order.map(function (k) { return byKey[k]; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  };

  function renderHolidays(p) {
    var days = calc.sprintDays(p, cfg());
    var rows = tab.holidayRows().map(function (h) {
      var isOne = h.source === 'oneoff';
      return '<tr data-test="holiday-row"><th scope="row">' + ui.esc(calc.fmtDay(h.date)) + '</th><td>' + ui.esc(h.name) + '</td>' +
        '<td>' + ui.esc(h.locations.join(', ')) + (h.people.length ? ' · ' + ui.esc(h.people.join(', ')) : '') + '</td>' +
        '<td><span class="scp-tag ' + (isOne ? 'scp-tag--oneoff' : 'scp-tag--hol') + '">' + (isOne ? 'One-off' : 'Location calendar') + '</span></td>' +
        '<td class="num"><b>' + (h.people.length ? '−' : '') + calc.fmt1(h.people.length) + ' days</b></td>' +
        '<td class="num">' + (isOne ? '<button type="button" class="scp-btn scp-btn--icon" data-act="oneoff-del" data-date="' + h.date + '" data-name="' + ui.esc(h.name) +
          '" aria-label="Remove one-off ' + ui.esc(h.name) + '">−</button>' : '') + '</td></tr>';
    }).join('');
    var locs = (cfg().locations || []).map(function (l) {
      return '<label class="scp-chip"><input type="checkbox" data-oneoff-loc value="' + ui.esc(l.id) + '"> ' + ui.esc(l.name) + '</label>';
    }).join('');
    return '<section class="scp-card" data-test="holidays">' +
      '<div class="scp-card__head"><div><h2>Office holidays in this sprint</h2><div class="scp-muted">From each location’s yearly calendar · ' +
      '<button type="button" class="scp-link scp-link--inline" data-act="edit-calendars">edit yearly calendars in Config</button></div></div></div>' +
      '<table class="scp-table"><thead><tr><th>Date</th><th>Holiday</th><th>Applies to</th><th>Source</th><th class="num">Capacity effect</th><th class="num"><span class="scp-sr">Remove</span></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6" class="scp-muted">No office holiday falls in this sprint.</td></tr>') + '</tbody></table>' +
      '<div class="scp-oneoff"><b>Add a one-off holiday for this sprint only</b>' +
      '<div class="scp-inline">' +
      '<label class="scp-field"><span>Date</span><input class="scp-input" type="date" data-oneoff-date min="' + (days[0] || '') + '" max="' + (days[days.length - 1] || '') + '"></label>' +
      '<label class="scp-field"><span>Name</span><input class="scp-input" data-oneoff-name placeholder="e.g. Office closure"></label>' +
      '<div class="scp-field"><span>Locations</span><div class="scp-chips">' + (locs || '<span class="scp-muted">Add locations in Config</span>') + '</div></div>' +
      '<button type="button" class="scp-btn" data-act="oneoff-add">Add holiday</button></div>' +
      (view.oneOffError ? '<div class="scp-hint scp-bad" data-test="oneoff-error">' + ui.esc(view.oneOffError) + '</div>' : '') +
      '</div></section>';
  }

  tab.render = function (head, body) {
    var p = plan();
    if (p && tab.sync(p, null)) { SCP.app.markDirty(); }
    SCP.app.planHead(head, { sub: 'Who is on the sprint, where they work, and when they are away · changes recalculate Capacity and the Calendar' });
    if (!p) {
      body.innerHTML = '<div class="scp-card scp-empty" data-test="no-plan"><h2>No plan open</h2><p class="scp-muted">Open a plan in 1 · Sprint Tickets first.</p></div>';
      return;
    }
    body.innerHTML = renderResources(p) + renderLeave(p) + renderHolidays(p);
    bind(body);
  };

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function changed() {
    SCP.app.markDirty();
    setTimeout(function () { SCP.app.render(); }, 0);
  }

  function removeResource(id) {
    var p = plan();
    p.resources = p.resources.filter(function (r) { return r.id !== id; });
    if (p.removed.indexOf(id) === -1) { p.removed.push(id); }
    delete p.leave[id];
    changed();
  }

  /** Free -> Full day -> Morning -> Afternoon -> free (FR-30, US-13 AC-1). */
  var NEXT_LEAVE = { none: 1, full: 'am', am: 'pm', pm: null };
  function cycleLeave(id, date) {
    var p = plan();
    var l = p.leave[id] || (p.leave[id] = {});
    var next = NEXT_LEAVE[calc.leaveKind(p, id, date) || 'none'];
    if (next) { l[date] = next; } else { delete l[date]; }
    changed();
  }

  /** One-off holiday for chosen locations, this sprint only (FR-17, US-14 AC-2). */
  function addOneOff(root) {
    var p = plan();
    var date = root.querySelector('[data-oneoff-date]').value;
    var name = root.querySelector('[data-oneoff-name]').value.trim();
    var locs = Array.prototype.slice.call(root.querySelectorAll('[data-oneoff-loc]:checked')).map(function (x) { return x.value; });
    var days = calc.sprintDays(p, cfg());
    var err = null;
    if (!date) { err = 'Enter a date'; }
    else if (days.indexOf(date) === -1) {
      err = calc.isWorkingDay(date, cfg().workingWeek) ? calc.fmtDay(date) + ' is outside this sprint' : calc.validateHoliday(date, cfg().workingWeek);
    }
    else if (!name) { err = 'Enter the holiday name'; }
    else if (!locs.length) { err = 'Tick at least one location'; }
    else if (p.oneOffs.some(function (o) { return o.date === date && o.name === name; })) { err = 'This one-off holiday is already listed'; }
    view.oneOffError = err;
    if (!err) { p.oneOffs.push({ date: date, name: name, locations: locs }); }
    changed();
  }

  function addResource(root) {
    var p = plan();
    var name = root.querySelector('[data-add-name]').value.trim();
    view.addError = name ? null : 'Enter the name of the person to add';
    if (name && p.resources.some(function (r) { return r.name.toLowerCase() === name.toLowerCase(); })) {
      view.addError = name + ' is already in the list';
    }
    if (!view.addError) {
      var id = 'added-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
      p.resources.push({ id: id, name: name, role: 'Dev', location: null, availability: 100, note: '', source: 'Added', notInTeam: false });
      p.team.push(id);
    }
    changed();
  }

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) { return; }
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    var p = plan();
    if (act === 'leave') {
      cycleLeave(id, el.getAttribute('data-date'));
    } else if (act === 'confirm') {
      find(p.resources, id).notInTeam = false;
      if (p.team.indexOf(id) === -1) { p.team.push(id); }
      changed();
    } else if (act === 'remove') {
      removeResource(id);
    } else if (act === 'add') {
      addResource(S().root);
    } else if (act === 'oneoff-add') {
      addOneOff(S().root);
    } else if (act === 'oneoff-del') {
      var d = el.getAttribute('data-date');
      var n = el.getAttribute('data-name');
      p.oneOffs = p.oneOffs.filter(function (o) { return !(o.date === d && o.name === n); });
      changed();
    } else if (act === 'edit-calendars') {
      // Yearly calendars live in Config (FR-31, US-14 AC-3).
      SCP.app.setTab('config');
      if (SCP.tabs.config.showLocations) { SCP.tabs.config.showLocations(); }
    }
  }

  /** Typing: availability updates the row's net MD at once (US-12 AC-4); note is stored. */
  function onInput(e) {
    var el = e.target;
    var act = el.getAttribute('data-act');
    var r = find(plan().resources, el.getAttribute('data-id'));
    if (!r) { return; }
    if (act === 'availability') {
      var v = ui.num(el.value);
      r.availability = v === null ? 0 : Math.max(0, Math.min(100, v));
      var cell = S().root.querySelector('[data-net="' + r.id + '"]');
      if (cell) { cell.textContent = netText(r); }
      SCP.app.markDirty();
    } else if (act === 'note') {
      r.note = el.value;
      SCP.app.markDirty();
    }
  }

  function onChange(e) {
    var el = e.target;
    var act = el.getAttribute('data-act');
    var r = find(plan().resources, el.getAttribute('data-id'));
    if (!r) { return; }
    if (act === 'role') { r.role = el.value; changed(); }
    else if (act === 'location') { r.location = el.value || null; changed(); }
    else if (act === 'availability' || act === 'note') { onInput(e); changed(); }
  }

  function bind(body) {
    body.addEventListener('click', onClick);
    body.addEventListener('input', onInput);
    body.addEventListener('change', onChange);
  }
}(window.SCP = window.SCP || {}));
