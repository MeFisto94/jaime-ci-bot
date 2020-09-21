const { default: PQueue } = require('p-queue');
const { exec } = require('child-process-promise');
const { cwd } = require('process');
const tmp = require('tmp-promise');
const spotbugsCheck = require('./checks/spotbugsCheck.js');
const settings = require('./settings.js');
const { gradlew } = require('./util.js');

async function doAnalysis(context, checkRun) {
  if (checkRun) {
    context.github.checks.update({
      check_run_id: checkRun.data.id,
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      // conclusion: success ? 'success' : 'failure',
      output: {
        title: 'Analysis in progress',
        summary: 'Your analysis is currently in progress, just stand by!',
      },
    }).catch((err) => console.error(err));
  }

  context.log('Checking out the Pull-Request: ');
  tmp.dir({ unsafeCleanup: true, prefix: 'jme-ci' })
    .then(async (dir) => {
      await exec(
        `git clone ${context.payload.repository.html_url} .`,
        {
          cwd: dir.path,
          shell: true,
        },
      );
      context.log('Clone successful');
      await exec(
        `git pull origin pull/${context.payload.check_suite.pull_requests[0].number}/head`,
        {
          cwd: dir.path,
          shell: true,
        },
      );
      context.log(`Successfully checked out to ${dir.path}`);

      // for dev, use cwd()
      if (!await settings.loadConfig(dir.path)) {
        context.log('Error when loading the config. Skipping!');
        dir.cleanup();
        return;
      }

      // @TODO: does it make sense to assemble? Some analysis tasks might depend on that anyway
      await gradlew('assemble', dir.path);
      context.log('Sucessfully built');

      await spotbugsCheck.performOnClone(context, dir.path);

      if (checkRun) {
        context.github.checks.update({
          check_run_id: checkRun.data.id,
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          conclusion: 'success',
          status: 'completed',
          output: {
            title: 'Analysis complete',
            summary: 'Your analysis is now finished!',
          },
        }).catch((err) => console.error(err));
      }

      // Sleep 5 seconds for git to cooldown (we have file lock problems otherwise)
      await new Promise((r) => setTimeout(r, 5000));

      dir.cleanup();
      context.log('Successfully deleted');
    });
}

async function check(queue, context) {
  // The Problem is, the path might change based on the actual event
  // @TODO: Extract Pull Request object
  const pullRequest = context.payload.check_suite.pull_requests !== undefined
                    || context.payload.check_run.pull_requests !== undefined;

  if (pullRequest) {
    const { /* before, */after } = context.payload.check_suite;
    /* we could use the above before, if we were only to analyze the diff,
     * but most analysis is done on the whole code base after applying the Commit
     * thus we currently ignore the before of the check run
     */

    const compare = await context.github.repos.compareCommits(
      context.repo({
        // base: before,
        base: context.payload.check_suite.pull_requests[0].base.sha,
        head: after,
      }),
    );

    // We don't care if it's add, change or remove, all are potentially dangerous
    const forbiddenFile = compare.data.files.find(
      (file) => file.filename.startsWith('.github')
        || file.filename.startsWith('gradle')
        || file.filename.endsWith('.gradle'),
    );

    if (forbiddenFile !== undefined) {
      context.log('Analysis stopped because this is a PR, but a critical build file has been '
      + 'modified');
      context.github.issues.createComment({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        issue_number: context.payload.check_suite.pull_requests[0].number,
        body: `The commit ${after} won't be analyzed, because it modified ${forbiddenFile}`,
      });
      return;
    }

    let checkRun;
    if (queue.pending > 0) {
      checkRun = await context.github.checks.create(context.repo({
        // owner: context.payload.repository.owner.login,
        // repo: context.payload.repository.name,
        name: 'CI Analysis',
        head_sha: context.payload.check_suite.head_sha,
        status: 'queued',
        output: {
          title: 'Waiting for a free slot',
          summary: "This task has been queued and will be executed once you've been assigned an "
          + 'empty slot',
        },
      })); // await in case the queue would be faster than the Github API
    }

    queue.add(() => doAnalysis(context, checkRun));
  }
}

module.exports = (app) => {
  // Usually nCPU - 1, but we also constrain disk space and IO by this.
  const queue = new PQueue({ concurrency: 2 });

  /* , 'check_run.rerequested' */
  app.on(['check_suite.requested', 'check_suite.rerequested'],
    async (context) => {
      await check(queue, context);
    });
};
