'use strict';

const path = require('path');
const EOL = require('os').EOL;
const JAVA = require('java-util');
const ADB = require('macaca-adb');
const UnlockApk = require('unlock-apk');
const DriverBase = require('driver-base');
const UnicodeInput = require('android-unicode');
const UIAutomator = require('uiautomator-client');
const ChromeDriver = require('macaca-chromedriver');
const errors = require('webdriver-dfn-error-code');

const _ = require('./helper');
const logger = require('./logger');
const controllers = require('./controllers');

const WEBVIEW = 'WEBVIEW';
const reuseStatus = {};
reuseStatus.noReuse = 0;
reuseStatus.reuseEmu = 1;
reuseStatus.reuseEmuApp = 2;

class Android extends DriverBase {
  constructor() {
    super();
    this.adb = null;
    this.apkInfo = null;
    this.args = null;
    this.chromedriver = null;
    this.chromeDriverPort = null;
    this.proxy = null;
    this.udid = null;
    this.uiautomator = null;
    this.isChrome = null;
    this.isVirtual = true;
    this.moveToPosition = null;
    this.contexts = [];
  }
}

Android.prototype.startDevice = function *(caps) {
  this.args = _.clone(caps);
  this.isChrome = this.args.browserName && this.args.browserName.toLowerCase() === 'chrome';
  yield JAVA.getVersion();
  this.initReuse();
  this.initAdb();
  yield this.initDevice();
  yield this.initUiautomator();
  yield this.getApkInfo();
  yield this.unlock();
  yield this.setIME();
  yield this.launchApk();
  yield this.waitActivityReady();

  if (this.isChrome) {
    yield this.getWebviews();
  }
};

Android.prototype.stopDevice = function *() {
  yield this.unsetIME();
  this.chromedriver && this.chromedriver.stop();
  if (this.isVirtual && this.args.reuse === reuseStatus.noReuse) {
    return ADB
      .emuKill()
      .catch(e => {
        logger.warn(e);
      });
  }

  return Promise.resolve();
};

Android.prototype.isProxy = function() {
  return !!this.proxy;
};

Android.prototype.whiteList = function(context) {
  var basename = path.basename(context.url);
  const whiteList = ['context', 'contexts', 'screenshot', 'swipe'];
  return !!~whiteList.indexOf(basename);
};

Android.prototype.proxyCommand = function(url, method, body) {
  return this.proxy.sendCommand(url, method, body);
};

Android.prototype.waitActivityReady = function *() {

  yield this.adb.waitActivityReady(this.apkInfo.package, this.apkInfo.activity);

  yield _.sleep(3000);

  yield this.send({
    cmd: 'wake',
    args: {}
  });
  yield _.sleep(3000);
};

Android.prototype.initAdb = function() {
  this.adb = new ADB();
};

Android.prototype.initReuse = function() {
  let resue = parseInt(this.args.reuse);
  if (!resue && resue !== reuseStatus.noReuse) {
    resue = reuseStatus.reuseEmu;
  }
  this.args.reuse = resue;
};

Android.prototype.initUiautomator = function *() {
  this.uiautomator = new UIAutomator();
  yield this.uiautomator.init(this.adb);
};

Android.prototype.initDevice = function *() {

  if (this.args.udid) {
    this.udid = this.args.udid;
    this.adb.setDeviceId(this.udid);
    return;
  }
  var devices = yield ADB.getDevices();
  var device = devices[0];

  if (device) {
    this.adb.setDeviceId(device.udid);
    this.udid = device.udid;
  } else {
    console.log('no device, now create one from avd');
    var env = global.process.env;
    var emulatorCommand = path.resolve(env.ANDROID_HOME, 'tools', 'emulator');
    var androidCommand = path.resolve(env.ANDROID_HOME, 'tools', 'android');

    var data = yield _.exec(`${androidCommand} list avd`);
    data = data.split(EOL);
    data.shift();

    if (data.length === 0) {
      throw new Error('no avd created! Please create one avd first');
    } else {
      var avdArr = data.filter(avd => {return /Name:/.test(avd);}).map(avd => avd = _.trim(avd.split(':')[1]));
      _.exec(`${emulatorCommand} -avd ${avdArr[0]}`);

      var checkEmulator = () => {
        return new Promise((resolve, reject) => {
          ADB.getBootStatus().then(data => {
            resolve(data === 'stopped');
          }).catch(err => {
            reject('check emulator failed');
          });
        });
      };
      yield _.waitForCondition(checkEmulator, 60 * 1000, 2 * 1000);

      devices = yield ADB.getDevices();
      device = devices[0];

      if (device) {
        this.adb.setDeviceId(device.udid);
        this.udid = device.udid;
      } else {
        throw new Error('emulator start failed or too slow!');
      }
    }
  }
  this.isVirtual = device.type === 'virtual';
};

