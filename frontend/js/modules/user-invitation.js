/**
*  vim:set sw=2 ts=2 sts=2 ft=javascript expandtab:
*
*  # User invitation and admin sharing module
*
*  ## License
*
*  Licensed to the Apache Software Foundation (ASF) under one
*  or more contributor license agreements.  See the NOTICE file
*  distributed with this work for additional information
*  regarding copyright ownership.  The ASF licenses this file
*  to you under the Apache License, Version 2.0 (the
*  "License"); you may not use this file except in compliance
*  with the License.  You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
*  Unless required by applicable law or agreed to in writing,
*  software distributed under the License is distributed on an
*  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
*  KIND, either express or implied.  See the License for the
*  specific language governing permissions and limitations
*  under the License.
*
*  ## Description
*
*  This module handles group user invitation and group user admin sharing.
*/

module.exports = (function () {
  'use strict';
  // Global dependencies
  var m  = require('mithril');
  var ld = require('lodash');

  // Local dependencies
  var conf       = require('../configuration.js');
  var auth       = require('../auth.js');
  var model      = require('../model/group.js');
  var layout     = require('./layout.js');
  var notif      = require('../widgets/notification.js');
  var tag        = require('../widgets/tag.js');
  var form       = require('../helpers/form.js');
  var cleanupXss = require('../helpers/cleanupXss.js');
  var cookies = require('js-cookie');

  var invite = {};

  /**
  * `submit` function calls the public API to update the group with new users
  * or admins. It displays errors if needed or success.
  *
  * It takes the instantiated `c` controller and an optional `successFn`
  * function called with `resp`onse and filters user invitation by known users
  * only.
  */

  invite.invite = function (c, successFn) {
    c.action = (m.route.param('action'));

    if(c.action == "add"){
      var data = {
        gid: c.group._id,
        loginsOrEmails: c.tag.current,
        auth_token: auth.token(),
        type: 'groups'
      };
      m.request({
        method: 'POST',
        url: conf.URLS.GROUP + '/add-watchers',
        data: data
      }).then(function (resp) {
        var loginsOrEmails = c.tag.current;
        var user = auth.userInfo();
        if (loginsOrEmails.includes(user.login)) {
          if (!user.watchlist.groups.includes(c.group._id)) {
            user.watchlist.groups.push(c.group._id);
          }
        } else {
          if (user.watchlist.groups.includes(c.group._id)) {
            user.watchlist.groups.splice(user.watchlist.groups.indexOf(c.group._id));
          }
        }
        var lpfx = "ADD_WATCHER";
        var msg;
        if (resp.present.length > 0) {
          msg = conf.LANG.GROUP[lpfx].SUCCESS + cleanupXss.cleanup(resp.present.join(', '));
          notif.success({ body: msg });
        }
        if (resp.absent.length > 0) {
          msg = conf.LANG.GROUP[lpfx].FAILURE + cleanupXss.cleanup(resp.absent.join(', '));
          notif.warning({ body: msg });
        }
        if ((resp.absent.length === 0) && (resp.present.length === 0)) {
          notif.success({ body: conf.LANG.NOTIFICATION.SUCCESS_GENERIC });
        }
        model.fetch(function () {
          if (successFn) { successFn(resp); }
        });
      }, function (err) {
        checkJwtErr(err);
        notif.error({ body: ld.result(conf.LANG, err.error) });
      });
    }
    else{
      var data = {
        invite: c.action == "invite",
        gid: c.group._id,
        loginsOrEmails: c.tag.current,
        auth_token: auth.token()
      };
      m.request({
        method: 'POST',
        url: conf.URLS.GROUP + '/invite',
        data: data
      }).then(function (resp) {
        if(c.action == "invite"){
          var lpfx = 'INVITE_USER';
        }
        else if(c.action == "share"){
          var lpfx = 'ADMIN_SHARE';
        }
        var msg;
        if (resp.present.length > 0) {
          msg = conf.LANG.GROUP[lpfx].SUCCESS + cleanupXss.cleanup(resp.present.join(', '));
          notif.success({ body: msg });
        }
        if (resp.absent.length > 0) {
          msg = conf.LANG.GROUP[lpfx].FAILURE + cleanupXss.cleanup(resp.absent.join(', '));
          notif.warning({ body: msg });
        }
        if ((resp.absent.length === 0) && (resp.present.length === 0)) {
          notif.success({ body: conf.LANG.NOTIFICATION.SUCCESS_GENERIC });
        }
        model.fetch(function () {
          if (successFn) { successFn(resp); }
        });
      }, function (err) {
        checkJwtErr(err);
        notif.error({ body: ld.result(conf.LANG, err.error) });
      });
    }
    
  };

  /**
  * ## Controller
  *
  * Used to check authentication, init data for tag like widget with users and
  * admins and gather data if not already fetched.
  */

  invite.controller = function () {

    if (!auth.isAuthenticated()) {
      conf.unauthUrl(true);
      return m.route('/login');
    }

    var uInfo  = auth.userInfo();
    var c      = {};
    c.action = (m.route.param('action'));

    var init = function () {
      var group = m.route.param('group');
      c.group   = model.groups()[group];
      var users = model.users();
      users     = ld.reduce(users, function (memo, val) {
        memo.byId[val._id]      = val;
        memo.byLogin[val.login] = val;
        memo.byEmail[val.email] = val;
        return memo;
      }, { byId: {}, byLogin: {}, byEmail: {} });
      c.users     = ld.merge(users.byLogin, users.byEmail);

      var picklist;
      if(c.action == "invite"){
        picklist = c.group.users;
      }
      else if(c.action == "share"){
        picklist = c.group.admins;
      }
      else if(c.action == "add"){   
        picklist = c.group.watchers;
      }
      var current = ld(users.byId)
        .pick(picklist)
        .values()
        .pluck('login')
        .value();

      
      c.tag = new tag.controller({
        name: 'user-invite',
        label: conf.LANG.GROUP.INVITE_USER.USERS_SELECTION,
        current: current,
        placeholder: conf.LANG.GROUP.INVITE_USER.PLACEHOLDER,
        tags: ld.pull(ld.keys(c.users), uInfo.login, uInfo.email)
      });
    };
    if (ld.isEmpty(model.groups())) { model.fetch(init); } else { init(); }

    /**
    * ### userlistAdd
    *
    * `userlistAdd` function adds all members of the userlist to current
    * invited users.
    */

    c.userlistAdd = function (ulid) {
      var ul        = uInfo.userlists[ulid];
      c.tag.current = ld.union(c.tag.current, ld.pluck(ul.users, 'login'));
    };

    /**
    * ### submit
    *
    * `submit` function calls the public API to update the group with new users
    * or admins. It displays errors if needed or success.
    *
    * It filters user invitation by known users only.
    */

    c.submit = function (e) {
      e.preventDefault();
      var successFn = function (resp) {
        m.route('/mypads/group/' + resp.value._id + '/view');
        
      };
      invite.invite(c, successFn);
      
    };

    return c;
  };

  /**
  * ## Views
  */

  var view = {};

  view.userlistField = function (c) {
    return m('div', [
      m('.form-group', [
        m('label.col-sm-4', { for: 'userlists' }, conf.LANG.MENU.USERLIST),
        m('i', {
          class: 'mp-tooltip glyphicon glyphicon-info-sign',
          'data-msg': conf.LANG.USERLIST.INFO.USER_INVITE
        }),
        m('.col-sm-7',
          m('select.form-control', {
            name: 'userlists',
            onchange: m.withAttr('value', c.userlistAdd)
          }, (ld.map(ld.pairs(auth.userInfo().userlists), function (ul) {
            return m('option', { value: ul[0] }, ul[1].name);
          })).concat(m('option', {
            selected: true,
            disabled: true,
            hidden: true,
            value: ''
          })))
        )
      ])
    ]);
  };

  view.userField = function (c) {
    var tagInput          = tag.views.input(c);
    tagInput.attrs.config = form.focusOnInit;
    return m('div.tag', [
      m('.form-group', [
        m('label.col-sm-4', { for: c.name }, c.label),
        m('i', {
          class: 'mp-tooltip glyphicon glyphicon-info-sign tag',
          'data-msg': conf.LANG.GROUP.INVITE_USER.INPUT_HELP }),
        m('.col-sm-7', [
          m('.input-group', [
            tagInput,
            m('span.input-group-btn',
              m('button.btn.btn-default', {
              type: 'button',
              onclick: function () {
                c.add(document.getElementById(c.name + '-input'));
              },
            }, conf.LANG.USER.OK)
            )
          ]),
          tag.views.datalist(c)
        ])
      ]),
      m('.form-group', [
        m('label.col-sm-4', conf.LANG.GLOBAL.OR),
        m('i', {
          class: 'mp-tooltip glyphicon glyphicon-info-sign tag',
          'data-msg': conf.LANG.USERLIST.FIELD.USERSAREA_HELP }),
        m('.col-sm-7', [
          m('textarea.form-control', {
            name: 'usersArea',
            placeholder: conf.LANG.USERLIST.FIELD.USERSAREA_PLACEHOLDER,
          }),
          m('button.btn.btn-default.pull-right', {
            type: 'button',
            onclick: function () {
              c.addMultiple(document.querySelector('textarea[name=usersArea]'));
            },
          }, conf.LANG.USER.OK)
        ])
      ])
    ]);
  };

  view.form = function (c) {
    var GROUP  = conf.LANG.GROUP;
    var legendText;
    if(c.action == "invite"){
      legendText = GROUP.INVITE_USER.IU;
    }
    else if(c.action == "share"){
      legendText = GROUP.ADMIN_SHARE.AS;
    }
    else if(c.action == "add"){
      legendText = GROUP.ADD_WATCHER.AS;
    }
    var fields = [
      m('fieldset', [
        m('legend', (GROUP.INVITE_USERLIST)),
        m('div', view.userlistField(c))
      ]),
      m('fieldset', [
        m('legend', legendText),
        m('div', view.userField(c.tag))
      ]),
      m('fieldset', [
        m('legend', conf.LANG.GROUP.INVITE_USER.USERS_SELECTED),
        m('div', tag.views.tagslist(c.tag))
      ]),
      m('input.btn.btn-success.pull-right', {
        form: 'group-form',
        type: 'submit',
        value: conf.LANG.ACTIONS.SAVE
      })
    ];
    if (conf.SERVER.allPadsPublicsAuthentifiedOnly) {
      fields.shift();
    }
    return m('form.form-horizontal', {
      id: 'group-form',
      onsubmit: c.submit
    }, fields);
  };

  view.main = function (c) {
    return m('section', { class: 'user group-form' }, [
      m('h2', conf.LANG.GROUP.GROUP + ' ' + c.group.name),
      view.form(c)
    ]);
  };

  view.aside = function (c) {
    var GROUP = conf.LANG.GROUP;
    var legendText;
    if(c.action == "invite"){
      legendText = GROUP.INVITE_USER.IU;
    }
    else if(c.action == "share"){
      legendText = GROUP.ADMIN_SHARE.AS;
    }
    else if(c.action == "add"){
      legendText = GROUP.ADD_WATCHER.AS;
    }
    return m('section.user-aside', [
      m('h2', conf.LANG.ACTIONS.HELP),
      m('article.well', [
        m('h3', legendText),
        m('section', m.trust(conf.LANG.GROUP.INVITE_USER.HELP))
      ])
    ]);
  };

  invite.view = function (c) {
    return layout.view(view.main(c), view.aside(c));
  };

  /** 
  * ##checkJwtErr
  * For handling timeout error (check api.js for fn.checkJwt). 
  *
  * If error is confirmed to be incorrect token or session timeout (expired jwt),
  * this will send a logout api call (to do necessary server side processing) 
  * and handle response in the client side accordingly.
  *
  * Note: logout part copied (with minor modifications) from logout.js 
  *
  */

  var checkJwtErr = function (err) {
    if (err && (err.error === 'BACKEND.ERROR.AUTHENTICATION.SESSION_TIMEOUT' ||
         err.error === 'BACKEND.ERROR.AUTHENTICATION.TOKEN_INCORRECT')) {      
      if (!auth.isAuthenticated()) { return m.route('/login'); }
      m.request({
        method: 'GET',
        url: conf.URLS.LOGOUT,
        config: auth.fn.xhrConfig
      }).then(function () {
        /*
         * Fix pad authorship mixup
         * See https://framagit.org/framasoft/ep_mypads/issues/148
         */
        if (cookies.get('token')) {
          cookies.set('token-' + auth.userInfo().login, cookies.get('token'), { expires: 365 });
          cookies.remove('token');
        }
        auth.userInfo(null);
        localStorage.removeItem('token');
        localStorage.removeItem('exp');
        m.route('/login');
      }, function(err) {
        notif.error({ body: ld.result(conf.LANG, err.error) });
      });
      return true;
    }
    return false;
  }

  return invite;
}).call(this);
