const exec = require('child-process-promise').exec;
const glob = require('glob-promise');
const xml2js = require('xml2js');
const fs = require('fs');
const util = require('util');
const comparators = require('./comparators');
const readFileAsync = util.promisify(fs.readFile);

const github = require('@actions/github');
const core = require('@actions/core');

let comparator = comparators.classAndSignatureComparator;
let relativePath = "../../";
let spotbugsPath = "build/reports/spotbugs/main.xml";
let oldSpotbugsPath = ".github/spotbugs";

async function gradlew(task) {
    return exec("cd " + relativePath + " && java"+
    " -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain " + task)
}

/**
 * Extracts the jme module out of the full path
 * @param {The relative path to the spotbugs output file} path
 */
function extractModuleName(path) {
    /* The following code looks bad but we cannot use regex properly here due
     * to the paths needing to be escaped.
     */
    if (path.startsWith(relativePath) && path.endsWith(spotbugsPath)) {
        return path.substring(relativePath.length, path.indexOf(spotbugsPath) - 1);
    } else {
        throw Error("Not a valid path!");
    }
}

/**
 * Extracts the jme module out of the full old path
 * @param {The relative path to the spotbugs file of previous runs} path
 */
function extractModuleNameOldPath(path) {
    if (path.startsWith(relativePath + oldSpotbugsPath + "/") && path.endsWith(".xml")) {
        return path.substring((relativePath + oldSpotbugsPath + "/").length, path.indexOf(".xml"));
    } else {
        throw Error("Not a valid path");
    }
}

async function generateReportsAndAnalyse() {
    await gradlew("spotbugsMain -Pxml-reports=true --continue").then(out => console.log(out.stdout)).catch(err => { console.error(err) });

    let reports = {};

    const files = await glob(relativePath + '**/' + spotbugsPath);

    await Promise.all(files.map(async file =>
        {
            try {
                const result = await xml2js.parseStringPromise(await readFileAsync(file) /*, options */);
                const moduleName = extractModuleName(file);

                if (result.BugCollection.BugInstance) {
                    reports[moduleName] = result.BugCollection.BugInstance;
                } else {
                    console.log("Great Work! " + moduleName + " doesn't contain any bugs!");
                }
            } catch (err) {
                console.error(err);
            }
        })
    );

    return reports;
}

function format(obj) {
    // @TODO: Add Method/Field and SourceLine
    return obj.$.type + " => " + obj.Class[0].$.classname;
}

async function loadOldReports() {
    let reports = {};

    const files = await glob(relativePath + oldSpotbugsPath + "/*.xml");

    await Promise.all(files.map(async file =>
        {
            try {
                const result = await xml2js.parseStringPromise(await readFileAsync(file) /*, options */);
                const moduleName = extractModuleNameOldPath(file);

                if (result.BugCollection.BugInstance) {
                    reports[moduleName] = result.BugCollection.BugInstance;
                } else {
                    console.log(moduleName + " didn't contain any bugs!");
                }
            } catch(err) {
                console.error(err);
            }
        })
    );

    return reports;
}


(async () => {
    reports_new = await generateReportsAndAnalyse();
    reports_old = await loadOldReports();

    const token = process.env.GITHUB_TOKEN;
    const octokit = new github.GitHub(token);
    console.log(github.context);

    for (let [key, value] of Object.entries(reports_new)) {
        if (reports_old[key]) {
            console.error("Now analyzing additional bugs for " + key);
            value.forEach(error => {
                if (!reports_old[key].some(oldError => comparator(error, oldError))) {
                    //console.error("Warning: Found new bug " + util.inspect(error, false, null));
                    console.error("Warning: Found new bug " + format(error));
                }
            });
        } else {
            console.error("Warning: Previously bugless module " + key +  " now has bugs!");
            value.forEach(error => {
                //console.error("Warning: Found new bug " + format(error));
                //console.error("Warning: Found new bug " + util.inspect(error, false, null));
            });
        }
    }

    for (let [key, value] of Object.entries(reports_old)) {
        if (reports_new[key]) {
            console.error("Now analyzing solved bugs for " + key);
            value.forEach(error => {
                if (!reports_new[key].some(newError => comparator(error, newError))) {
                    console.error("Congratulations! Solved bug " + format(error));
                }
            });
        } else {
            console.error("Congratulations! The module " + key + " has become bugless!");
            value.forEach(error => {
                console.error("Congratulations! Solved bug " + foremat(error));
            });
        }
    }
})();