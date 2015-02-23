/**
*  # User Model
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
*/

module.exports = (function () {
  'use strict';

  // Dependencies
  var ld = require('lodash');
  var cuid = require('cuid');
  var storage = require('../storage.js');
  var common = require('./common.js');
  var DBPREFIX = storage.DBPREFIX.USER;
  var CPREFIX = storage.DBPREFIX.CONF;

  /**
  *  ## Description
  *
  *  The `user` is the masterpiece of the MyPads plugin.
  *
  * It initially contains :
  *
  * - `ids`, an huge in memory object to map `_id` to `login` field and ensures
  *   uniqueness of logins
  */

  var user = { ids: {} };

  /**
  *  ## Internal Functions
  */

  user.fn = {};

  /**
  * ### getPasswordConf
  *
  * `getPasswordConf` is an asynchronous function that get from database values
  * for minimum and maximum passwords. It takes a `callback` function as unique
  * argument called with error or null and results.
  * Internally, it uses `storage.getKeys`.
  */

  user.fn.getPasswordConf = function (callback) {
    var _keys = [CPREFIX + 'passwordMin', CPREFIX + 'passwordMax'];
    storage.fn.getKeys(_keys, function (err, results) {
      if (err) { return callback(err); }
      return callback(null, results);
    });
  };

  /**
  * ### checkPassword
  *
  *  `checkPassword` is a private helper aiming at respecting the minimum
  *  length fixed into MyPads configuration.
  *
  *  It takes two arguments, with fields
  *
  *    - `password` string
  *    - an options objec with
    *    - `passwordMin` size
    *    - `passwordMax` size
  *
  *  It returns an error message if the verification has failed.
  */

  user.fn.checkPassword = function (password, params) {
    var pass = password;
    var min = params[CPREFIX + 'passwordMin'];
    var max = params[CPREFIX + 'passwordMax'];
    if (pass.length < min || pass.length > max) {
      return new TypeError('password length must be between ' + min + ' and ' +
      max + ' characters');
    }
  };

  /**
  *  ### hashPassword
  *
  *  TODO: `hashPassword` takes the password and returns a hashed password, for
  *  storing in database and verification.
  */

  user.fn.hashPassword = ld.noop;

  /**
  * ### assignProps
  *
  * `assignProps` takes params object and assign defaults if needed. It adds a
  * `groups` array field, which will holds `model.group` of pads ids. It
  * returns the user object.
  *
  */

  user.fn.assignProps = function (params) {
    var p = params;
    var u = ld.reduce(['firstname', 'lastname', 'organization'],
      function (res, v) {
        res[v] = ld.isString(p[v]) ? p[v] : '';
        return res;
    }, {});
    u.email = (ld.isEmail(p.email)) ? p.email : '';
    u.groups = [];
    return ld.assign({ _id: p._id, login: p.login, password: p.password }, u);
  };

  /**
  * ### getGroups
  *
  * `getGroups` is an asynchronous function that is used for updates only, to
  * retrieve existing `groups` from user and assign them to him. It takes :
  *
  * - the `u` user object
  * - a `callback` function, returning an *Error* or *null* and the updated `u`
  *   object
  */

  user.fn.getGroups = function (u, callback) {
    user.get(u.login, function (err, dbuser) {
      if (err) { return callback(err); }
      u.groups = dbuser.groups;
      callback(null, u);
    });
  };

  /**
  * ### checkLogin
  *
  * This is a function which checks if id or login are already taken for new
  * users and if the login has changed for existing users (updates).
  *
  * It takes, as arguments :
  *
  * - the given `id`, from `params._id` from `user.set`
  * - the assigned `u` user object
  * - a callback
  *
  * It returns, through the callback, an *Error* if the user or login are
  * already here, *null* otherwise.
  */

  user.fn.checkLogin = function (_id, u, callback) {
    if (!_id) {
      var exists = (!ld.isUndefined(user.ids[u.login]) ||
        (ld.includes(ld.values(user.ids), u._id)));
      if (exists) {
        var e = 'user already exists, please choose another login';
        return callback(new Error(e));
      }
      return callback(null);
    } else {
      // u.login has changed for existing user
      if (ld.isUndefined(user.ids[u.login])) {
        var key = ld.findKey(user.ids, function (uid) {
          return uid === _id; 
        });
        delete user.ids[key];
      }
      return callback(null);
    }
  };

  /**
  * ### getDel
  *
  * Local `getDel` wrapper that uses `user.ids` object to ensure uniqueness of
  * login and _id fields before returning `common.getDel` with DBPREFIX fixed.
  * It also handles secondary indexes for *model.group* elements.
  *
  * It takes the mandatory login string as argument and return an error if login
  * already exists. It also takes a mandatory callback function.
  *
  */

  user.fn.getDel = function (del, login, callback) {
    if (!ld.isString(login) || ld.isEmpty(login)) {
      throw new TypeError('login must be a string');
    }
    if (ld.isUndefined(user.ids[login])) {
      return callback(new Error('user not found'));
    }
    var cb = callback;
    if (del) {
      cb = function (err, u) {
        delete user.ids[u.login];
        if (u.groups.length) {
          var GPREFIX = storage.DBPREFIX.GROUP;
          storage.fn.getKeys(
            ld.map(u.groups, function (g) { return GPREFIX + g; }),
            function (err, groups) {
              if (err) { return callback(err); }
              groups = ld.reduce(groups, function (memo, g) {
                ld.pull(g.users, u._id);
                ld.pull(g.admins, u._id);
                memo[GPREFIX + g._id] = g;
                return memo;
              }, {});
              storage.fn.setKeys(groups, function (err) {
                if (err) { return callback(err); }
                callback(null, u);
              });
            }
          );
        } else {
          callback(null, u); 
        }
      };
    }
    common.getDel(del, DBPREFIX, user.ids[login], cb);
  };


  /**
  * ## Public Functions
  *
  * ### init
  *
  * `init` is a function that is called once at the initialization of mypads
  * and loops over all users to map their *login* to their *_id* and then
  * ensures uniqueness.
  *
  * It takes a callback function which is returned with null when finished.
  */

  user.init = function (callback) {
    storage.db.findKeys(DBPREFIX + '*', null, function (err, keys) {
      if (err) { return callback(err); }
      storage.fn.getKeys(keys, function (err, results) {
        if (results) {
          user.ids = ld.transform(results, function (memo, val, key) {
            memo[val.login] = key.replace(DBPREFIX, '');
          });
        }
        callback(null);
      });
    });
  };

  /**
  * ### set
  *
  * Creation and update sets the defaults and checks if required fields have
  * been fixed. It takes :
  *
  * - a `params` object, with
  *   - optional `_id` string, for update only and existing user
  *   - required `login` string
  *   - required `password` string, between *conf.passwordMin* and
  *   *conf.passwordMax*
  *   - optional `email` string, used for communication
  *   - optional `firstname` string
  *   - optional `lastname` string
  *   - optional `organization` string
  *
  * - a classic `callback` function returning error if error, null otherwise
  *   and the user object
  *
  * It takes care of updating correcly the user.ids in memory index.
  * `groups` array can't be fixed here but will be retrieved from database in
  * case of update.
  */

  user.set = function (params, callback) {
    common.addSetInit(params, callback, ['login', 'password']);
    user.fn.getPasswordConf(function (err, results) {
      if (err) { return callback(err); }
      var e = user.fn.checkPassword(params.password, results);
      if (e) { return callback(e); }
      var u = user.fn.assignProps(params);
      u._id = u._id || cuid();
      user.fn.checkLogin(params._id, u, function (err) {
        if (err) { return callback(err); }
        var _final = function (u) {
          storage.db.set(DBPREFIX + u._id, u, function (err) {
            if (err) { return callback(err); }
            user.ids[u.login] = u._id;
            return callback(null, u);
          });
        };
        // Update/Edit case
        if (params._id) {
          user.fn.getGroups(u, function (err, u) {
            if (err) { return callback(err); }
            _final(u);
          });
        } else {
          _final(u);
        }
      });
    });
  };

  /**
  *  ### get
  *
  *  User reading
  *
  *  This function uses `user.fn.getDel` and `common.getDel` with `del` to
  *  *false* . It takes mandatory login string and callback function.
  */

  user.get = ld.partial(user.fn.getDel, false);

  /**
  * ### del
  *
  * User removal
  *
  *  This function uses `user.fn.getDel` and `common.getDel` with `del` to
  *  *true* . It takes mandatory login string and callback function.
  */
  user.del = ld.partial(user.fn.getDel, true);

  /**
  * ## lodash mixins
  *
  * Here are lodash extensions for MyPads.
  *
  * ### isEmail
  *
  * `isEmail` checks if given string is an email or not. It takes a value and
  * returns a boolean.
  *
  * For reference, used regular expression is :
  * /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/;
  */

  ld.mixin({ isEmail: function (val) {
    var rg = new RegExp(['[a-z0-9!#$%&\'*+/=?^_`{|}~-]+',
      '(?:\\.[a-z0-9!#$%&\'*+/=?^_`{|}~-]+)*@(?:[a-z0-9]',
      '(?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z0-9]',
      '(?:[a-z0-9-]*[a-z0-9])?'].join(''));
    return (ld.isString(val) && rg.test(val));
  }});

  return user;

}).call(this);
