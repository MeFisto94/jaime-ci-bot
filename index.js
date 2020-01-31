// Checks API example
// See: https://developer.github.com/v3/checks/ to learn more

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */

//var workerpool = require('workerpool');
const {default: PQueue} = require('p-queue');
const exec = require('child-process-promise').exec;
const fs = require('fs');
const { promisify } = require('util')
const writeFileAsync = promisify(fs.writeFile)
const readFileAsync = promisify(fs.readFile)
const unlinkAsync = promisify(fs.unlink)
const rmdirAsync = promisify(fs.rmdir)
const mkdirAsync = promisify(fs.mkdir)
const path = require("path");
const xpath = require('xpath');
const dom = require('xmldom').DOMParser

async function gradlew(task) {
  return exec("java -cp gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain " + task)
}

module.exports = app => {
  //var queue = new Queue("CI-Tasks");
  //var pool = workerpool.pool({maxWorkers: 2}) // Usually nCPU - 1, but we also constrain disk space and IO by this.
  const queue = new PQueue({concurrency: 2});

  app.on('issues.opened', async (context) => {
    const issueComment = context.issue({ body: 'Thanks for opening this issue!' })
    await context.github.issues.createComment(issueComment)
  })

  app.on(['check_suite.requested', 'check_suite.rerequested', 'check_run.rerequested'], check)

  async function startCodeFormat(context, check_run) {
    if (check_run == undefined) {
      check_run = await context.github.checks.create(context.repo({
        name: 'Code Formatting Task',
        head_branch: context.payload.check_suite.head_branch,
        head_sha: context.payload.check_suite.head_sha,
        status: 'in_progress',
        output: {
          title: 'Formatting',
          summary: 'The output will be ready soon!'
        }
      }))
    } else {
      await context.github.checks.update(context.repo({
        check_run_id: check_run.data.id,
        name: 'Code Formatting Task',
        head_branch: context.payload.check_suite.head_branch,
        head_sha: context.payload.check_suite.head_sha,
        status: 'in_progress',
        output: {
          title: 'Formatting',
          summary: 'The output will be ready soon!'
        }
      }))
    }

    const { before: before, after: after } = context.payload.check_suite
    const compare = await context.github.repos.compareCommits(context.repo({
      base: before,
      head: after
    }))

    let config = context.config('linter.yml')
    exclude = []
    if (config) {
      for (const property in config) {
        if (property === 'exclude') {
          exclude = config[property]
        } else {
          //linterItems[property] = config[property]
        }
      }
    }

    patch_file = ""

    await Promise.all(compare.data.files.filter(file => file.status != "removed").map(async file => {
      if (!exclude.includes(file.filename)) {
        const content = await context.github.repos.getContents(context.repo({
          path: file.filename,
          ref: after
        }))
        const text = Buffer.from(content.data.content, 'base64').toString()
        const filename = file.filename

        await mkdirAsync(path.dirname("a/" + filename), { recursive: true })
        await mkdirAsync(path.dirname("b/" + filename), { recursive: true })

        await writeFileAsync("a/" + filename, text)
        await writeFileAsync("b/" + filename, text)

        fname = path.resolve('b/' + filename).replace(/\\/g, "\\\\"); // Escape "\", because spotlessFiles= is a regex
        // @TODO: Seperate format step to format all at once [less time spent initializeing]
        await gradlew("spotlessApply -PspotlessFiles=" + fname).then(out => console.log(out.stderr)).catch(err => console.error(err))

        // Git is strange here: when no diff happened, exitcode = 0 (thus then -> undefined). If a diff happened, we need to do it in catch().
        log = await exec("git diff --no-index --color=never --minimal -u --exit-code --no-prefix a/" + filename + " b/" + filename).catch(err => err.stdout).then(undefined)
        if (log != undefined) {
          patch_file += log
        }

        checkstyle = await exec("java -Duser.language=en -Duser.country=US -jar checkstyle-8.27-all.jar com.puppycrawl.tools.checkstyle.Main -c google_checks.xml -f xml a/" + filename)
        .then(result => result).catch(err => console.error('ERROR: ', err))

        var doc = new dom().parseFromString(checkstyle.stdout)
        var errors = xpath.select("/checkstyle/file/error", doc) // When doing this for all files at once, ensure name is correct here.

        await rmdirAsync(path.dirname("a/" + filename), { recursive: true })
        await rmdirAsync(path.dirname("b/" + filename), { recursive: true })

        return {file: file, errors: errors.map(error => err = {line: error.getAttribute("line"), column: error.getAttribute("column"), message: error.getAttribute("message")})}

        /*Object.assign(linterItems, {cwd: '', fix: true, filename: file.filename})

        standard.lintText(text, linterItems, (err, results) => {
          if (err) {
            throw new Error(err)
          }
          return Promise.all(results.results.map(result => {
            if (result.output) {
              // Checks that we have a fixed version and the file isn't part of the exclude list
              context.github.repos.updateFile(context.repo({
                path: file.filename,
                message: `Fix lint errors for ${file.filename}`,
                content: Buffer.from(result.output).toString('base64'),
                sha: content.data.sha,
                branch
              }))
            }
          }))
        })*/
      }
    })).then(results => {
      res = []
      check_succeded = patch_file == "" // If no patch, assume success.
      results.forEach(result => {
        result.errors.forEach(error => {
          if (!is_warning(error)) { // Critical
            check_succeded = false;
          }

          res.push({
            path: result.file.filename,
            start_line: error.line,
            end_line: error.line,
            start_column: error.column != "" ? error.column : undefined,
            end_column: error.column != "" ? error.column : undefined,
            annotation_level: is_warning(error) ? "failure" : "warning",
            message: error.message
          })
        })
      })

      var updates = [];
      while (res.length) {
        updates.push(res.splice(0, 50)) // Only 50 annotations allowed per request
      }

      updates.forEach(annotations => {
        context.github.checks.update(context.repo({
          check_run_id: check_run.data.id,
          name: 'Code Formatting Task',
          head_branch: context.payload.check_suite.head_branch,
          head_sha: context.payload.check_suite.head_sha,
          conclusion: check_succeded ? "success" : "failure",
          output: {
            title: check_succeded ? "Formatting-Check successful!" : "File contains Format Errors",
            summary: check_succeded ? "Everything looks well!" :
              ((patch_file != "" ? "Automatically fixable errors have been found.\nA patch has been submitted\n" :
              (annotations.length == 0 ? "" : "Non-Fixable Errors have been found which require manual intervention"))),
            annotations: annotations
          }
        }))
      })
    })

    if (patch_file != "") {
      const issueComment = ({
        owner:context.payload.repository.owner.login,
        repo:context.payload.repository.name,
        issue_number:context.payload.check_suite.pull_requests[0].number,
        body: "This commit contained formatting errors that I could fix.\nI've attached a patch below, just apply it and commit the changes!\n" +
        "Unfortunately I cannot attach it as a file, blame GitHubs API for that!\n" +
        "Please apply and commit this patch first, to see if that gets rid of some inline-comments\n"+
        "```diff\n" +
        patch_file +
        "```"
      })

      // @TODO: patch_file could be part of the check update.
      await context.github.issues.createComment(issueComment)
    }
  }

  function is_warning(error) {
    return false;
  }

  async function check (context) {
    const startTime = new Date()
    // Do stuff
    const { head_branch: headBranch, head_sha: headSha } = context.payload.check_suite
    // Probot API note: context.repo() => {username: 'hiimbex', repo: 'testing-things'}
    /*return context.github.checks.create(context.repo({
      name: 'My app!',
      head_branch: headBranch,
      head_sha: headSha,
      status: 'completed',
      started_at: startTime,
      conclusion: 'success',
      completed_at:new Date(),
      output: {
        title: 'Probot check!',
        summary: 'The check has passed!'
      }
    }))*/
    check_run = undefined
    if (queue.pending > 0) {
      check_run = await context.github.checks.create(context.repo({
        name: 'Code Formatting Task',
        head_branch: headBranch,
        head_sha: headSha,
        status: 'queued',
        output: {
          title: 'Waiting for a free slot',
          summary: "This task has been queued and will be executed once you've been assigned an empty slot"
        }
      })) // await in case the queue would be faster than the Github API
    }

    queue.add(() => startCodeFormat(context, check_run));
  }

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
}
