/*
 * scp-store.js — Sprint Capacity Planner · JSON attachments on the planning page
 *
 * Reads and writes scp-config.json (FR-8) and scp-plan.json (FR-25) as
 * attachments of the page the macro sits on, through the Confluence REST API.
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

  function api(path) {
    return store.contextPath() + '/rest/api/content/' + encodeURIComponent(store.pageId()) + path;
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

  /** Attachment metadata, or null when the file does not exist yet. */
  store.info = function (filename) {
    return fetch(api('/child/attachment?filename=' + encodeURIComponent(filename) + '&expand=version'), {
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
  store.load = function (filename) {
    return store.info(filename).then(function (info) {
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
}(window.SCP = window.SCP || {}));
