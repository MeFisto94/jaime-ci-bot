const glob = require('glob-promise');
const xml2js = require('xml2js');
const fs = require('fs');
const util = require('util');
const path = require('path');

const readFileAsync = util.promisify(fs.readFile);

const comparators = require('./findbugs/comparators.js');
const pathUtil = require('./findbugs/path_util.js');
const settings = require('../settings.js');
const { gradlew } = require('../util.js');

const comparator = comparators.classAndSignatureComparator;

async function generateReportsAndAnalyse(basePath) {
  await gradlew(settings.config.spotbugs.gradleCommandLine, basePath)
    .then((out) => { console.log(out.stdout); console.log(out.stderr); })
    .catch((err) => { console.error(err); });

  const reports = {};
  const files = await glob(`**/${settings.config.spotbugs.resultPath}`, { cwd: basePath });

  await Promise.all(files.map(async (file) => {
    try {
      const res = await xml2js.parseStringPromise(await readFileAsync(path.join(basePath, file)));
      const moduleName = pathUtil.extractModuleName(file);

      if (res.BugCollection.BugInstance) {
        reports[moduleName] = res.BugCollection.BugInstance;
      } else {
        console.log(`Great Work! ${moduleName} doesn't contain any bugs!`);
      }
    } catch (err) {
      console.error(`Error in generateReportsAndAnalyse: ${err}`);
    }
  }));

  return reports;
}

function format(obj) {
  // @TODO: Add Method/Field and SourceLine
  return `${obj.$.type} => ${obj.Class[0].$.classname}`;
}

async function loadOldReports(basePath) {
  const reports = {};
  const files = await glob(`${settings.config.spotbugs.expectationsPath}/*.xml`, { cwd: basePath });

  await Promise.all(files.map(async (file) => {
    try {
      const result = await xml2js.parseStringPromise(await readFileAsync(file));
      const moduleName = pathUtil.extractModuleNameExpectationsPath(file);

      if (result.BugCollection.BugInstance) {
        reports[moduleName] = result.BugCollection.BugInstance;
      } else {
        console.log(`${moduleName} didn't contain any bugs!`);
      }
    } catch (err) {
      console.error(`Error in loadOldReports: ${err}`);
    }
  }));

  return reports;
}

function createAnnotations(newBugs, solvedBugs) {
  const res = [];

  newBugs.forEach((bug) => {
    let src;

    if (bug.bug.SourceLine) {
      src = bug.bug.SourceLine;
    } else if (bug.bug.Method) {
      src = bug.bug.Method[0].SourceLine;
    } else if (bug.bug.Field) {
      src = bug.bug.Field[0].SourceLine;
    } else if (bug.bug.Class) {
      src = bug.bug.Class[0].SourceLine;
    }

    if (src) {
      src.forEach((line) => {
        // In case the lines are undefined, assign them to the top of the class.
        let lineStart = 1;
        let lineEnd = 1;
        if (line.$.start !== undefined) {
          lineStart = line.$.start;
        }
        if (line.$.end !== undefined) {
          lineEnd = line.$.end;
        }

        res.push({
          path: bug.module + settings.config.relativeModulePath + line.$.sourcepath,
          start_line: lineStart,
          end_line: lineEnd,
          annotation_level: bug.bug.priority === '1' ? 'failure' : 'warning',
          message: `${settings.config.spotbugs.checks.report.new_bug}\nCategory: ${bug.bug.$.category}\nType: ${bug.bug.$.type}`,
        });
      });
    } else {
      // Github requires it's Annotations to have a line, the alternative would
      // be to use line number 0
      console.error('Warning: Found a bug without a SourceLine Attribute!!');
      console.dir(bug.bug);
    }
  });

  solvedBugs.forEach((bug) => {
    let src;

    if (bug.bug.SourceLine) {
      src = bug.bug.SourceLine;
    } else if (bug.bug.Method) {
      src = bug.bug.Method[0].SourceLine;
    } else if (bug.bug.Field) {
      src = bug.bug.Field[0].SourceLine;
    } else if (bug.bug.Class) {
      src = bug.bug.Class[0].SourceLine;
    }

    if (src) {
      src.forEach((line) => {
        // In case the lines are undefined, assign them to the top of the class.
        let lineStart = 1;
        let lineEnd = 1;
        if (line.$.start !== undefined) {
          lineStart = line.$.start;
        }
        if (line.$.end !== undefined) {
          lineEnd = line.$.end;
        }

        res.push({
          path: bug.module + settings.config.relativeModulePath + line.$.sourcepath,
          start_line: lineStart,
          end_line: lineEnd,
          annotation_level: 'notice',
          message: `🎉 This bug has been solved! 🎊\nCategory: ${bug.bug.$.category}\n`
          + `Type: [${bug.bug.$.type}](https://spotbugs.readthedocs.io/en/latest/bugDescriptions.html)`,
        });
      });
    } else {
      // Github requires it's Annotations to have a line, the alternative would
      // be to use line number 0
      console.error('Warning: Found a bug without a SourceLine Attribute!!');
      console.dir(bug.bug);
    }
  });

  return res;
}

