const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFileAsync = promisify(fs.readFile);

module.exports = new class Configurator {
  loadConfig = async (baseDir) => readFileAsync(path.join(baseDir, this.configPath, 'config.yaml'), 'utf8')
    .then((file) => {
      try {
        this.config = yaml.safeLoad(file);
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    });

  // This exposes the loaded configuration file
  config = {};

  // This is the folder that has to contain the configuration
  configPath = '.github/ci-bot';
}();
