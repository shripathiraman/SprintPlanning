/*
 * scp-publish.js — Sprint Capacity Planner · Publish to team (FR-29, US-23, US-24)
 *
 * Publish makes the plan readable by the whole team without exposing leave:
 *
 *   1. The parent page "Sprint plans - <Squad>" is found by the page ID stored
 *      in the config, or by its title; the first Publish creates it next to
 *      the planning page.
 *   2. The read-only viewer (scp-view.css, scp-view.js) is written to that
 *      parent page on every Publish, so every sprint page shows the current
 *      viewer and the viewer never sits on the restricted planning page
 *      (File Structure).
 *   3. The sprint page "<Sprint name> - <Squad>" is created under the parent,
 *      or updated when this plan published it before; its body is the small
 *      HTML macro that loads the viewer from the parent page.
 *   4. The snapshot scp-snapshot.json is put on the sprint page. It holds
 *      tickets, cards, load and net capacity per person and the verdict; no
 *      leave dates, availability % or holidays per person (US-23 AC-3).
 *
 * A page that already has the sprint page's title but was not created by this
 * plan is never overwritten: Publish stops, or uses "(plan)" after the title
 * when the SM agrees (Edge Cases).
 */
(function (SCP) {
  'use strict';

  var publish = SCP.publish = {};
  var ui = SCP.ui = SCP.ui || {};

  function S() { return SCP.state; }

  /* ------------------------------------------------------------------ */
  /* Titles                                                              */
  /* ------------------------------------------------------------------ */

  publish.squad = function () {
    return (S().config.jira.team || '').trim();
  };

  publish.parentTitle = function () {
    return 'Sprint plans - ' + publish.squad();
  };

  publish.sprintTitle = function (plan) {
    return plan.sprint.name + ' - ' + publish.squad();
  };

  /* ------------------------------------------------------------------ */
  /* Snapshot (no leave, availability or holidays per person)            */
  /* ------------------------------------------------------------------ */

  /**
   * What the sprint page shows. Built from the same calendar as Tab 4, so the
   * published numbers are the planner's numbers.
   */
  publish.snapshot = function (plan, config, who, when) {
    var calc = SCP.calc;
    var cal = calc.planCalendar(plan, config);
    var v = SCP.tabs.calendar.verdictText(cal);
    function round(n) { return calc.round1(n); }
    var sp = (plan.tickets || []).reduce(function (s, t) { return s + (ui.isNum(t.sp) ? t.sp : 0); }, 0);
    return {
      schemaVersion: 1,
      squad: publish.squad(),
      sprint: { id: plan.sprint.id, name: plan.sprint.name, goal: plan.sprint.goal || '', start: plan.sprint.start, end: plan.sprint.end, workingDays: cal.W },
      publishedBy: who,
      publishedAt: when,
      thresholds: { under: config.thresholds.under, over: config.thresholds.over },
      verdict: { status: cal.verdict.status, title: v.title, detail: v.detail },
      totals: {
        planned: round(cal.planned), net: round(cal.capacity.totals.net), tickets: (plan.tickets || []).length, sp: sp,
        dev: { load: round(cal.roles.dev.load), net: round(cal.roles.dev.net) },
        ba: { load: round(cal.roles.ba.load), net: round(cal.roles.ba.net) }
      },
      people: cal.rows.map(function (r) {
        return {
          name: r.resource.name, role: r.resource.role, load: round(r.load), net: round(r.net),
          pct: isFinite(r.pct) ? Math.round(r.pct) : null,
          cards: r.cards.map(function (k) { return { key: k.key, role: k.role, md: round(k.md) }; })
        };
      }),
      unassigned: {
        md: round(cal.unassigned.reduce(function (s, k) { return s + k.md; }, 0)),
        cards: cal.unassigned.map(function (k) { return { key: k.key, role: k.role, md: round(k.md), noSp: k.role === 'none' }; })
      }
    };
  };

  /* ------------------------------------------------------------------ */
  /* Viewer written to the parent page (scp-view.js, scp-view.css)       */
  /* ------------------------------------------------------------------ */

  /**
   * The read-only viewer. It runs on each sprint page (never here): reads the
   * page's scp-snapshot.json and draws it. It must not use anything from the
   * planner, because only its own source text is published.
   */
  function viewer() {
    'use strict';
    var root = document.getElementById('scp-view');
    if (!root) { return; }
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var STATUS = { feasible: 'Feasible', atRisk: 'At risk', notFeasible: 'Not feasible' };
    var SCALE = 130;                       // a bar's full width is 130% of net capacity; a line marks 100%

    function meta(name) {
      var m = document.querySelector('meta[name="' + name + '"]');
      return m ? m.getAttribute('content') || '' : '';
    }
    function esc(s) {
      return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function f1(n) { return (Math.round(n * 10 + 1e-9) / 10).toFixed(1); }
    function day(iso) {
      var d = new Date(iso + 'T00:00:00Z');
      return { dow: DOW[d.getUTCDay()], n: d.getUTCDate(), m: MON[d.getUTCMonth()], y: d.getUTCFullYear() };
    }
    function range(a, b) {
      var x = day(a);
      var y = day(b);
      return x.dow + ' ' + x.n + (x.m !== y.m || x.y !== y.y ? ' ' + x.m : '') + (x.y !== y.y ? ' ' + x.y : '') +
        ' – ' + y.dow + ' ' + y.n + ' ' + y.m + ' ' + y.y;
    }
    function when(iso) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) { return ''; }
      return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' +
        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
    function loadClass(pct, t) {
      if (pct === null) { return 'over'; }
      return pct > t.over ? 'over' : (pct < t.under ? 'under' : 'ok');
    }
    function chip(c) {
      return '<span class="scpv-chip scpv-chip--' + esc(c.role) + '">' + esc(c.key) + ' · ' + (c.noSp ? 'no SP' : f1(c.md)) + '</span>';
    }
    function mark() {
      return '<div class="scpv-mark" style="left:' + (100 / SCALE * 100).toFixed(1) + '%"></div>';
    }

    function draw(s) {
      var t = s.totals;
      var v = s.verdict;
      var line = v.title.split(' — ')[1] || '';
      line = line ? line.charAt(0).toUpperCase() + line.slice(1) : '';
      var rows = s.people.map(function (p) {
        var cls = loadClass(p.pct, s.thresholds);
        var w = p.pct === null ? 100 : Math.min(100, p.pct / SCALE * 100);
        return '<div class="scpv-row" data-person="' + esc(p.name) + '">' +
          '<div class="scpv-who"><b>' + esc(p.name) + '</b><span>' + esc(p.role) + '</span></div>' +
          '<div class="scpv-mid"><div class="scpv-track"><div class="scpv-fill scpv-fill--' + cls + '" style="width:' + w.toFixed(1) + '%"></div>' + mark() + '</div>' +
          '<div class="scpv-chips">' + p.cards.map(chip).join('') + '</div></div>' +
          '<span class="scpv-badge scpv-badge--' + cls + '" data-test="view-load">' + f1(p.load) + ' / ' + f1(p.net) +
          (p.pct === null ? '' : ' · ' + p.pct + '%') + '</span></div>';
      }).join('');
      var u = s.unassigned;
      if (u.cards.length) {
        rows += '<div class="scpv-row" data-person="">' +
          '<div class="scpv-who"><b>Unassigned</b><span>' + u.cards.length + (u.cards.length === 1 ? ' card' : ' cards') + '</span></div>' +
          '<div class="scpv-mid"><div class="scpv-track">' + mark() + '</div>' +
          '<div class="scpv-chips">' + u.cards.map(chip).join('') + '</div></div>' +
          '<span class="scpv-badge" data-test="view-load">' + f1(u.md) + ' MD</span></div>';
      }
      root.innerHTML =
        '<div class="scpv">' +
        '<div class="scpv-ro">Read-only · visible to everyone who can view this page</div>' +
        '<div class="scpv-sub" data-test="view-sub">' + esc(range(s.sprint.start, s.sprint.end) + ' · ' + s.sprint.workingDays + ' working days' +
          (s.sprint.goal ? ' · Goal: ' + s.sprint.goal : '')) + '</div>' +
        '<div class="scpv-pub" data-test="view-published">Snapshot published by ' + esc(s.publishedBy || 'the Scrum Master') + ' on ' +
          esc(when(s.publishedAt)) + ' · republishing updates this page</div>' +
        '<div class="scpv-verdict scpv-verdict--' + esc(v.status) + '" data-test="view-verdict" data-status="' + esc(v.status) + '">' +
        '<div class="scpv-verdict__text"><b>' + esc(STATUS[v.status] || v.status) + '</b><span>' +
          esc(line + (line && v.detail ? '. ' : '') + v.detail) + '</span></div>' +
        '<div class="scpv-figs"><div><span>Planned</span><b>' + f1(t.planned) + ' MD</b></div>' +
        '<div><span>Net capacity</span><b>' + f1(t.net) + ' MD</b></div>' +
        '<div><span>Tickets · SP</span><b>' + t.tickets + ' · ' + t.sp + '</b></div></div></div>' +
        '<div class="scpv-card"><div class="scpv-card__head"><h2>Load per person</h2><span>Load / net capacity in MD · line marks 100%</span></div>' +
        rows + '</div>' +
        '<p class="scpv-foot">This page holds a snapshot only. Leave dates, availability and personal holidays stay on the restricted planning page.</p>' +
        '</div>';
    }

    function fail(msg) {
      root.innerHTML = '<p class="scpv-error">Sprint plan: ' + esc(msg) + '</p>';
    }

    var ctx = meta('ajs-context-path');
    var pageId = meta('ajs-page-id');
    fetch(ctx + '/rest/api/content/' + encodeURIComponent(pageId) + '/child/attachment?filename=scp-snapshot.json', {
      credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (!res.ok) { throw new Error('could not read this page’s attachments (HTTP ' + res.status + ')'); }
      return res.json();
    }).then(function (body) {
      var att = body && body.results && body.results[0];
      if (!att) { throw new Error('scp-snapshot.json is not attached to this page. Publish the plan again'); }
      return fetch(ctx + att._links.download, { credentials: 'same-origin', cache: 'no-store' });
    }).then(function (res) {
      if (!res.ok) { throw new Error('could not download the snapshot (HTTP ' + res.status + ')'); }
      return res.json();
    }).then(draw, function (err) { fail(err.message); });
  }

  /** scp-view.js as it is written to the parent page. */
  publish.viewerJs = function () {
    return '/*\n * scp-view.js — Sprint Capacity Planner · read-only viewer for the sprint pages.\n' +
      ' * Written to this page by Publish; every sprint page below loads it.\n' +
      ' * Do not edit it here: the next Publish replaces it.\n */\n(' + viewer.toString() + '());\n';
  };

  /** scp-view.css as it is written to the parent page. */
  publish.viewerCss = function () {
    return [
      '/* scp-view.css — Sprint Capacity Planner · read-only viewer. Written by Publish; do not edit here. */',
      '/* Reset first, as the Release Impact admin tool: drop the styles the Confluence page gives these elements. */',
      '#scp-view .scpv, #scp-view .scpv *:where(:not(svg, svg *)), #scp-view .scpv *::before, #scp-view .scpv *::after { all: revert; box-sizing: border-box; }',
      '#scp-view .scpv *:where(:not(svg, svg *)) { font-family: inherit !important; }',
      '#scp-view .scpv { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif !important; color: #16202e; display: flex; flex-direction: column; gap: 16px; max-width: 1136px; }',
      '#scp-view .scpv-ro { align-self: flex-end; font-size: 12px; color: #5a6474; }',
      '#scp-view .scpv-sub { color: #5a6474; }',
      '#scp-view .scpv-pub { color: #5a6474; font-size: 12px; margin-top: -12px; }',
      '#scp-view .scpv-verdict { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px 32px; align-items: center; border: 1px solid; border-radius: 12px; padding: 16px 20px; }',
      '#scp-view .scpv-verdict--atRisk { background: #fff4db; border-color: #f0d39a; color: #5c3a00; }',
      '#scp-view .scpv-verdict--notFeasible { background: #fdecea; border-color: #f3b8b1; color: #7a1a12; }',
      '#scp-view .scpv-verdict--feasible { background: #e6f4ec; border-color: #a9d8bd; color: #14532d; }',
      '#scp-view .scpv-verdict__text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 420px; }',
      '#scp-view .scpv-verdict__text b { font-size: 16px; }',
      '#scp-view .scpv-figs { display: flex; gap: 28px; }',
      '#scp-view .scpv-figs div { display: flex; flex-direction: column; font-size: 12px; }',
      '#scp-view .scpv-figs b { font-size: 19px; color: #16202e; }',
      '#scp-view .scpv-card { background: #fff; border: 1px solid #e3e7ee; border-radius: 12px; padding: 20px 24px; }',
      '#scp-view .scpv-card__head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid #edf0f4; }',
      '#scp-view .scpv-card__head h2 { margin: 0; font-size: 16px; }',
      '#scp-view .scpv-card__head span { font-size: 12px; color: #5a6474; }',
      '#scp-view .scpv-row { display: grid; grid-template-columns: 200px 1fr 150px; gap: 20px; align-items: center; padding: 14px 0; border-bottom: 1px solid #edf0f4; }',
      '#scp-view .scpv-row:last-child { border-bottom: 0; }',
      '#scp-view .scpv-who { display: flex; flex-direction: column; }',
      '#scp-view .scpv-who span { font-size: 12px; color: #5a6474; }',
      '#scp-view .scpv-mid { display: flex; flex-direction: column; gap: 8px; min-width: 0; }',
      '#scp-view .scpv-track { position: relative; height: 10px; border-radius: 5px; background: #edf0f4; }',
      '#scp-view .scpv-fill { height: 100%; border-radius: 5px; }',
      '#scp-view .scpv-fill--under { background: #d69e24; }',
      '#scp-view .scpv-fill--ok { background: #2e8b57; }',
      '#scp-view .scpv-fill--over { background: #c0392b; }',
      '#scp-view .scpv-mark { position: absolute; top: -4px; bottom: -4px; width: 2px; background: #16202e; }',
      '#scp-view .scpv-chips { display: flex; flex-wrap: wrap; gap: 6px; }',
      '#scp-view .scpv-chip { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }',
      '#scp-view .scpv-chip--dev { background: #dce6fb; color: #1d3f91; }',
      '#scp-view .scpv-chip--ba { background: #fce3cc; color: #7a3e0a; }',
      '#scp-view .scpv-chip--none { background: #f1f3f6; color: #5a6474; }',
      '#scp-view .scpv-badge { justify-self: end; font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 6px; background: #edf0f4; white-space: nowrap; }',
      '#scp-view .scpv-badge--under { background: #fff4db; color: #7a5200; }',
      '#scp-view .scpv-badge--ok { background: #e6f4ec; color: #14532d; }',
      '#scp-view .scpv-badge--over { background: #fdecea; color: #a3201a; }',
      '#scp-view .scpv-foot { font-size: 12px; color: #5a6474; margin: 0; }',
      '#scp-view .scpv-error { color: #b42318; }',
      '@media (max-width: 760px) { #scp-view .scpv-row { grid-template-columns: 1fr; } #scp-view .scpv-badge { justify-self: start; } }'
    ].join('\n') + '\n';
  };

  /**
   * Body of the sprint page in Confluence storage format: an HTML macro that
   * loads the viewer from the parent page. Written into the page body, not as a file (PRD File Structure).
   */
  publish.macroBody = function (parentId) {
    var loader =
      '<div id="scp-view"><p>Loading the sprint plan…</p></div>\n' +
      '<script>\n' +
      '  /* Sprint Capacity Planner: loads the read-only viewer from the parent page. Written by Publish. */\n' +
      '  (function () {\n' +
      '    var PARENT = ' + JSON.stringify(String(parentId)) + ';\n' +
      '    function meta(n) { var m = document.querySelector(\'meta[name="\' + n + \'"]\'); return m ? m.getAttribute(\'content\') || \'\' : \'\'; }\n' +
      '    var base = meta(\'ajs-context-path\') + \'/download/attachments/\' + PARENT + \'/\';\n' +
      '    function get(name) {\n' +
      '      return fetch(base + name + \'?api=v2\', { credentials: \'same-origin\', cache: \'no-store\' }).then(function (r) {\n' +
      '        if (!r.ok) { throw new Error(name + \' is missing on the parent page (HTTP \' + r.status + \')\'); }\n' +
      '        return r.text();\n' +
      '      });\n' +
      '    }\n' +
      '    Promise.all([get(\'scp-view.css\'), get(\'scp-view.js\')]).then(function (f) {\n' +
      '      var st = document.createElement(\'style\'); st.textContent = f[0]; document.head.appendChild(st);\n' +
      '      var sc = document.createElement(\'script\'); sc.textContent = f[1]; document.body.appendChild(sc);\n' +
      '    }).catch(function (e) {\n' +
      '      document.getElementById(\'scp-view\').innerHTML = \'<p style="color:#b42318">Sprint plan: \' + e.message + \'. Publish the plan again from the planning page.</p>\';\n' +
      '    });\n' +
      '  }());\n' +
      '</script>\n';
    return '<ac:structured-macro ac:name="html" ac:schema-version="1"><ac:plain-text-body><![CDATA[' + loader +
      ']]></ac:plain-text-body></ac:structured-macro>';
  };

  /* ------------------------------------------------------------------ */
  /* Publish                                                             */
  /* ------------------------------------------------------------------ */

  /** Why Publish cannot run now, or '' (the button's title). */
  publish.blocker = function () {
    var s = S();
    if (SCP.app.noWrite()) { return SCP.app.NO_WRITE; }
    if (!s.plan) { return 'Open a plan first'; }
    if (!publish.squad()) { return 'Pick the Team (squad) in Config first: it names the published pages'; }
    if (s.planDirty) { return 'Save the plan first: Publish shares the saved plan'; }
    if (s.saving || s.publishing) { return 'Busy…'; }
    var gate = SCP.app.gate('calendar');
    if (gate) { return 'The plan cannot be calculated yet: ' + gate.msg; }
    return '';
  };

  function step(text) {
    SCP.app.notice('info', ui.esc(text));
  }

  /** The parent page "Sprint plans - <Squad>": stored ID, else by title, else created (FR-29). */
  function parentPage(here) {
    var cfg = S().config;
    var stored = cfg.publish && cfg.publish.parentId;
    var title = publish.parentTitle();
    return (stored ? SCP.store.page(stored) : Promise.resolve(null)).then(function (p) {
      if (p) { return p; }
      var ask = !stored ? Promise.resolve(true) : ui.confirm({ title: 'Parent page deleted', ok: 'Create a new parent page',
        message: 'The parent page “' + title + '” that earlier plans were published under was deleted.\n\nCreate a new parent page?' });
      return ask.then(function (yes) {
        if (!yes) { throw new Error('stopped: the parent page was deleted and no new one was created'); }
        return SCP.store.findPage(here.space, title);
      }).then(function (found) {
        if (found) { return found; }
        var under = here.ancestors.length ? here.ancestors[here.ancestors.length - 1].id : null;
        step('Creating the parent page “' + title + '”…');
        return SCP.store.createPage(here.space, title, under,
          '<p>Published sprint plans of ' + ui.esc(publish.squad()) + '. Each child page is one sprint, published from the planning page.</p>');
      });
    }).then(function (p) {
      if (cfg.publish && cfg.publish.parentId === p.id) { return p; }
      // Remember the parent by ID, so a rename or move does not lose it (Edge Cases).
      cfg.publish = { parentId: p.id };
      return SCP.store.save('scp-config.json', cfg, S().configMeta ? S().configMeta.version : 0, { comment: 'Parent page of published sprint plans' })
        .then(function (meta) { S().configMeta = meta; return p; }, function () { return p; });
    });
  }

  /** The sprint page: the one this plan published before, else a new one; never someone else's (Edge Cases). */
  function sprintPage(here, parent, body) {
    var plan = S().plan;
    var known = plan.published && plan.published.pageId;
    return (known ? SCP.store.page(known) : Promise.resolve(null)).then(function (p) {
      if (p) {
        step('Updating “' + p.title + '”…');
        return SCP.store.updatePage(p, body);
      }
      var title = publish.sprintTitle(plan);
      return SCP.store.findPage(here.space, title).then(function (clash) {
        if (!clash) { return title; }
        var alt = title + ' (plan)';
        return ui.confirm({ title: 'A page with this title exists', ok: 'Publish as “' + alt + '”',
          message: 'A page called “' + title + '” already exists in this space and was not created by this plan. ' +
            'It will not be changed.\n\nPublish as “' + alt + '” instead?\n(Cancel to stop and rename that page first.)' }).then(function (yes) {
          if (!yes) {
            throw new Error('stopped: a page called “' + title + '” already exists and was not created by this plan. ' +
              'Rename it, or publish again and accept “' + alt + '”');
          }
          return SCP.store.findPage(here.space, alt);
        }).then(function (again) {
          if (again) { throw new Error('stopped: “' + alt + '” also exists. Rename one of the two pages first'); }
          return alt;
        });
      }).then(function (t) {
        step('Creating “' + t + '”…');
        return SCP.store.createPage(here.space, t, parent.id, body);
      });
    });
  }

  /** Publish to team (FR-29, US-23). Resolves the sprint page, or null when stopped. */
  publish.run = function () {
    var why = publish.blocker();
    if (why) {
      SCP.app.notice('warn', ui.esc('Publish: ' + why + '.'));
      return Promise.resolve(null);
    }
    var s = S();
    var plan = s.plan;
    var who = SCP.store.currentUser() || s.conn.user || '';
    var when = new Date().toISOString();
    var snap = publish.snapshot(plan, s.config, who, when);
    var here;
    var parent;
    var page;
    s.publishing = true;
    SCP.app.render();
    step('Publishing…');
    return SCP.store.page(SCP.store.pageId()).then(function (p) {
      if (!p) { throw new Error('the planning page could not be read'); }
      here = p;
      return parentPage(here);
    }).then(function (p) {
      parent = p;
      step('Writing the viewer to “' + parent.title + '”…');
      return SCP.store.putFile(parent.id, 'scp-view.css', publish.viewerCss(), 'text/css').then(function () {
        return SCP.store.putFile(parent.id, 'scp-view.js', publish.viewerJs(), 'application/javascript');
      });
    }).then(function () {
      return sprintPage(here, parent, publish.macroBody(parent.id));
    }).then(function (p) {
      page = p;
      step('Writing the snapshot…');
      return SCP.store.putFile(page.id, 'scp-snapshot.json', JSON.stringify(snap, null, 2), 'application/json');
    }).then(function () {
      // Keep the sprint page's ID with the plan, so the next Publish updates the same page (US-23 AC-2).
      plan.published = { pageId: page.id, title: page.title, parentId: parent.id, at: when, by: who };
      s.publishing = false;
      return SCP.app.savePlan(false).then(function () {
        SCP.app.notice('ok', 'Published to <a href="' + ui.esc(page.url) + '" target="_blank" rel="noopener" data-test="published-link">' +
          ui.esc(page.title) + '</a>, readable by everyone who can view it. Leave and availability are not on it.');
        return page;
      });
    }).catch(function (err) {
      s.publishing = false;
      SCP.app.render();
      var stopped = /^stopped/.test(err.message);
      SCP.app.notice(stopped ? 'warn' : 'error', ui.esc('Publish ' + (stopped ? err.message : 'failed: ' + err.message) + '.'));
      return null;
    });
  };
}(window.SCP = window.SCP || {}));
