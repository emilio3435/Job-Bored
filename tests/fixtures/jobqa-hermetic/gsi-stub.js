/*
 * JOBQA hermetic fixture: a MOCK of Google Identity Services, served in
 * place of https://accounts.google.com/gsi/client. Signing in returns a fake
 * token at once; the signed-in email comes from the mocked userinfo answer
 * in browser-stubs.js (?fixtureAccount=a|b). No request leaves the machine.
 */
/* global window, setTimeout */
(function () {
  "use strict";
  var fixture = window.__JOBQA_FIXTURE__ || {};

  function tokenResponse(scope) {
    return {
      access_token: "jobqa-fixture-token-" + (fixture.account || "b") + "-" + Date.now(),
      token_type: "Bearer",
      expires_in: 3599,
      scope: scope || "",
    };
  }

  window.google = window.google || {};
  window.google.accounts = {
    oauth2: {
      initTokenClient: function (config) {
        var settings = config || {};
        var client = {
          callback: settings.callback,
          requestAccessToken: function () {
            setTimeout(function () {
              var done = client.callback;
              if (typeof done === "function") done(tokenResponse(settings.scope));
            }, 150);
          },
        };
        return client;
      },
      hasGrantedAllScopes: function () {
        return true;
      },
      hasGrantedAnyScope: function () {
        return true;
      },
      revoke: function (_token, done) {
        if (typeof done === "function") setTimeout(done, 0);
      },
    },
    id: {
      initialize: function () {},
      prompt: function () {},
      renderButton: function () {},
      disableAutoSelect: function () {},
    },
  };
})();
