/*
 * tests/mock-env.js — TEST ONLY, never attach to Confluence.
 *
 * Replaces window.fetch with a fake Confluence + Jira so the planner runs in a
 * plain browser:
 *   - Jira calls through /plugins/servlet/applinks/proxy answer from FIXTURES
 *   - Confluence attachment REST calls read/write localStorage
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
    scenario: function () { return localStorage.getItem(LS_SCENARIO) || 'ok'; }
  };

  /* ------------------------------------------------------------------ */
  /* Jira fixtures                                                       */
  /* ------------------------------------------------------------------ */

  var FIX = MOCK.fixtures = {
    myself: { name: 'sraman', displayName: 'Shripathi Raman Radhakrishnan' },
    projects: [
      { key: 'PCAP', name: 'Private Capital' },
      { key: 'TC316', name: 'Release Coordination' }
    ],
    project: {
      PCAP: { key: 'PCAP', name: 'Private Capital', issueTypes: [
        { name: 'Story', subtask: false }, { name: 'Bug', subtask: false }, { name: 'Task', subtask: false },
        { name: 'Sub-task', subtask: true }, { name: 'Epic', subtask: false }] },
      TC316: { key: 'TC316', name: 'Release Coordination', issueTypes: [
        { name: 'Story', subtask: false }, { name: 'Incident', subtask: false }] }
    },
    boards: {
      PCAP: [{ id: 41, name: 'PCAP Scrum board', type: 'scrum' }, { id: 42, name: 'PCAP Kanban', type: 'kanban' }],
      TC316: [{ id: 77, name: 'TC316 board', type: 'scrum' }]
    },
    sprints: {
      41: [
        { id: 2400, name: 'Sprint 24', state: 'closed', startDate: '2026-11-16T09:00:00.000+01:00', endDate: '2026-12-04T18:00:00.000+01:00' },
        { id: 2500, name: 'Sprint 25', state: 'active', startDate: '2026-12-07T09:00:00.000+01:00', endDate: '2026-12-31T18:00:00.000+01:00' },
        { id: 2600, name: 'Sprint 26', state: 'future', startDate: '2027-01-04T09:00:00.000+01:00', endDate: '2027-01-22T18:00:00.000+01:00', goal: 'Capital call fee lines live for all GP clients' },
        { id: 2700, name: 'Sprint 27', state: 'future', startDate: '2027-01-25T09:00:00.000+01:00', endDate: '2027-02-12T18:00:00.000+01:00', goal: 'Investor portal exports' }
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
        { key: 'PCAP-412', summary: 'Capital call notice \u2014 new fee line', type: 'Story', team: 'Squad Orion', sp: 5, dev: ['lorenzo'], ba: ['gabriela'] },
        { key: 'PCAP-418', summary: 'Investor portal: distribution PDF export', type: 'Story', team: 'Squad Orion', sp: 5, dev: ['priya', 'marc'], ba: ['karthik'] },
        { key: 'PCAP-421', summary: 'NAV upload validation rules', type: 'Story', team: 'Squad Orion', sp: 8, dev: ['marc'], ba: ['gabriela'] },
        { key: 'PCAP-427', summary: 'Fix rounding on commitment report', type: 'Bug', team: 'Squad Orion', sp: 2, dev: ['marc'], ba: ['karthik'] },
        { key: 'PCAP-430', summary: 'Onboarding checklist: KYC status column', type: 'Story', team: 'Squad Orion', sp: 3, dev: ['priya'], ba: ['gabriela'] },
        { key: 'PCAP-433', summary: 'Fund-level FX rate override', type: 'Story', team: 'Squad Orion', sp: 3, dev: ['lorenzo'], ba: ['karthik'] },
        { key: 'PCAP-435', summary: 'Audit log for user role changes', type: 'Story', team: 'Squad Orion', sp: 2, dev: ['priya'], ba: ['karthik'] },
        { key: 'PCAP-438', summary: 'Email template for drawdown reminders', type: 'Story', team: 'Squad Orion', sp: 1, dev: ['lorenzo'], ba: ['gabriela'] },
        { key: 'PCAP-441', summary: 'Duplicate investor on import', type: 'Bug', team: 'Squad Orion', sp: 2, dev: ['marc'], ba: [] },
        { key: 'PCAP-444', summary: 'Spike: eFront feed latency', type: 'Story', team: 'Squad Orion', sp: null, dev: [], ba: [] },
        { key: 'PCAP-450', summary: 'Upgrade build agents', type: 'Task', team: 'Squad Orion', sp: 3, dev: ['lorenzo'], ba: ['gabriela'] },
        { key: 'PCAP-460', summary: 'Vega squad ticket', type: 'Story', team: 'Squad Vega', sp: 5, dev: ['chloe'], ba: ['gabriela'] }
      ],
      2700: [
        { key: 'PCAP-470', summary: 'Investor export v2', type: 'Story', team: 'Squad Orion', sp: 3, dev: ['lorenzo'], ba: ['gabriela'] }
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

  function attJson(a) {
    return {
      id: a.id, type: 'attachment', title: a.title,
      version: { number: a.version, when: a.when, by: { displayName: a.by } },
      _links: { download: '/download/attachments/' + PAGE_ID + '/' + a.title + '?version=' + a.version + '&api=v2' }
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
        'WWW-Authenticate': 'OAuth realm="https://jira.northwind.example", oauth_authorisation_uri="https://confluence.example/plugins/servlet/applinks/oauth/login-dance/authorize?applicationLinkID=mock-link"'
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
  /* Confluence attachments                                              */
  /* ------------------------------------------------------------------ */

  function confluence(u, init, path) {
    var method = (init && init.method) || 'GET';
    var p = path || u.pathname;
    var a = atts();
    var m;
    if (method === 'GET' && p === '/rest/api/content/' + PAGE_ID + '/child/attachment') {
      var f = a[u.searchParams.get('filename')];
      return json(200, { results: f ? [attJson(f)] : [], size: f ? 1 : 0 });
    }
    if (method === 'GET' && (m = new RegExp('^/download/attachments/' + PAGE_ID + '/(.+)$').exec(p))) {
      var g = a[decodeURIComponent(m[1])];
      return g ? text(200, g.body, { 'Content-Type': 'application/json' }) : text(404, 'no file');
    }
    if (method === 'POST') {
      if (!init.headers || init.headers['X-Atlassian-Token'] !== 'no-check') { return text(403, 'XSRF check failed'); }
      var file = init.body.get('file');
      var isUpdate = /\/child\/attachment\/[^/]+\/data$/.test(p);
      return file.text().then(function (body) {
        var title = file.name;
        var prev = a[title];
        if (isUpdate && !prev) { return text(404, 'no such attachment'); }
        var rec = {
          id: prev ? prev.id : 'att' + Math.floor(Math.random() * 1e6),
          title: title,
          version: prev ? prev.version + 1 : 1,
          when: new Date().toISOString(),
          by: localStorage.getItem(LS_USER) || 'Shripathi R.',
          body: body
        };
        a[title] = rec;
        saveAtts(a);
        return json(200, isUpdate ? attJson(rec) : { results: [attJson(rec)] });
      });
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
      if (u.searchParams.get('appId') !== 'mock-link') { return text(404, 'No such application link'); }
      return jira(u.searchParams.get('path'));
    }
    if (path.indexOf('/rest/api/content/') === 0 || path.indexOf('/download/attachments/') === 0) {
      return confluence(u, init, path);
    }
    return realFetch(input, init);
  };
}());
