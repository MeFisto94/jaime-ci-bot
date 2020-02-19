const exec = require('child-process-promise').exec;
const glob = require('glob-promise');

async function gradlew(task) {
    return exec("cd ../../ && java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain " + task)
}

async function main() {
//await exec("pwd").then(out => console.log(out.stdout));
await gradlew("spotbugsMain -Pxml-reports=true --continue").then(out => console.log(out.stderr)).catch(err => { console.error(err) });
glob('../../**/build/reports/spotbugs/main.xml').then(files => console.log(files));
// jme3-core/build/reports/spotbugs/
}

try {
    main();
} catch (e) {
    console.error(e);
}
