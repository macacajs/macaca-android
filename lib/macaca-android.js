'use strict';

const path = require('path');
const EOL = require('os').EOL;
const ADB = require('macaca-adb');
const UnlockApk = require('unlock-apk');
const DriverBase = require('driver-base');
const UIAutomatorWD = require('uiautomatorwd');
const ChromeDriver = require('macaca-chromedriver');

const _ = require('./helper');
const logger = require('./logger');
const controllers = require('./controllers');

const reuseStatus = {};

reuseStatus.noReuse = 0;
reuseStatus.reuseEmu = 1;
reuseStatus.reuseEmuApp = 2;
reuseStatus.reuseEmuAppState = 3;

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
    this.contexts = [];
    this.context = null;
    this.isWaitActivity = false;
    this.isActivityReady = false;
  }
}

Android.prototype.startDevice = function *(caps) {
  this.args = _.clone(caps);
  this.isChrome = this.args.browserName && this.args.browserName.toLowerCase() === 'chrome';
  this.initReuse();
  this.initAdb();
  yield this.initDevice();
  yield this.initUiautomator();
  yield this.getApkInfo();
  yield this.unlock();
  yield this.launchApk();

  this.autoAcceptAlerts = Boolean(caps.autoAcceptAlerts);
  this.autoDismissAlerts = Boolean(caps.autoDismissAlerts);
  this.isWaitActivity = Boolean(caps.isWaitActivity);

  if (this.isWaitActivity) {
    yield this.waitActivityReady();
  }

  if (this.isChrome) {
    yield this.getWebviews();
  }
};

Android.prototype.stopDevice = function *() {
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

Android.prototype.isProxy = function () {
  return !!this.proxy;
};

Android.prototype.whiteList = function (context) {
  var basename = path.basename(context.url);
  const whiteList = [
    'context',
    'contexts',
    'screenshot',
    'back',
    'tap',
    'source',
    'keys',
    'url',
    'title'
  ];
  return !!~whiteList.indexOf(basename);
};

Android.prototype.proxyCommand = function *(url, method, body) {

  if (this.autoAcceptAlerts) {
    const acceptUrl = `/wd/hub/session/:sessionId/accept_alert`;
    yield this.proxy.sendCommand(acceptUrl, 'POST', {});
  } else if (this.autoDismissAlerts) {
    const dismissUrl = `/wd/hub/session/:sessionId/dismiss_alert`;
    yield this.proxy.sendCommand(dismissUrl, 'POST', {});
  }

  url = url.replace('property', 'attribute');
  return this.proxy.sendCommand(url, method, body);
};

Android.prototype.waitActivityReady = function *() {

  yield _.sleep(1000);

  try {
    this.isActivityReady = yield this.adb.isActivityReady(this.apkInfo.package, this.apkInfo.activity);
  } catch (e) {
    logger.info(`waiting for activity: \`${this.apkInfo.activity}\` ready`);
  }

  if (!this.isActivityReady) {
    yield this.waitActivityReady();
  }
};

Android.prototype.initAdb = function () {
  this.adb = new ADB();
};

Android.prototype.initReuse = function () {
  let reuse = parseInt(this.args.reuse);
  if (!reuse && reuse !== reuseStatus.noReuse) {
    reuse = reuseStatus.reuseEmu;
  }
  this.args.reuse = reuse;
};

Android.prototype.initUiautomator = function *() {
  this.uiautomator = new UIAutomatorWD();
  this.proxy = this.uiautomator;
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
          }).catch(() => {
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
    this.apkInfo = {
      package: 'com.android.browser',
      activity: '.BrowserActivity'
    };
    return;
  }
  const pkg = this.args.package;
  const activity = this.args.activity;
  const app = this.args.app;
  const androidProcess = this.args.androidProcess;

  if (pkg) {
    this.apkInfo = {
      package: pkg,
      activity: activity,
      androidProcess: androidProcess
    };
  } else if (app) {
    this.apkInfo = yield ADB.getApkMainifest(app);
  } else {
    throw new Error('Either app path or package name should be provided!');
  }
};

Android.prototype.unlock = function *() {

  if (!_.isExistedFile(UnlockApk.apkPath)) {
    logger.warn(`unlock apk not found in: ${UnlockApk.apkPath}`);
    return;
  }

  const isInstalled = yield this.adb.isInstalled(UnlockApk.package);
  if (isInstalled) {
    this.checkApkVersion(UnlockApk.apkPath, UnlockApk.package);
  } else {
    yield this.adb.install(UnlockApk.apkPath);
  }

  var isScreenLocked = yield this.adb.isScreenLocked();

  if (isScreenLocked) {
    yield this.adb.startApp(UnlockApk);
    yield _.sleep(5000);
    yield this.unlock();
  }
};

Android.prototype.checkApkVersion = function *(app, pkg) {
  var newVersion = yield ADB.getApkVersion(app);
  var oldVersion = yield this.adb.getInstalledApkVersion(pkg);
  if (newVersion > oldVersion) {
    yield this.adb.install(app);
  }
};

Android.prototype.launchApk = function *() {

  if (!this.isChrome) {
    const reuse = this.args.reuse;
    const app = this.args.app;
    const pkg = this.apkInfo.package;
    const isInstalled = yield this.adb.isInstalled(pkg);
    if (!isInstalled && !app) {
      throw new Error('App is neither installed, nor provided!');
    }
    if (isInstalled) {
      switch (reuse) {
        case reuseStatus.noReuse:
        case reuseStatus.reuseEmu:
          if (app) {
            yield this.adb.unInstall(pkg);
            yield this.adb.install(app);
          } else {
            yield this.adb.clear(pkg);
          }
          break;
        case reuseStatus.reuseEmuApp:
          if (app) {
            yield this.adb.install(app);
          }
          break;
        case reuseStatus.reuseEmuAppState:
          // Keep app state, don't change to main activity.
          this.apkInfo.activity = '';
      }
    } else {
      yield this.adb.install(app);
    }
  }

  logger.debug(`start app with: ${JSON.stringify(this.apkInfo)}`);
  yield this.adb.startApp(this.apkInfo);
  yield _.sleep(5 * 1000);
};

Android.prototype.getWebviews = function *() {
  if (!this.chromedriver) {
    var webviewVersion = null;
    try {
      webviewVersion = yield this.adb.getWebviewVersion();
    } catch (error) {
      logger.info('No webview version found from adb shell!');
      webviewVersion = null;
    }
    if (webviewVersion) {
      yield this.initChromeDriver({webviewVersion: webviewVersion});
    } else {
      yield this.initChromeDriver({});
    }

  }
  this.proxy = this.chromedriver;

  var webviews = [];

  const result = yield this.proxy.sendCommand('/wd/hub/session/:sessionId/window_handles', 'GET', {});
  webviews = _.parseWebDriverResult(result);

  return webviews;
};

Android.prototype.initChromeDriver = function (options) {
  return new Promise(resolve => {
    this.chromedriver = new ChromeDriver(options);
    this.chromedriver.on(ChromeDriver.EVENT_READY, data => {
      logger.info(`chromedriver ready with: ${JSON.stringify(data)}`);
      resolve('');
    });
    this.chromedriver.start({
      chromeOptions: {
        androidPackage: this.apkInfo.package,
        androidUseRunningApp: true,
        androidDeviceSerial: this.udid,
        androidProcess: this.apkInfo.androidProcess
      }
    });
  });
};

_.extend(Android.prototype, controllers);

module.exports = Android;
