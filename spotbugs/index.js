const exec = require('child-process-promise').exec;

async function gradlew(task) {
    return exec("java -cp gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain " + task)
}

await gradlew("spotbugsMain -Pxml-reports=true").then(out => console.log(out.stderr)).catch(err => console.error(err))

// jme3-core/build/reports/...
