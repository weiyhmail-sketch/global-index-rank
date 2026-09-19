const config = require("./config.js");

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("基础库版本过低，无法使用云开发");
      return;
    }
    wx.cloud.init({ env: config.cloudEnv, traceUser: true });
  },
});
