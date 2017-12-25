'use strict';

const macacaUtils = require('macaca-utils');
const childProcess = require('child_process');
const errors = require('webdriver-dfn-error-code').errors;
const getErrorByCode = require('webdriver-dfn-error-code').getErrorByCode;

var _ = macacaUtils.merge({}, macacaUtils);

_.sleep = function(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

_.exec = function(cmd, opts) {
  return new Promise(function(resolve, reject) {
    childProcess.exec(cmd, _.merge({
      maxBuffer: 1024 * 512,
      wrapArgs: false
    }, opts || {}), function(err, stdout) {
      if (err) {
        return reject(err);
      }
      resolve(_.trim(stdout));
    });
  });
};

_.serialTasks = function () {
  return Array.prototype.slice.call(arguments).reduce(
    (pre, task) => pre.then(() => task()), Promise.resolve());
};

_.waitForCondition = function(func, wait/* ms*/, interval/* ms*/) {
  wait = wait || 5000;
  interval = interval || 500;
  let start = Date.now();
  let end = start + wait;
  const fn = function() {
    return new Promise(function(resolve, reject) {
      const continuation = (res, rej) => {
        let now = Date.now();
        if (now < end) {
          res(_.sleep(interval).then(fn));
        } else {
          rej(`Wait For Condition timeout ${wait}`);
        }
      };
      func().then(isOk => {
        if (isOk) {
          resolve();
        } else {
          continuation(resolve, reject);
        }
      }).catch(() => {
        continuation(resolve, reject);
      });
    });
  };
  return fn();
};

_.parseWebDriverResult = function(res) {
  const code = res.status;
  const value = res.value;
  if (code === 0) {
    return value;
  } else {
    const errorName = getErrorByCode(code);
    const errorMsg = value && value.message;
    throw new errors[errorName](errorMsg);
  }
};

module.exports = _;
