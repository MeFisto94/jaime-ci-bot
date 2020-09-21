const { exec } = require('child-process-promise');
const settings = require('./settings.js');

async function gradlew(task, path = undefined,
  classPath = settings.config.gradle_wrapper.classPath || 'gradle/wrapper/gradle-wrapper.jar',
  mainClass = settings.config.gradle_wrapper.mainClass || 'org.gradle.wrapper.GradleWrapperMain') {
  if (path !== undefined) {
    return exec(`java -cp ${classPath} ${mainClass} ${task}`, { cwd: path });
  }
  return exec(`java -cp ${classPath} ${mainClass} ${task}`);
}

module.exports = {
  gradlew,
};
