const exec = require('child-process-promise').exec;

async function gradlew(task) {
    return exec("java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain " + task)
}

async function main() {
await gradlew("spotbugsMain -Pxml-reports=true").then(out => console.log(out.stderr)).catch(err => { console.log(err); console.error(err) });
// jme3-core/build/reports/tests/
}

try {
    main();
} catch (e) {
    console.error(e);
}

