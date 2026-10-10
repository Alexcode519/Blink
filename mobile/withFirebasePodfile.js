const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

module.exports = function withFirebasePodfile(config) {
  return withDangerousMod(config, ['ios', async (config) => {
    const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
    let podfile = fs.readFileSync(podfilePath, 'utf8');
    podfile = podfile.replace('use_react_native!(', "pod 'GoogleUtilities', :modular_headers => true\npod 'FirebaseCoreInternal', :modular_headers => true\nuse_react_native!(");
    fs.writeFileSync(podfilePath, podfile);
    return config;
  }]);
};