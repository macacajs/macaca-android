'use strict';

const fs = require('fs');
const temp = require('temp');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const keyMap = require('./key-map');
const pkg = require('../package.json');

const NATIVE = 'NATIVE_APP';

var controllers = {};

controllers.isWebContext = function() {
  return this.context !== null && this.context !== NATIVE;
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
    this.proxy = null;
  }
  this.context = name;
};

controllers.click = function *(elementId) {
  return yield this.send({
    cmd: 'click',
    args: {
      elementId: elementId
    }
  });
};

controllers.getScreenshot = function *() {
  const swapFilePath = temp.path({
    prefix: `${pkg.name}-screenshot`,
    suffix: '.png'
  });

  const tmpDir = '/data/local/tmp';
  const remoteFile = `${tmpDir}/screenshot.png`;
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

module.exports = controllers;
