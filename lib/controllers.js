'use strict';

const fs = require('fs');
const temp = require('temp');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const pkg = require('../package.json');

const NATIVE = 'NATIVE_APP';

var controllers = {};

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
     const result = yield this.proxy.sendCommand('/wd/hub/session/temp/window', 'POST', { 'name': name });
     _.parseWebDriverResult(result);
     this.context = name;
  } else {
    this.proxy = null;
  }
};

controllers.click = function *(elementId) {
  return yield this.send({
    cmd: 'click',
    args: {
      elementId: elementId
    }
  });
};

controllers.swipe = function *(startX, startY, endX, endY, duration) {
  return yield this.send({
    cmd: 'swipe',
    args: {
      startX: startX,
      startY: startY,
      endX: endX,
      endY: endY,
      duration: duration
    }
  });
};

controllers.getWindowSize = function *() {
  var width =  yield this.getDisplayWidth();
  var height = yield this.getDisplayHeight();

  return {
    width: width,
    height: height
  };
}

controllers.getDisplayWidth = function *() {
  return yield this.send({
    cmd: 'getDisplayWidth',
    args: {}
  });
}

controllers.getDisplayHeight = function *() {
  return yield this.send({
    cmd: 'getDisplayHeight',
    args: {}
  });
}

controllers.tap = function *(elementId) {
  return yield this.send({
    cmd: 'click',
    args: {
      elementId: elementId
    }
  });
};

controllers.setValue = function *(elementId, value) {
  var args = {
    elementId: elementId,
    text: value.join('')
  };
  return yield this.send({
    cmd: 'setText',
    args: args
  });
};

controllers.getText = function *(elementId) {
  var args = {
    elementId: elementId
  };
  return yield this.send({
    cmd: 'getText',
    args: args
  });
};

controllers.clearText = function *(elementId) {
  var args = {
    elementId: elementId
  };
  return yield this.send({
    cmd: 'clearText',
    args: args
  });
};

controllers.findElement = function *(strategy, selector, elementId) {
  var args = {
    strategy: strategy,
    selector: selector,
    multiple: false
  };
  return yield this.send({
    cmd: 'find',
    args: args
  });
};

controllers.findElements = function *(strategy, selector, elementId) {
  var args = {
    strategy: strategy,
    selector: selector,
    multiple: true
  };
  return yield this.send({
    cmd: 'find',
    args: args
  });
};

controllers.getScreenshot = function *() {
  const swapFile = temp.openSync({
    prefix: `${pkg.name}-screenshot`,
    suffix: '.png'
  });
  const swapFilePath = swapFile.path;
  const remoteFile = `${this.adb.getTmpDir()}/screenshot.png`;
  const cmd = `/system/bin/rm ${remoteFile}; /system/bin/screencap -p ${remoteFile}`;
  yield this.adb.shell(cmd);

  _.rimraf(swapFilePath);

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

module.exports = controllers;
