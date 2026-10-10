const { withXcodeProject } = require('@expo/config-plugins');

module.exports = function withDeploymentTarget(config, deploymentTarget = '16.0') {
  return withXcodeProject(config, async config => {
    const xcodeProject = config.modResults;
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    
    for (const key in configurations) {
      const config_item = configurations[key];
      if (config_item.buildSettings) {
        config_item.buildSettings['IPHONEOS_DEPLOYMENT_TARGET'] = deploymentTarget;
      }
    }
    return config;
  });
};