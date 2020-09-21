const settings = require('../../settings.js');

module.exports = new class PathUtils {
    /**
     * Extracts the jme module out of the full path
     * @param {The relative path to the spotbugs output file} path
     */
    extractModuleName = (path) => {
      /* The following code looks bad but we cannot use regex properly here due
        * to the paths needing to be escaped.
        */
      if (path.endsWith(settings.config.spotbugs.resultPath)) {
        return path.substring(0, path.indexOf(settings.config.spotbugs.resultPath) - 1);
      }
      throw Error('Not a valid path!');
    };

    /**
     * Extracts the jme module out of the expectations path
     * @param {The relative path to the spotbugs file of previous runs} path
     */
    extractModuleNameExpectationsPath = (path) => {
      if (path.startsWith(settings.config.spotbugs.expectationsPath) && path.endsWith('.xml')) {
        return path.substring(settings.config.spotbugs.expectationsPath.length, path.indexOf('.xml'));
      }
      throw Error('Not a valid path');
    }
}();
