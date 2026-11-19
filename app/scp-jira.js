/*
 * scp-jira.js — Sprint Capacity Planner · every Jira call (PRD Integration Points)
 *
 * Jira (jira.group.bank) is read through Confluence's own link to Jira, the
 * same route as the Release Impact admin tool: Confluence lists its linked
 * Jira servers, and each call goes through the link proxy signed in as the
 * person using the page. No API token and no link ID are stored (FR-1).
 *   GET <ctx>/rest/jiraanywhere/1.0/servers                  linked Jira servers
 *   GET <ctx>/plugins/servlet/applinks/proxy?appId=<id>&path=<Jira REST path>
 * Read-only: nothing in this file writes to Jira.
 *
 * Optional setting in the macro body (scp-macro.html):
 *   SCP.settings.jiraServer  "" = the Jira this Confluence links to by default,
 *                            or the name, address or link id of another linked Jira
 */
(function (SCP) {
  'use strict';

  var jira = SCP.jira = {};

  function settings() {
    return SCP.settings || {};
  }

  function contextPath() {
    var m = document.querySelector('meta[name="ajs-context-path"]');
    return m ? m.getAttribute('content') || '' : '';
  }

  /** The linked Jira server in use: { id, name, url, authUrl }, once resolved. */
  jira.server = null;

  /* The proxy accepts either a relative path or Jira's full URL, depending on
     the Confluence version; remember the form that worked (as Release Impact does). */
  var absolutePath = false;

  /** Link to a ticket in Jira (US-08 AC-3). */
  jira.browseUrl = function (key) {
    var base = (jira.server && jira.server.url) || 'https://jira.group.bank';
    return base.replace(/\/+$/, '') + '/browse/' + encodeURIComponent(key);
  };

  /**
   * Error raised by every call. kind is one of:
   *   notSignedIn   not signed in to Confluence
   *   noLink        Confluence is not linked to Jira (or not to the configured one)
   *   proxyBlocked  Confluence refused to pass the call to Jira
   *   notAuthorised user has not allowed Confluence to use their Jira account (authUrl may be set)
   *   noPermission  403, or project hidden by missing Browse Projects
   *   notFound      404 on a Jira resource
   *   unreachable   network error or Jira/proxy down
   *   http          any other HTTP error
   */
  function JiraError(kind, message, extra) {
    this.name = 'JiraError';
    this.kind = kind;
    this.message = message;
    this.status = extra && extra.status;
    this.authUrl = extra && extra.authUrl;
  }
  JiraError.prototype = Object.create(Error.prototype);
  jira.JiraError = JiraError;

  /** One HTTP GET; the body is parsed when it is JSON. */
  function raw(url) {
    return fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = text;
        var isJson = false;
        try { body = JSON.parse(text); isJson = true; } catch (e) { /* not JSON */ }
        return { res: res, body: body, isJson: isJson };
      });
    }, function (e) {
      throw new JiraError('unreachable', 'Confluence could not be reached (' + (e && e.message || e) + ')');
    });
  }

  /**
   * Which Jira to use: settings.jiraServer if set, otherwise the Jira this
   * Confluence links to by default (selected / primary, else the first).
   */
  jira.resolveServer = function () {
    if (jira.server) { return Promise.resolve(jira.server); }
    return raw(contextPath() + '/rest/jiraanywhere/1.0/servers').then(function (r) {
      if (r.res.status === 401) { throw new JiraError('notSignedIn', 'You are not signed in to Confluence'); }
      if (!r.res.ok || !r.isJson) {
        throw new JiraError('noLink', 'Confluence did not list its Jira links (HTTP ' + r.res.status + ')', { status: r.res.status });
      }
      var list = Array.isArray(r.body) ? r.body : (r.body && r.body.servers) || [];
      if (!list.length) { throw new JiraError('noLink', 'This Confluence is not linked to any Jira'); }
      var want = String(settings().jiraServer || '').trim().toLowerCase().replace(/\/+$/, '');
      var hit = null;
      if (want) {
        hit = list.filter(function (x) {
          return [x.id, x.name, x.url].some(function (v) { return String(v || '').toLowerCase().replace(/\/+$/, '') === want; });
        })[0];
        if (!hit) { throw new JiraError('noLink', 'No Jira link called "' + settings().jiraServer + '" (jiraServer in the macro)'); }
      } else {
        hit = list.filter(function (x) { return x.selected || x.primary; })[0] || list[0];
      }
      jira.server = { id: String(hit.id), name: hit.name || 'Jira', url: String(hit.url || '').replace(/\/+$/, ''), authUrl: hit.authUrl || '' };
      return jira.server;
    });
  };

  /** "Allow access" address from a 401 answer, if Jira gave one (not the realm). */
  function readAuthUrl(r) {
    var h = r.res.headers.get('WWW-Authenticate') || '';
    var m = /oauth_authori[sz]ation_uri="([^"]+)"/i.exec(h);
    if (m) { return m[1]; }
    var b = r.body && typeof r.body === 'object' ? r.body : {};
    return b.authorisationURI || b.authorizationUri || b.authUrl || (jira.server && jira.server.authUrl) || null;
  }

  /** GET a Jira REST path (e.g. "/rest/api/2/myself") through Confluence's link proxy. */
  jira.get = function (path) {
    return jira.resolveServer().then(function (srv) {
      function viaProxy(p) {
        return contextPath() + '/plugins/servlet/applinks/proxy?appId=' + encodeURIComponent(srv.id) +
          '&path=' + encodeURIComponent(p);
      }
      return raw(viaProxy(absolutePath ? srv.url + path : path)).then(function (r) {
        // A non-JSON answer means the proxy did not reach Jira's REST API with
        // that form of path: try the other form once and keep it if it works.
        if (!r.isJson && r.res.status !== 401 && srv.url) {
          return raw(viaProxy(absolutePath ? path : srv.url + path)).then(function (r2) {
            if (r2.isJson || r2.res.status === 401) { absolutePath = !absolutePath; return r2; }
            return r;
          });
        }
        return r;
      });
    }).then(function (r) {
      var st = r.res.status;
      if (st === 401) {
        throw new JiraError('notAuthorised', 'Jira needs you to allow Confluence to use your Jira account', { status: 401, authUrl: readAuthUrl(r) });
      }
      if (st === 403 && !r.isJson) {
        throw new JiraError('proxyBlocked', 'Confluence refused to pass the call to Jira (HTTP 403)', { status: 403 });
      }
      if (st >= 500 || (!r.isJson && st !== 404)) {
        throw new JiraError('unreachable', 'Jira did not answer through Confluence (HTTP ' + st + ')', { status: st });
      }
      if (st === 403) { throw new JiraError('noPermission', 'Permission denied', { status: 403 }); }
      if (st === 404) { throw new JiraError('notFound', 'Not found', { status: 404 }); }
      if (!r.res.ok) {
        var b = r.body || {};
        throw new JiraError('http', (b.errorMessages && b.errorMessages.join(' ')) || 'Jira answered HTTP ' + st, { status: st });
      }
      return r.body;
    });
  };

  /** Read every page of an Agile API list ({ values, isLast }). */
  function getAllPages(path) {
    var all = [];
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    function next(startAt, guard) {
      return jira.get(path + sep + 'startAt=' + startAt + '&maxResults=50').then(function (page) {
        var values = (page && page.values) || [];
        all = all.concat(values);
        if (page && page.isLast === false && values.length && guard < 40) {
          return next(startAt + values.length, guard + 1);
        }
        return all;
      });
    }
    return next(0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Endpoints                                                           */
  /* ------------------------------------------------------------------ */

  /** Test connection (FR-1). */
  jira.myself = function () {
    return jira.get('/rest/api/2/myself');
  };

  /** One project, with its issue types (FR-2, FR-3). */
  jira.project = function (key) {
    return jira.get('/rest/api/2/project/' + encodeURIComponent(key));
  };

  /** Boards of a project (FR-2). */
  jira.boards = function (projectKey) {
    return getAllPages('/rest/agile/1.0/board?projectKeyOrId=' + encodeURIComponent(projectKey));
  };

  /** Sprints with state, dates and goal (FR-2). */
  jira.sprints = function (boardId) {
    return getAllPages('/rest/agile/1.0/board/' + encodeURIComponent(boardId) + '/sprint?state=active,future,closed');
  };

  /** All fields with the custom flag and schema, for mapping (FR-4). */
  jira.fields = function () {
    return jira.get('/rest/api/2/field');
  };

  /** "customfield_11200" -> "cf[11200]" for JQL. Standard fields keep their id. */
  jira.jqlName = function (fieldId) {
    var m = /^customfield_(\d+)$/.exec(fieldId || '');
    return m ? 'cf[' + m[1] + ']' : fieldId;
  };

  /**
   * Values of the Team field (FR-2), read from Jira's JQL value suggestions,
   * which only need Browse rights.
   */
  jira.teamValues = function (teamFieldId) {
    return jira.get('/rest/api/2/jql/autocompletedata/suggestions?fieldName=' +
      encodeURIComponent(jira.jqlName(teamFieldId)) + '&fieldValue=').then(function (r) {
      var seen = {};
      return ((r && r.results) || []).map(function (x) {
        return String(x.value || x.displayName || '').replace(/<[^>]*>/g, '').replace(/^"|"$/g, '');
      }).filter(function (v) {
        if (!v || seen[v]) { return false; }
        seen[v] = true;
        return true;
      });
    });
  };

  /** One sprint: name, state, dates, goal (FR-10, FR-12 reload). */
  jira.sprint = function (sprintId) {
    return jira.get('/rest/agile/1.0/sprint/' + encodeURIComponent(sprintId));
  };

  /** JQL string value in double quotes. */
  function q(v) {
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  /**
   * Tickets of a sprint, of the ticked issue types and the page's team
   * (Integration Points). Resolves the raw Jira issues.
   */
  jira.sprintIssues = function (sprintId, config) {
    var f = config.fields;
    var jql = 'issuetype in (' + config.jira.issueTypes.map(q).join(',') + ')';
    if (f.team && config.jira.team) { jql += ' AND ' + jira.jqlName(f.team.id) + ' = ' + q(config.jira.team); }
    var wanted = ['summary', 'issuetype'];
    ['dev', 'ba', 'sp', 'team'].forEach(function (k) { if (f[k]) { wanted.push(f[k].id); } });
    var base = '/rest/agile/1.0/sprint/' + encodeURIComponent(sprintId) + '/issue?jql=' + encodeURIComponent(jql) +
      '&fields=' + encodeURIComponent(wanted.join(','));
    var all = [];
    function next(startAt, guard) {
      return jira.get(base + '&startAt=' + startAt + '&maxResults=100').then(function (r) {
        var issues = (r && r.issues) || [];
        all = all.concat(issues);
        if (issues.length && all.length < (r.total || 0) && guard < 40) { return next(all.length, guard + 1); }
        return all;
      });
    }
    return next(0, 0);
  };

  /** People of a user-picker value (single or multi) as [{ id, name }]. */
  function people(v) {
    var list = Array.isArray(v) ? v : (v ? [v] : []);
    return list.map(function (u) {
      return { id: u.name || u.key || u.accountId || u.displayName, name: u.displayName || u.name };
    });
  }

  /**
   * Raw Jira issue -> the ticket fields the plan stores (key, summary, type,
   * SP, Dev and BA people). Nothing else of the ticket is kept (Data Requirements).
   */
  jira.toTicket = function (issue, config) {
    var f = issue.fields || {};
    var m = config.fields;
    var sp = m.sp ? f[m.sp.id] : null;
    return {
      key: issue.key,
      summary: f.summary || '',
      type: f.issuetype ? f.issuetype.name : '',
      sp: (sp === null || sp === undefined || sp === '') ? null : Number(sp),
      dev: m.dev ? people(f[m.dev.id]) : [],
      ba: m.ba ? people(f[m.ba.id]) : []
    };
  };

  /**
   * Test connection (US-01, FR-1): the link and the user only, no project.
   * Resolves { user } or rejects with a JiraError.
   */
  jira.testConnection = function () {
    return jira.myself().then(function (me) {
      return { user: me && (me.displayName || me.name) };
    });
  };

  /**
   * Project check for Fetch from Jira (US-02, FR-2). Jira answers 404 both for
   * a key that does not exist and for one the user cannot browse, so both
   * become kind 'projectNotReadable'.
   */
  jira.checkProject = function (key) {
    return jira.project(key).catch(function (err) {
      if (err.kind === 'notFound' || err.kind === 'noPermission') {
        var e = new JiraError('projectNotReadable', key + ' was not found, or you lack the Browse Projects permission on it', { status: err.status });
        e.projectKey = key;
        throw e;
      }
      throw err;
    });
  };
}(window.SCP = window.SCP || {}));
