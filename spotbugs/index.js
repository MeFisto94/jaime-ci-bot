const exec = require('child-process-promise').exec;
const glob = require('glob-promise');
const xml2js = require('xml2js');
const fs = require('fs');
const util = require('util');

async function gradlew(task) {
    return exec("cd ../../ && java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain " + task)
}

async function main() {
//await exec("pwd").then(out => console.log(out.stdout));
await gradlew("spotbugsMain -Pxml-reports=true --continue").then(out => console.log(out.stderr)).catch(err => { console.error(err) });

reports = {};

glob('../../**/build/reports/spotbugs/main.xml').then(files =>
    files.forEach(file => {
        xml2js.parseStringPromise(fs.readFileSync(file) /*, options */).then((result) => {
            reports[file] = result["BugCollection"]["BugInstance"];
            // filter EL_EXPOSE_REP
            console.log(util.inspect(rports[file], false, null)) // console.dir(reports[file]);
          });
    })
);
// jme3-core/build/reports/spotbugs/
}

try {
    main();
} catch (e) {
    console.error(e);
}
