/*
 * scp-store.js — Sprint Capacity Planner · JSON attachments on the planning page
 *
 * Reads and writes scp-config.json (FR-8) and scp-plan.json (FR-25) as
 * attachments of the page the macro sits on, through the Confluence REST API.
 * Publish (FR-29) also uses it to read, find, create and update pages, to put
 * files on other pages, and to read the planning page's view restrictions.
 * Before every write it re-reads the attachment version: if someone else saved
 * since we loaded, the save stops with a conflict so the caller can warn
 * (Edge Case "two SMs edit the same plan at once", US-20 AC-4).
 */
(function (SCP) {
  'use strict';

  var store = SCP.store = {};

  function meta(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return m ? m.getAttribute('content') || '' : '';
  }

  store.contextPath = function () {
    return meta('ajs-context-path');
  };

  store.pageId = function () {
    return meta('ajs-page-id');
  };

  /** Name of the signed-in Confluence user, as Confluence prints it in the page. */
  store.currentUser = function () {
    return meta('ajs-current-user-fullname') || meta('ajs-remote-user') || '';
  };

  function api(path, pageId) {
    return store.contextPath() + '/rest/api/content/' + encodeURIComponent(pageId || store.pageId()) + path;
  }

  function check(res, what) {
    if (!res.ok) {
      var err = new Error(what + ' failed (HTTP ' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /** Summary of an attachment: id, version, who saved it and when. */
  function describe(att) {
    var v = att.version || {};
    return {
      id: att.id,
      version: v.number || 0,
      by: (v.by && (v.by.displayName || v.by.username)) || '',
      when: v.when || '',
      download: att._links && att._links.download
    };
  }

  /** Attachment metadata, or null when the file does not exist yet. pageId: default this page. */
  store.info = function (filename, pageId) {
    return fetch(api('/child/attachment?filename=' + encodeURIComponent(filename) + '&expand=version', pageId), {
      credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      return check(res, 'Reading ' + filename).json();
    }).then(function (body) {
      var att = body && body.results && body.results[0];
      return att ? describe(att) : null;
    });
  };

  /**
   * Load a JSON attachment.
   * Resolves { data, meta } or { data: null, meta: null } when it does not exist yet.
   */
  store.load = function (filename, pageId) {
    return store.info(filename, pageId).then(function (info) {
      if (!info) { return { data: null, meta: null }; }
      return fetch(store.contextPath() + info.download, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (res) { return check(res, 'Downloading ' + filename).json(); })
        .then(function (data) { return { data: data, meta: info }; });
    });
  };

  /**
   * Save a JSON attachment.
   * expectedVersion: the version we loaded (0 / null for a new file).
   * Unless opts.force, rejects with err.conflict = true and err.current = meta
   * when the attachment changed since it was loaded.
   * Resolves the new meta { id, version, by, when }.
   */
  store.save = function (filename, data, expectedVersion, opts) {
    opts = opts || {};
    return store.info(filename).then(function (current) {
      var currentVersion = current ? current.version : 0;
      if (!opts.force && currentVersion !== (expectedVersion || 0)) {
        var err = new Error(filename + ' changed since it was opened');
        err.conflict = true;
        err.current = current;
        throw err;
      }
      var form = new FormData();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      form.append('file', blob, filename);
      form.append('minorEdit', 'true');
      form.append('comment', opts.comment || 'Saved by Sprint Capacity Planner');
      var path = current ? '/child/attachment/' + encodeURIComponent(current.id) + '/data' : '/child/attachment';
      return fetch(api(path), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Atlassian-Token': 'no-check', 'Accept': 'application/json' },
        body: form
      }).then(function (res) {
        return check(res, 'Saving ' + filename).json();
      }).then(function (body) {
        var att = body && body.results ? body.results[0] : body;
        return store.info(filename).then(function (fresh) {
          return fresh || describe(att);
        });
      });
    });
  };

  /* ------------------------------------------------------------------ */
  /* Pages (Publish, FR-29) and restrictions (FR-28)                      */
  /* ------------------------------------------------------------------ */

  /** JSON request to the Confluence REST API; writes carry the XSRF header. */
  function request(method, path, body) {
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-Atlassian-Token'] = 'no-check';
      init.body = JSON.stringify(body);
    }
    return fetch(store.contextPath() + path, init).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error((data && data.message) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /** Short form of a page: id, title, space key, version, ancestors [{id, title}]. */
  function pageOf(p) {
    return {
      id: String(p.id), title: p.title, space: p.space && p.space.key,
      version: p.version ? p.version.number : 0,
      ancestors: (p.ancestors || []).map(function (a) { return { id: String(a.id), title: a.title }; }),
      url: store.contextPath() + ((p._links && p._links.webui) || '/pages/viewpage.action?pageId=' + p.id)
    };
  }

  /** One page by ID, or null when it does not exist (or was deleted). */
  store.page = function (id) {
    return request('GET', '/rest/api/content/' + encodeURIComponent(id) + '?expand=space,version,ancestors').then(pageOf, function (err) {
      if (err.status === 404) { return null; }
      throw err;
    });
  };

  /** The page with this exact title in the space, or null. */
  store.findPage = function (space, title) {
    return request('GET', '/rest/api/content?type=page&spaceKey=' + encodeURIComponent(space) + '&title=' + encodeURIComponent(title) +
      '&expand=space,version,ancestors').then(function (r) {
      return r && r.results && r.results[0] ? pageOf(r.results[0]) : null;
    });
  };

  /** Create a page under parentId (null for the space root) with a storage-format body. */
  store.createPage = function (space, title, parentId, storage) {
    var body = { type: 'page', title: title, space: { key: space }, body: { storage: { value: storage, representation: 'storage' } } };
    if (parentId) { body.ancestors = [{ id: parentId }]; }
    return request('POST', '/rest/api/content', body).then(pageOf);
  };

  /** Replace a page's body; version is the page's current version number. */
  store.updatePage = function (page, storage) {
    return request('PUT', '/rest/api/content/' + encodeURIComponent(page.id), {
      id: page.id, type: 'page', title: page.title, version: { number: page.version + 1, minorEdit: true },
      body: { storage: { value: storage, representation: 'storage' } }
    }).then(pageOf);
  };

  /** Put a text file on a page, creating it or adding a new version; no version check. */
  store.putFile = function (pageId, filename, text, type) {
    return store.info(filename, pageId).then(function (current) {
      var form = new FormData();
      form.append('file', new Blob([text], { type: type || 'text/plain' }), filename);
      form.append('minorEdit', 'true');
      form.append('comment', 'Published by Sprint Capacity Planner');
      var path = current ? '/child/attachment/' + encodeURIComponent(current.id) + '/data' : '/child/attachment';
      return fetch(api(path, pageId), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-Atlassian-Token': 'no-check', 'Accept': 'application/json' }, body: form
      }).then(function (res) { return check(res, 'Uploading ' + filename); });
    });
  };

  /**
   * Who may view this page, from its own read restrictions (FR-28):
   * { restricted, users: [names], groups: [names] }. Restrictions inherited
   * from a parent page are not part of this answer.
   */
  store.readRestrictions = function () {
    return request('GET', '/rest/api/content/' + encodeURIComponent(store.pageId()) + '/restriction/byOperation/read').then(function (r) {
      var res = (r && r.restrictions) || {};
      var users = ((res.user && res.user.results) || []).map(function (x) { return x.displayName || x.username || x.name; });
      var groups = ((res.group && res.group.results) || []).map(function (x) { return x.name; });
      return { restricted: users.length + groups.length > 0, users: users, groups: groups };
    });
  };
}(window.SCP = window.SCP || {}));
