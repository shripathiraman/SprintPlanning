/*
 * scp-jira.js — Sprint Capacity Planner · every Jira call (PRD Integration Points)
 *
 * Jira (jira.group.bank) is read through Confluence's application-link proxy,
 * the same route as the Release Impact readiness checklist. The call runs with
 * the viewer's own Jira rights; no API token is stored (FR-1). Read-only:
 * nothing in this file writes to Jira.
 *
 * Settings come from the macro body (scp-macro.html):
 *   SCP.settings.jiraApplinkId  application link ID of jira.group.bank
 *   SCP.settings.jiraBaseUrl    used only to build "browse" links
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

  /** Link to a ticket in Jira (US-08 AC-3). */
  jira.browseUrl = function (key) {
    return (settings().jiraBaseUrl || 'https://jira.group.bank').replace(/\/$/, '') + '/browse/' + encodeURIComponent(key);
  };

  /**
   * Error raised by every call. kind is one of:
   *   noLink        application link not configured
   *   notAuthorised user has not authorised the link yet (authUrl may be set)
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

  /** Find the "authorise" URL the proxy sends back when credentials are required. */
  function readAuthUrl(res, bodyText) {
    var header = res.headers.get('WWW-Authenticate') || '';
    var m = /authorisationURI="([^"]+)"/i.exec(header) || /authorizationURI="([^"]+)"/i.exec(header);
    if (m) { return m[1]; }
    try {
      var j = JSON.parse(bodyText);
      return j.authorisationUri || j.authorizationUri || null;
    } catch (e) {
      return null;
    }
  }

  /** GET a Jira REST path (e.g. "/rest/api/2/myself") through the application link. */
  jira.get = function (path) {
    var appId = settings().jiraApplinkId;
    if (!appId) {
      return Promise.reject(new JiraError('noLink', 'No application link ID set in the macro'));
    }
    var url = contextPath() + '/plugins/servlet/applinks/proxy?appId=' + encodeURIComponent(appId) +
      '&path=' + encodeURIComponent(path);
    return fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      return res.text().then(function (text) {
        if (res.ok) {
          try {
            return text ? JSON.parse(text) : null;
          } catch (e) {
            throw new JiraError('http', 'Jira sent a response that is not JSON', { status: res.status });
          }
        }
        if (res.status === 401) {
          throw new JiraError('notAuthorised', 'Not authorised on the application link', {
            status: 401, authUrl: readAuthUrl(res, text)
          });
        }
        if (res.status === 403) {
          throw new JiraError('noPermission', 'Permission denied', { status: 403 });
        }
        if (res.status === 404 && /application ?link/i.test(text)) {
          throw new JiraError('noLink', 'Application link not found', { status: 404 });
        }
        if (res.status === 404) {
          throw new JiraError('notFound', 'Not found', { status: 404 });
        }
        if (res.status >= 500) {
          throw new JiraError('unreachable', 'Jira did not answer (HTTP ' + res.status + ')', { status: res.status });
        }
        throw new JiraError('http', 'Jira answered HTTP ' + res.status, { status: res.status });
      });
    }, function () {
      throw new JiraError('unreachable', 'Jira could not be reached');
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

  /** Projects the user can browse, for the Project picker. */
  jira.projects = function () {
    return jira.get('/rest/api/2/project');
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
   * Test connection (US-01): who am I, and can I browse the chosen project?
   * Resolves { user } or rejects with a JiraError; noPermission carries the user.
   */
  jira.testConnection = function (projectKey) {
    return jira.myself().then(function (me) {
      var user = me && (me.displayName || me.name);
      if (!projectKey) { return { user: user }; }
      return jira.project(projectKey).then(function () {
        return { user: user };
      }, function (err) {
        if (err.kind === 'noPermission' || err.kind === 'notFound') {
          var e = new JiraError('noPermission', 'No Browse Projects permission on ' + projectKey, { status: err.status });
          e.user = user;
          e.projectKey = projectKey;
          throw e;
        }
        throw err;
      });
    });
  };
}(window.SCP = window.SCP || {}));
