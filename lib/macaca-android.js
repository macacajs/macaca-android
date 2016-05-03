'use strict';

const path = require('path');
const EOL = require('os').EOL;
const JAVA = require('java-util');
const ADB = require('macaca-adb');
const UnlockApk = require('unlock-apk');
const DriverBase = require('driver-base');
const UIAutomator = require('uiautomator-client');
const ChromeDriver = require('macaca-chromedriver');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const logger = require('./logger');
const controllers = require('./controllers');
const WEBVIEW = 'WEBVIEW';

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
    this.contexts = [];
  }
}

Android.prototype.startDevice = function *(caps) {
  this.args = _.clone(caps);
  this.isChrome = this.args.browserName && this.args.browserName.toLowerCase() === 'chrome';
  yield JAVA.getVersion();
  this.initAdb();
  yield this.initDevice();
  yield this.initUiautomator();
  yield this.getApkInfo();
  yield this.adb.install(UnlockApk.apkPath);
  yield this.unlock();
  yield this.launchApk();
  yield this.waitActivityReady();

  if (this.isChrome) {
    yield this.getWebviews();
  }
};

Android.prototype.stopDevice = function() {
  return ADB.emuKill();
};

Android.prototype.isProxy = function() {
  return !!this.proxy;
};

Android.prototype.whiteList = function(context) {
  var basename = path.basename(context.url);
  const whiteList = ['context', 'contexts', 'screenshot'];
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

Android.prototype.initUiautomator = function *() {
  this.uiautomator = new UIAutomator();
  yield this.uiautomator.init(this.adb);
};

Android.prototype.initDevice = function *() {
  var devices = yield ADB.getDevices();

  if (devices.length) {
    var device = devices[0];
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

      if (devices.length) {
        device = devices[0];
        this.adb.setDeviceId(device.udid);
        this.udid = device.udid;
      } else {
        throw new Error('emulator start failed or too slow!');
      }
    }
  }
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
  var isScreenLocked = yield this.adb.isScreenLocked();

  if (isScreenLocked) {
    yield this.adb.startApp(UnlockApk);
    yield _.sleep(5000);
    yield this.unlock();
  }
};

Android.prototype.launchApk = function *() {
  var isInstalled = yield this.adb.isInstalled(this.apkInfo.package);

  if (!isInstalled) {
    yield this.adb.install(this.args.app);
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
  return yield this.uiautomator.send(data);
};

_.extend(Android.prototype, controllers);

module.exports = Android;
