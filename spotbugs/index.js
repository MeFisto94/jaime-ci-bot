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
    const token = process.env.GITHUB_TOKEN;
    const octokit = new github.GitHub(token);

    check_run = await octokit.checks.create({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        name: 'SpotBugs Static Analysis Task',
        head_sha: github.context.sha,
        status: 'in_progress',
        output: {
          title: 'SpotBugs Differential Report',
          summary: "We're analysing your work currently, it better be good!"
        }
    });
    console.log(check_run);

    reports_new = await generateReportsAndAnalyse();
    reports_old = await loadOldReports();

    new_bugs = [];
    solved_bugs = [];

    for (let [key, value] of Object.entries(reports_new)) {
        if (reports_old[key]) {
            console.error("Now analyzing additional bugs for " + key);
            value.forEach(error => {
                if (!reports_old[key].some(oldError => comparator(error, oldError))) {
                    //console.error("Warning: Found new bug " + util.inspect(error, false, null));
                    console.error("Warning: Found new bug " + format(error));
                    new_bugs.push({bug: error, module: key});
                }
            });
        } else {
            console.error("Warning: Previously bugless module " + key +  " now has bugs!");
            value.forEach(error => {
                new_bugs.push({bug: error, module: key});
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
                    solved_bugs.push({bug: error, module: key});
                    console.error("Congratulations! Solved bug " + format(error));
                }
            });
        } else {
            console.error("Congratulations! The module " + key + " has become bugless!");
            value.forEach(error => {
                solved_bugs.push({bug: error, module: key});
                console.error("Congratulations! Solved bug " + format(error));
            });
        }
    }

    success = new_bugs.length > 0;
    summary = "# New Bugs\n";
    new_bugs.forEach(bug => summary += ("- " + format(bug.bug) + "\n"));
    summary += "# Solved old Bugs\n";
    solved_bugs.forEach(bug => summary += ("- " + format(bug.bug) + "\n"));

    err_too_long = "\n[...] and many more!";
    const res = [];

    new_bugs.forEach(bug => {
        bug.bug.SourceLine.forEach(line => {
            res.push({
                path: bug.module + "/" + line.$.sourcePath,
                start_line: line.$.start,
                end_line: line.$.end,
                annotation_level: bug.bug.priority == "1" ? "failure" : "warning",
                message: "A new potential bug 🐛 has been introduced here!\nCategory: " + bug.bug.$.category + "\nType: [" + bug.bug.$.type + "](https://spotbugs.readthedocs.io/en/latest/bugDescriptions.html)"
            });
        });
    });

    solved_bugs.forEach(bug => {
        bug.bug.SourceLine.forEach(line => {
            res.push({
                path: bug.module + "/" + line.$.sourcePath,
                start_line: line.$.start,
                end_line: line.$.end,
                annotation_level: "notice",
                message: "🎉 This bug has been solved! 🎊\nCategory: " + bug.bug.$.category + "\nType: [" + bug.bug.$.type + "](https://spotbugs.readthedocs.io/en/latest/bugDescriptions.html)"
            });
        });
    });

    // we have to fill res with all the file annotations.
    const updates = [];

    while (res.length) {
      updates.push(res.splice(0, 50)) // Only 50 annotations allowed per request
    }

    updates.forEach(annotations => {
        octokit.checks.update({
            check_run_id: check_run.data.id,
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            conclusion: success ? "success" : "failure",
            output: {
                title: 'SpotBugs Differential Report',
                // @TODO: We don't need this anymore when we have annotations
                //(summary.length < 65535) ? summary : (summary.substring(0, 65535 - err_too_long.length) + err_too_long),
                summary: "New Bugs: " + new_bugs.length + "\nFixed Bugs: " + solved_bugs.length,
                text: summary,
                annotations: annotations
            }
        }).catch(err => console.error(err));
    });
})();