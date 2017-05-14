'use strict';

const fs = require('fs');
const temp = require('temp');
const ADB = require('macaca-adb');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const keyMap = require('./key-map');
const pkg = require('../package.json');

const NATIVE = 'NATIVE_APP';

var controllers = {};

controllers.isWebContext = function() {
  return this.context && this.context !== NATIVE;
};

controllers.getContext = function *() {
  return this.context;
};

controllers.getContexts = function *() {
  const contexts = [NATIVE].concat(yield this.getWebviews());
  this.contexts = contexts;
  return contexts;
};

controllers.setContext = function *(name) {
  yield this.getContexts();
  if (name !== NATIVE) {
     if (!~this.contexts.indexOf(name)) {
      throw new errors.NoSuchWindow();
     }
     const result = yield this.proxy.sendCommand('/wd/hub/session/temp/window', 'POST', {
       name: name
     });
     _.parseWebDriverResult(result);
  } else {
    this.proxy = this.uiautomator;
  }
  this.context = name;
};

controllers.getScreenshot = function *() {
  const swapFilePath = temp.path({
    prefix: `${pkg.name}-screenshot`,
    suffix: '.png'
  });

  const remoteFile = `${ADB.ANDROID_TMP_DIR}/screenshot.png`;
  const cmd = `/system/bin/rm ${remoteFile}; /system/bin/screencap -p ${remoteFile}`;
  yield this.adb.shell(cmd);

  yield this.adb.pull(remoteFile, swapFilePath);

  var base64 = null;

  try {
    let data = fs.readFileSync(swapFilePath);
    base64 = new Buffer(data).toString('base64');
  } catch (e) {
    throw new errors.NoSuchWindow();
  }

  _.rimraf(swapFilePath);
  return base64;
};

controllers.get = function *(url) {
  const cmd = `am start -a android.intent.action.VIEW -d ${url}`;
  yield this.adb.shell(cmd);
  return null;
};

controllers.back = function *() {
  yield this.adb.goBack();
  return null;
};

controllers.tap = function(action) {
  return this
    .proxyCommand('/wd/hub/session/temp/touch/click', 'POST', {
      element: action.element
    }).then(result => {
      return _.parseWebDriverResult(result);
    });
};

controllers.keys = function *(value) {
  value = value.join('');
  var arrText = [];

  for (var i = 0; i < value.length; i++) {
    var key = value.charAt(i);

    const keyEvent = keyMap[key];
    if (keyEvent) {
      if(arrText.length > 0){
        yield this.setValue('', arrText);
        arrText = [];
      }
      yield this.adb.input(`keyevent ${keyEvent}`);
    } else {
      arrText.push(key);
    }
  }
  if (arrText.length > 0) {
    yield this.setValue('', arrText);
  }
  return null;
};

controllers.getSource = function *() {
  yield this.adb.shell(`touch ${ADB.ANDROID_TMP_DIR}/macaca-dump.xml`);
  var res = yield this.proxyCommand('/wd/hub/session/temp/source', 'get', null);
  return res.value;
};

module.exports = controllers;