async function performOnClone(context, basePath) {
  const checkRun = await context.github.checks.create({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    name: settings.config.spotbugs.checks.task.title,
    head_sha: context.payload.check_suite.head_sha,
    status: 'in_progress',
    output: {
      title: settings.config.spotbugs.checks.report.title,
      summary: settings.config.spotbugs.checks.report.pending,
    },
  });

  const reportsNew = await generateReportsAndAnalyse(basePath);
  const reportsOld = await loadOldReports(basePath);

  const newBugs = [];
  const solvedBugs = [];

  Object.entries(reportsNew).forEach(([key, value]) => {
    if (reportsOld[key]) {
      console.error(`Now analyzing additional bugs for ${key}`);
      value.forEach((error) => {
        if (!reportsOld[key].some((oldError) => comparator(error, oldError))) {
          // console.error("Warning: Found new bug " + util.inspect(error, false, null));
          // console.error("Warning: Found new bug " + format(error));
          newBugs.push({ bug: error, module: key });
        }
      });
    } else {
      console.error(`Warning: Previously bugless module ${key} now has bugs!`);
      value.forEach((error) => {
        newBugs.push({ bug: error, module: key });
        // console.error("Warning: Found new bug " + format(error));
        // console.error("Warning: Found new bug " + util.inspect(error, false, null));
      });
    }
  });

  Object.entries(reportsOld).forEach(([key, value]) => {
    if (reportsNew[key]) {
      console.error(`Now analyzing solved bugs for ${key}`);
      value.forEach((error) => {
        if (!reportsNew[key].some((newError) => comparator(error, newError))) {
          solvedBugs.push({ bug: error, module: key });
          console.error(`Congratulations! Solved bug ${format(error)}`);
        }
      });
    } else {
      console.error(`Congratulations! The module ${key} has become bugless!`);
      value.forEach((error) => {
        solvedBugs.push({ bug: error, module: key });
        console.error(`Congratulations! Solved bug ${format(error)}`);
      });
    }
  });

  const success = newBugs.length > 0;
  const summary = `${settings.config.spotbugs.checks.summary.header}\n`;
  // Since we now have annotations, we don't need a big list of bugs as summary
  // summary += "# New Bugs: " + new_bugs.length + "\n";
  // new_bugs.forEach(bug => summary += ("- " + format(bug.bug) + "\n"));
  // summary += "# Solved old Bugs: " + solved_bugs.length + "\n";
  // solved_bugs.forEach(bug => summary += ("- " + format(bug.bug) + "\n"));
  const errTooLong = '\n[...] and many more!';

  const res = createAnnotations(newBugs, solvedBugs);
  const updates = [];

  while (res.length) {
    updates.push(res.splice(0, 50)); // Only 50 annotations allowed per request
  }

  updates.forEach((annotations) => {
    context.github.checks.update({
      check_run_id: checkRun.data.id,
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      conclusion: success ? 'success' : 'failure',
      output: {
        title: settings.config.spotbugs.checks.report.title,
        summary: `New Bugs: ${newBugs.length}\nFixed Bugs: ${solvedBugs.length}`,
        text: (summary.length < 65535) ? summary
          : (summary.substring(0, 65535 - errTooLong.length) + errTooLong),
        annotations,
      },
    }).catch((err) => console.error(err));
  });
}

module.exports = {
  performOnClone,
};