Android.prototype.getApkInfo = function *() {

  if (this.isChrome) {
    return this.apkInfo = {
      package: 'com.android.browser',
      activity: '.BrowserActivity'
    }
  }

  if (this.args.package && this.args.activity) {
    this.apkInfo = {
      package: this.args.package,
      activity: this.args.activity
    };
  } else {
    this.apkInfo = yield ADB.getApkMainifest(this.args.app);
  }
};

Android.prototype.unlock = function *() {
  if (!_.isExistedFile(UnlockApk.apkPath)) {
    logger.warn(`unlock apk not found in: ${UnlockApk.apkPath}`);
    return;
  }
  yield this.adb.install(UnlockApk.apkPath);
  var isScreenLocked = yield this.adb.isScreenLocked();

  if (isScreenLocked) {
    yield this.adb.startApp(UnlockApk);
    yield _.sleep(5000);
    yield this.unlock();
  }
};

Android.prototype.setIME = function *() {
  yield this.adb.install(UnicodeInput.apkPath);
  yield this.adb.setIME(`${UnicodeInput.package}/${UnicodeInput.activity}`);
};

Android.prototype.unsetIME = function *() {
  yield this.adb.unInstall(UnicodeInput.package);
};

Android.prototype.launchApk = function *() {

  if (!this.isChrome) {
    const reuse = this.args.reuse;
    var isInstalled = yield this.adb.isInstalled(this.apkInfo.package);
    if (isInstalled) {
      switch (reuse) {
        case reuseStatus.noReuse:
        case reuseStatus.reuseEmu:
          yield this.adb.unInstall(this.apkInfo.package);
        case reuseStatus.reuseEmuApp:
          yield this.adb.install(this.args.app);
      }
    } else {
      yield this.adb.install(this.args.app);
    }
  }
  yield this.adb.startApp(this.apkInfo);
  yield _.sleep(5000);
};

Android.prototype.getWebviews = function *() {
  if (!this.chromedriver) {
    yield this.initChromeDriver();
  }
  if (!this.proxy) {
    this.proxy = this.chromedriver;
  }

  var webviews = [];

  if (this.isProxy()) {
    const result = yield this.proxy.sendCommand('/wd/hub/session/temp/window_handles', 'GET', {});
    webviews = _.parseWebDriverResult(result);
  }

  return webviews;
};

Android.prototype.initChromeDriver = function() {
  return new Promise((resolve, reject) => {
    this.chromedriver = new ChromeDriver();
    this.chromedriver.on(ChromeDriver.EVENT_READY, data => {
      logger.info(`chromedriver ready with: ${JSON.stringify(data)}`);
      resolve('');
    });
    this.chromedriver.start({
      chromeOptions: {
        androidPackage: this.apkInfo.package,
        androidUseRunningApp: true,
        androidDeviceSerial: this.udid
      }
    });
  });
};

Android.prototype.send = function *(data) {
  var res = yield this.uiautomator.send(data);
  return this.handleError(res);
};

Android.prototype.handleError = function(res) {
  if(res.status != 0) {
    var errName = errors.getErrorByCode(res.status);
    if (errName) {
      throw new errors.errors[errName](res.value);
    } else {
      throw new errors.errors.UnknownError();
    }
  }
  return res.value;
};

_.extend(Android.prototype, controllers);

module.exports = Android;
