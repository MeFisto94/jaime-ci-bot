const exec = require('child-process-promise').exec;

async function gradlew(task) {
    return exec("java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain " + task)
}

console.log("Pre gradlew");
await gradlew("spotbugsMain -Pxml-reports=true").then(out => console.log(out.stderr)).catch(err => { console.log(err); console.error(err) });
console.log("post gradlew");
// jme3-core/build/reports/tests/
