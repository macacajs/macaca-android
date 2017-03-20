'use strict';

const fs = require('fs');
const temp = require('temp');
const errors = require('webdriver-dfn-error-code').errors;
const keyMap = require('./key-map');
const _ = require('./helper');
const pkg = require('../package.json');

const NATIVE = 'NATIVE_APP';

var controllers = {};

controllers.isWebContext = function() {
  return this.context != null && this.context !== NATIVE;
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

controllers.getWindowSize = function *() {
  var size = yield this.send({
    cmd: 'getWindowSize',
    args: {}
  });
  return JSON.parse(size);
};

controllers.setValue = function *(elementId, value) {
  return yield this.send({
    cmd: 'setText',
    args: {
      elementId: elementId,
      text: value.join('')
    }
  });
};

/**
see: https://github.com/macacajs/android-unicode#use-in-adb-shell
*/

controllers.keys = function *(value) {
  value = value.join('');
  var text = '';
  for (var index = 0; index < value.length; index++) {
    var key = value.charAt(index);
    const keyEvent = keyMap[key];
    if (keyEvent) {
      yield this.adb.input(`keyevent ${keyEvent}`);
    } else {
      text = text + key;
      if (index + 1 < value.length) {
        var nextKeyEvent = keyMap[value.charAt(index+1)];
        if (nextKeyEvent) {
          yield this.setValue('',text.split(''));
          text = '';
        }
      }
    }
  }
  if (text !== ''){
    yield this.setValue('',text.split(''));
  }
  return null;
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

controllers.findElement = function *(strategy, selector) {
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

controllers.findElements = function *(strategy, selector) {
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
  const swapFilePath = temp.path({
    prefix: `${pkg.name}-screenshot`,
    suffix: '.png'
  });

  const tmpDir = yield this.getTempDir();
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

controllers.getProperty = function *(elementId, name) {
  var res = yield this.send({
    cmd: 'getProperties',
    args: {
      elementId: elementId
    }
  });
  var properties = JSON.parse(res);
  var property = properties[name];
  return property == null ? null: property;
};

controllers.getRect = function *(elementId) {
  return yield this.send({
    cmd: 'getRect',
    args: {
      elementId: elementId
    }
  });
};

controllers.getSource = function *() {
  yield this.send({
    cmd: 'getSource',
    args: {
    }
  });

  const tmpDir = yield this.getTempDir();
  var xml = yield this.adb.shell(`cat ${tmpDir}/macaca-dump.xml`);
  return xml;
};

controllers.getTempDir = function *(){
  return yield this.send({
    cmd: 'getTmpDir',
    args: {
    }
  });
};

controllers.isDisplayed = function *(elementId) {
  return yield this.send({
    cmd: 'isDisplayed',
    args: {
      elementId: elementId
    }
  });
};

controllers.handleActions = function *(actions) {
  if (!actions) {
    throw new errors.UnknownError(`Missing 'actions' in parameters.`);
  }
  if (this.isWebContext()) {
    const futureActions = actions.map(action => {
      const actionDelegate = this[action.type];
      if (actionDelegate) {
        return actionDelegate.bind(this, action);
      } else {
        return () => {
          throw new errors.NotImplementedError(`Action ${action.type} is not implemented yet.`);
        };
      }
    });
    return yield _.serialTasks.apply(null, futureActions);
  } else {
    return yield this.send({
      cmd: 'actions',
      args: {
        actions: actions
      }
    });
  }
};

controllers.tap = function(action) {
  return this
    .proxyCommand('/wd/hub/session/temp/touch/click', 'POST', {
      element: action.element
    }).then(result => {
      return _.parseWebDriverResult(result);
    });
};

controllers.acceptAlert = function *() {
  return yield this.send({
    cmd: 'alert',
    args: {
      action: 'accept'
    }
  });
};

controllers.dismissAlert = function *() {
  return yield this.send({
    cmd: 'alert',
    args: {
      action: 'dismiss'
    }
  });
};

module.exports = controllers;
