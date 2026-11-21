/*
 * tests/mock-env.js — TEST ONLY, never attach to Confluence.
 *
 * Replaces window.fetch with a fake Confluence + Jira so the planner runs in a
 * plain browser:
 *   - Jira calls through /plugins/servlet/applinks/proxy answer from FIXTURES
 *   - Confluence REST calls (pages, attachments, read restrictions) read/write localStorage
 * A scenario switch reproduces the connection failures of US-01:
 *   localStorage['scp-mock-scenario'] = ok | unauthorised | noperm | nolink | down
 */
(function () {
  'use strict';

  var LS_SCENARIO = 'scp-mock-scenario';
  var LS_ATT = 'scp-mock-attachments';
  var LS_USER = 'scp-mock-user';
  var LS_FIX = 'scp-mock-fixture-overrides';
  var PAGE_ID = '900001';

  var MOCK = window.SCP_MOCK = {
    calls: [],
    requests: [],          // every Confluence request and every Jira proxy call, with its method
    scenario: function () { return localStorage.getItem(LS_SCENARIO) || 'ok'; }
  };

  /* ------------------------------------------------------------------ */
  /* Jira fixtures                                                       */
  /* ------------------------------------------------------------------ */

  var FIX = MOCK.fixtures = {
    myself: { name: 'sraman', displayName: 'Shripathi Raman Radhakrishnan' },
    projects: [
      { key: 'NWD', name: 'Northwind Orders' },
      { key: 'TC316', name: 'Release Coordination' }
    ],
    project: {
      NWD: { key: 'NWD', name: 'Northwind Orders', issueTypes: [
        { name: 'Story', subtask: false }, { name: 'Bug', subtask: false }, { name: 'Task', subtask: false },
        { name: 'Sub-task', subtask: true }, { name: 'Epic', subtask: false }] },
      TC316: { key: 'TC316', name: 'Release Coordination', issueTypes: [
        { name: 'Story', subtask: false }, { name: 'Incident', subtask: false }] }
    },
    boards: {
      NWD: [{ id: 41, name: 'NWD Scrum board', type: 'scrum' }, { id: 42, name: 'NWD Kanban', type: 'kanban' }],
      TC316: [{ id: 77, name: 'TC316 board', type: 'scrum' }]
    },
    sprints: {
      41: [
        { id: 2400, name: 'Sprint 24', state: 'closed', startDate: '2026-11-16T09:00:00.000+01:00', endDate: '2026-12-04T18:00:00.000+01:00' },
        { id: 2500, name: 'Sprint 25', state: 'active', startDate: '2026-12-07T09:00:00.000+01:00', endDate: '2026-12-31T18:00:00.000+01:00' },
        { id: 2600, name: 'Sprint 26', state: 'future', startDate: '2027-01-04T09:00:00.000+01:00', endDate: '2027-01-22T18:00:00.000+01:00', goal: 'Delivery fee lines live for all store customers' },
        { id: 2700, name: 'Sprint 27', state: 'future', startDate: '2027-01-25T09:00:00.000+01:00', endDate: '2027-02-12T18:00:00.000+01:00', goal: 'Customer portal exports' }
      ],
      42: [],
      77: [{ id: 9100, name: 'TC316 Sprint 3', state: 'future', startDate: '2027-01-04T09:00:00.000+01:00', endDate: '2027-01-15T18:00:00.000+01:00' }]
    },
    fields: [
      { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string', system: 'summary' } },
      { id: 'assignee', name: 'Assignee', custom: false, schema: { type: 'user', system: 'assignee' } },
      { id: 'customfield_10412', name: 'Contributor', custom: true, schema: { type: 'array', items: 'user', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:multiuserpicker' } },
      { id: 'customfield_10413', name: 'Backup Assignee', custom: true, schema: { type: 'user', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:userpicker' } },
      { id: 'customfield_10002', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
      { id: 'customfield_11200', name: 'Team', custom: true, schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
      { id: 'customfield_10500', name: 'Dev notes', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' } }
    ],
    teams: { 'cf[11200]': ['Squad Orion', 'Squad Vega'] },
    users: {
      lorenzo: 'Lorenzo', marc: 'Marc', priya: 'Priya', gabriela: 'Gabriela', karthik: 'Karthik', chloe: 'Chloe'
    },
    /* Sprint 26 tickets as on the Sprint Tickets screen (10 tickets, 31 SP, 48.0 MD),
       plus tickets the filters must drop: a Task, and a ticket of Squad Vega. */
    issues: {
      2600: [
        { key: 'NWD-412', summary: 'Order confirmation email \u2014 new fee line', type: 'Story', team: 'Squad Orion', sp: 5, dev: ['lorenzo'], ba: ['gabriela'] },
        { key: 'NWD-418', summary: 'Customer portal: invoice PDF export', type: 'Story', team: 'Squad Orion', sp: 5, dev: ['priya', 'marc'], ba: ['karthik'] },
        { key: 'NWD-421', summary: 'Price list upload validation rules', type: 'Story', team: 'Squad Orion', sp: 8, dev: ['marc'], ba: ['gabriela'] },
        { key: 'NWD-427', summary: 'Fix rounding on sales report', type: 'Bug', team: 'Squad Orion', sp: 2, dev: ['marc'], ba: ['karthik'] },
        { key: 'NWD-430', summary: 'Onboarding checklist: address check column', type: 'Story', team: 'Squad Orion', sp: 3, dev: ['priya'], ba: ['gabriela'] },
        { key: 'NWD-433', summary: 'Store-level FX rate override', type: 'Story', team: 'Squad Orion', sp: 3, dev: ['lorenzo'], ba: ['karthik'] },
        { key: 'NWD-435', summary: 'Audit log for user role changes', type: 'Story', team: 'Squad Orion', sp: 2, dev: ['priya'], ba: ['karthik'] },
        { key: 'NWD-438', summary: 'Email template for payment reminders', type: 'Story', team: 'Squad Orion', sp: 1, dev: ['lorenzo'], ba: ['gabriela'] },
        { key: 'NWD-441', summary: 'Duplicate customer on import', type: 'Bug', team: 'Squad Orion', sp: 2, dev: ['marc'], ba: [] },
        { key: 'NWD-444', summary: 'Spike: warehouse feed latency', type: 'Story', team: 'Squad Orion', sp: null, dev: [], ba: [] },
        { key: 'NWD-450', summary: 'Upgrade build agents', type: 'Task', team: 'Squad Orion', sp: 3, dev: ['lorenzo'], ba: ['gabriela'] },
        { key: 'NWD-460', summary: 'Vega squad ticket', type: 'Story', team: 'Squad Vega', sp: 5, dev: ['chloe'], ba: ['gabriela'] }
      ],
      2700: [
        { key: 'NWD-470', summary: 'Customer export v2', type: 'Story', team: 'Squad Orion', sp: 3, dev: ['lorenzo'], ba: ['gabriela'] }
      ]
    }
  };

  /**
   * Tests may override fixture parts (e.g. "issues", "sprints") through
   * localStorage; read on every Jira call so a test can change Jira mid-way.
   */
  var BASE = JSON.parse(JSON.stringify(FIX));
  function applyOverrides() {
    var over = {};
    try { over = JSON.parse(localStorage.getItem(LS_FIX) || '{}'); } catch (e) { /* ignore */ }
    Object.keys(BASE).forEach(function (k) { FIX[k] = over[k] !== undefined ? over[k] : BASE[k]; });
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function json(status, body, headers) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
    }));
  }

  function text(status, body, headers) {
    return Promise.resolve(new Response(body, { status: status, headers: headers || {} }));
  }

  function page(values) {
    return { startAt: 0, maxResults: 50, isLast: true, values: values };
  }

  function atts() {
    try { return JSON.parse(localStorage.getItem(LS_ATT) || '{}'); } catch (e) { return {}; }
  }

  function saveAtts(a) {
    localStorage.setItem(LS_ATT, JSON.stringify(a));
  }

  function attJson(a, pageId) {
    return {
      id: a.id, type: 'attachment', title: a.title,
      version: { number: a.version, when: a.when, by: { displayName: a.by } },
      _links: { download: '/download/attachments/' + (pageId || PAGE_ID) + '/' + a.title + '?version=' + a.version + '&api=v2' }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Jira through the application-link proxy                             */
  /* ------------------------------------------------------------------ */

  function jira(path) {
    var sc = MOCK.scenario();
    applyOverrides();
    MOCK.calls.push(path);
    if (sc === 'down') { return Promise.reject(new TypeError('Failed to fetch')); }

    if (sc === 'proxyblocked') { return text(403, '<html>Forbidden</html>'); }
    // Some Confluence versions want Jira's full URL in "path": 'absolute' mimics that.
    if (path.indexOf('https://jira.northwind.example') === 0) {
      path = path.slice('https://jira.northwind.example'.length);
    } else if (sc === 'absolute') {
      return text(200, '<html>Confluence page, not Jira</html>', { 'Content-Type': 'text/html' });
    }
    if (sc === 'unauthorised') {
      return text(401, '', {
        'WWW-Authenticate': 'OAuth realm="https://jira.northwind.example", oauth_authorisation_uri="' +
          (localStorage.getItem('scp-mock-auth-uri') || 'https://confluence.example/plugins/servlet/applinks/oauth/login-dance/authorize?applicationLinkID=mock-link') + '"'
      });
    }
    var u = new URL(path, 'https://jira.northwind.example');
    var p = u.pathname;
    var m;
    if (p === '/rest/api/2/myself') { return json(200, FIX.myself); }
    if (p === '/rest/api/2/project') { return json(200, FIX.projects); }
    if ((m = /^\/rest\/api\/2\/project\/([^/]+)$/.exec(p))) {
      if (sc === 'noperm' || !FIX.project[m[1]]) {
        return json(404, { errorMessages: ['No project could be found with key \'' + m[1] + '\'.'] });
      }
      return json(200, FIX.project[m[1]]);
    }
    if (p === '/rest/agile/1.0/board') { return json(200, page(FIX.boards[u.searchParams.get('projectKeyOrId')] || [])); }
    if ((m = /^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/.exec(p))) { return json(200, page(FIX.sprints[m[1]] || [])); }
    if (p === '/rest/api/2/field') { return json(200, FIX.fields); }
    if ((m = /^\/rest\/agile\/1\.0\/sprint\/(\d+)$/.exec(p))) {
      var sp = [].concat.apply([], Object.keys(FIX.sprints).map(function (b) { return FIX.sprints[b]; }))
        .filter(function (x) { return String(x.id) === m[1]; })[0];
      return sp ? json(200, sp) : json(404, { errorMessages: ['No sprint'] });
    }
    if ((m = /^\/rest\/agile\/1\.0\/sprint\/(\d+)\/issue$/.exec(p))) { return json(200, sprintIssues(m[1], u.searchParams)); }
    if (p === '/rest/api/2/jql/autocompletedata/suggestions') {
      var vals = FIX.teams[u.searchParams.get('fieldName')] || [];
      return json(200, { results: vals.map(function (v) { return { value: '"' + v + '"', displayName: '<b></b>' + v }; }) });
    }
    return json(404, { errorMessages: ['Mock has no route for ' + p] });
  }

  /** Sprint issues filtered by the JQL the planner sends (issue types and team). */
  function sprintIssues(sprintId, params) {
    var jql = params.get('jql') || '';
    var fields = (params.get('fields') || '').split(',');
    var types = /issuetype in \(([^)]*)\)/.exec(jql);
    var typeList = types ? types[1].split(',').map(function (t) { return t.trim().replace(/^"|"$/g, ''); }) : null;
    var team = /cf\[11200\] = "([^"]*)"/.exec(jql);
    var list = (FIX.issues[sprintId] || []).filter(function (i) {
      return (!typeList || typeList.indexOf(i.type) !== -1) && (!team || i.team === team[1]);
    });
    function user(id) { return { name: id, key: id, displayName: FIX.users[id] || id }; }
    var issues = list.map(function (i) {
      var f = { summary: i.summary, issuetype: { name: i.type } };
      if (fields.indexOf('customfield_10412') !== -1) { f.customfield_10412 = i.dev.length ? i.dev.map(user) : null; }
      if (fields.indexOf('customfield_10413') !== -1) { f.customfield_10413 = i.ba.length ? user(i.ba[0]) : null; }
      if (fields.indexOf('customfield_10002') !== -1) { f.customfield_10002 = i.sp; }
      if (fields.indexOf('customfield_11200') !== -1) { f.customfield_11200 = { value: i.team }; }
      return { key: i.key, fields: f };
    });
    MOCK.lastJql = jql;
    var start = Number(params.get('startAt') || 0);
    var max = Number(params.get('maxResults') || 50);
    return { startAt: start, maxResults: max, total: issues.length, issues: issues.slice(start, start + max) };
  }

  /* ------------------------------------------------------------------ */
  /* Confluence: pages, attachments, restrictions                        */
  /*                                                                     */
  /* The planning page (900001) keeps its attachments under LS_ATT as     */
  /* before. Every other page (the parent "Sprint plans - <Squad>" and    */
  /* the sprint pages Publish creates) lives in LS_PAGES with its own     */
  /* attachments. Tests can set read restrictions in LS_RESTR.            */
  /* ------------------------------------------------------------------ */

  var LS_PAGES = 'scp-mock-pages';
  var LS_RESTR = 'scp-mock-restrictions';
  var SPACE = 'DD';
  var BASE_PAGES = {
    '800001': { id: '800001', title: 'Digital Delivery', space: SPACE, parentId: null, body: '', version: 1, atts: {} },
    '900001': { id: '900001', title: 'Sprint planning — Squad Orion', space: SPACE, parentId: '800001', body: '', version: 3, atts: null }
  };

  function pages() {
    var p;
    try { p = JSON.parse(localStorage.getItem(LS_PAGES) || 'null'); } catch (e) { p = null; }
    return p || JSON.parse(JSON.stringify(BASE_PAGES));
  }

  function savePages(p) {
    localStorage.setItem(LS_PAGES, JSON.stringify(p));
  }

  function attsOf(all, id) {
    if (id === PAGE_ID) { return atts(); }
    return all[id] ? all[id].atts : null;
  }

  function saveAttsOf(all, id, a) {
    if (id === PAGE_ID) { saveAtts(a); return; }
    all[id].atts = a;
    savePages(all);
  }

  function ancestors(all, id) {
    var out = [];
    var cur = all[id] && all[id].parentId;
    while (cur && all[cur]) { out.unshift({ id: cur, type: 'page', title: all[cur].title }); cur = all[cur].parentId; }
    return out;
  }

  function pageJson(all, pg) {
    return {
      id: pg.id, type: 'page', status: 'current', title: pg.title,
      space: { key: pg.space },
      version: { number: pg.version, when: pg.when || '2026-11-19T17:00:00.000Z', by: { displayName: pg.by || 'Shripathi R.' } },
      ancestors: ancestors(all, pg.id),
      body: { storage: { value: pg.body || '', representation: 'storage' } },
      _links: { webui: '/pages/viewpage.action?pageId=' + pg.id }
    };
  }

  function user() {
    return localStorage.getItem(LS_USER) || 'Shripathi R.';
  }

  /* The XSRF header spelling this Confluence accepts: 'no-check' unless a
     test sets 'nocheck' in scp-mock-xsrf (Atlassian documents both). */
  function xsrfOk(init) {
    var want = localStorage.getItem('scp-mock-xsrf') || 'no-check';
    return !!(init && init.headers && init.headers['X-Atlassian-Token'] === want);
  }

  /* What the user may do on a page (?expand=operations). scp-mock-operations:
     unset = may edit; 'view' = read only; 'none' = Confluence does not say. */
  function operations() {
    var mode = localStorage.getItem('scp-mock-operations') || 'edit';
    if (mode === 'none') { return null; }
    var ops = [{ operation: 'read', targetType: 'page' }];
    if (mode === 'edit') { ops.push({ operation: 'update', targetType: 'page' }, { operation: 'create', targetType: 'attachment' }); }
    return ops;
  }

  /* The planner's own files attached to the planning page, with their
     versions (scp-mock-code: { name: version }); served by the test server. */
  var CODE = ['scp-planner.css', 'scp-planner.js'];
  function codeVersions() {
    var v;
    try { v = JSON.parse(localStorage.getItem('scp-mock-code') || 'null'); } catch (e) { v = null; }
    var out = {};
    CODE.forEach(function (n) { out[n] = (v && v[n]) || 1; });
    return out;
  }

  function confluence(u, init, path) {
    var method = (init && init.method) || 'GET';
    var p = path || u.pathname;
    var all = pages();
    var m;
    MOCK.requests.push({ method: method, path: p });

    // Search by space and title.
    if (p === '/rest/api/content' && method === 'GET') {
      var found = Object.keys(all).map(function (k) { return all[k]; }).filter(function (pg) {
        return pg.space === u.searchParams.get('spaceKey') && pg.title === u.searchParams.get('title');
      });
      return json(200, { results: found.map(function (pg) { return pageJson(all, pg); }), size: found.length });
    }
    // Create a page.
    if (p === '/rest/api/content' && method === 'POST') {
      if (!xsrfOk(init)) { return text(403, 'XSRF check failed'); }
      var req = JSON.parse(init.body);
      var dup = Object.keys(all).some(function (k) { return all[k].space === req.space.key && all[k].title === req.title; });
      if (dup) { return json(400, { statusCode: 400, message: 'A page with this title already exists: A page already exists with the title ' + req.title + ' in this space' }); }
      var id = String(910000 + Object.keys(all).length);
      all[id] = { id: id, title: req.title, space: req.space.key, parentId: req.ancestors && req.ancestors[0] ? String(req.ancestors[0].id) : null,
        body: req.body.storage.value, version: 1, by: user(), when: new Date().toISOString(), atts: {} };
      savePages(all);
      return json(200, pageJson(all, all[id]));
    }
    // Read restrictions of a page (US-22).
    if ((m = /^\/rest\/api\/content\/(\d+)\/restriction\/byOperation\/read$/.exec(p)) && method === 'GET') {
      var r;
      try { r = JSON.parse(localStorage.getItem(LS_RESTR) || 'null'); } catch (e) { r = null; }
      r = r || { '900001': { user: ['Shripathi R.', 'Product Owner'], group: [] } };
      var mine = r[m[1]] || { user: [], group: [] };
      return json(200, { operation: 'read', restrictions: {
        user: { results: mine.user.map(function (n) { return { type: 'known', displayName: n }; }), size: mine.user.length },
        group: { results: mine.group.map(function (n) { return { type: 'group', name: n }; }), size: mine.group.length } } });
    }
    // Read or update one page.
    if ((m = /^\/rest\/api\/content\/(\d+)$/.exec(p))) {
      var pg = all[m[1]];
      if (!pg) { return json(404, { statusCode: 404, message: 'No content found with id: ' + m[1] }); }
      if (method === 'GET') {
        var pj = pageJson(all, pg);
        if (/operations/.test(u.searchParams.get('expand') || '')) {
          var ops = operations();
          if (ops) { pj.operations = ops; }
        }
        return json(200, pj);
      }
      if (method === 'PUT') {
        if (!xsrfOk(init)) { return text(403, 'XSRF check failed'); }
        var upd = JSON.parse(init.body);
        if (!upd.version || upd.version.number !== pg.version + 1) {
          return json(409, { statusCode: 409, message: 'Version must be incremented on update. Current version is: ' + pg.version });
        }
        pg.title = upd.title;
        pg.body = upd.body.storage.value;
        pg.version = upd.version.number;
        pg.by = user();
        pg.when = new Date().toISOString();
        savePages(all);
        return json(200, pageJson(all, pg));
      }
    }
    // Attachments of any page.
    if ((m = /^\/rest\/api\/content\/(\d+)\/child\/attachment(?:\/([^/]+)\/data)?$/.exec(p))) {
      var pid = m[1];
      var a = attsOf(all, pid);
      if (!a) { return json(404, { statusCode: 404, message: 'No content found with id: ' + pid }); }
      if (method === 'GET') {
        var name = u.searchParams.get('filename');
        if (!name) {
          // Every attachment (the loader reads their versions); the planning page also holds the planner's files.
          var list = Object.keys(a).map(function (k) { return attJson(a[k], pid); });
          if (pid === PAGE_ID) {
            var cv = codeVersions();
            Object.keys(cv).forEach(function (n) { list.push({ id: 'code-' + n, title: n, version: { number: cv[n] } }); });
          }
          return json(200, { results: list, size: list.length });
        }
        var f = a[name];
        return json(200, { results: f ? [attJson(f, pid)] : [], size: f ? 1 : 0 });
      }
      if (method === 'POST') {
        if (!xsrfOk(init)) { return text(403, 'XSRF check failed'); }
        var file = init.body.get('file');
        var isUpdate = !!m[2];
        return file.text().then(function (body) {
          var title = file.name;
          var prev = a[title];
          if (isUpdate && !prev) { return text(404, 'no such attachment'); }
          var rec = {
            id: prev ? prev.id : 'att' + Math.floor(Math.random() * 1e6), title: title,
            version: prev ? prev.version + 1 : 1, when: new Date().toISOString(), by: user(),
            mediaType: file.type || 'application/octet-stream', body: body
          };
          a[title] = rec;
          saveAttsOf(all, pid, a);
          return json(200, isUpdate ? attJson(rec, pid) : { results: [attJson(rec, pid)] });
        });
      }
    }
    if ((method === 'GET' || method === 'HEAD') && (m = /^\/download\/attachments\/(\d+)\/(.+)$/.exec(p))) {
      var aa = attsOf(all, m[1]) || {};
      var g = aa[decodeURIComponent(m[2])];
      if (!g && m[1] === PAGE_ID) { return realFetch(u.href, init); }   // the planner's own files: the test server
      return g ? text(200, g.body, { 'Content-Type': g.mediaType || 'application/json' }) : text(404, 'no file');
    }
    return text(404, 'Mock Confluence has no route for ' + method + ' ' + p);
  }

  /* ------------------------------------------------------------------ */
  /* fetch                                                               */
  /* ------------------------------------------------------------------ */

  /** Confluence's list of linked Jira servers (Release Impact route). */
  function servers() {
    var sc = MOCK.scenario();
    if (sc === 'down') { return Promise.reject(new TypeError('Failed to fetch')); }
    if (sc === 'nolink') { return json(200, []); }
    return json(200, [{ id: 'mock-link', name: 'jira.northwind.example', url: 'https://jira.northwind.example', selected: true }]);
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var u = new URL(url, location.href);
    // file:///D:/... on Windows: drop the drive so /D:/rest/... matches /rest/...
    var path = u.protocol === 'file:' ? u.pathname.replace(/^\/[A-Za-z]:(?=\/)/, '') : u.pathname;
    if (path === '/rest/jiraanywhere/1.0/servers') { return servers(); }
    if (path.indexOf('/plugins/servlet/applinks/proxy') !== -1) {
      MOCK.requests.push({ method: (init && init.method) || 'GET', path: 'jira:' + u.searchParams.get('path') });
      if (u.searchParams.get('appId') !== 'mock-link') { return text(404, 'No such application link'); }
      return jira(u.searchParams.get('path'));
    }
    if (path === '/rest/api/content' || path.indexOf('/rest/api/content/') === 0 || path.indexOf('/download/attachments/') === 0) {
      return confluence(u, init, path);
    }
    return realFetch(input, init);
  };
}());
