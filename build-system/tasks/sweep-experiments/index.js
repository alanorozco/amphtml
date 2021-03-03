/**
 * Copyright 2020 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const argv = require('minimist')(process.argv.slice(2));
const fastGlob = require('fast-glob');
const path = require('path');
const tempy = require('tempy');
const {cyan, magenta, yellow} = require('kleur/colors');
const {getOutput} = require('../../common/process');
const {jscodeshift} = require('../../test-configs/jscodeshift');
const {log} = require('../../common/logging');
const {readJsonSync, writeFileSync} = require('fs-extra');

const containRuntimeSource = ['3p', 'ads', 'extensions', 'src', 'test'];
const containExampleHtml = ['examples', 'test'];

const experimentsConfigPath = 'tools/experiments/experiments-config.js';
const prodConfigPath = 'build-system/global-configs/prod-config.json';
const canaryConfigPath = 'build-system/global-configs/canary-config.json';

const globalWritablePaths = [
  experimentsConfigPath,
  prodConfigPath,
  canaryConfigPath,
];

/**
 * Ignores experiments that cannot be removed automatically.
 * @param {string} id
 * @return {boolean}
 */
const isSpecialCannotBeRemoved = (id) =>
  // These are passed through to a third-party, so we can't determine whether
  // they're still in use by looking at this repo alone.
  // See https://git.io/JIBeB (amp-subscriptions-google.js)
  id.startsWith('swg-');

/**
 * @param {string} cmd
 * @param {string=} cwdForTesting
 * @return {?string}
 */
function getStdoutThrowOnError(cmd, cwdForTesting = '.') {
  const {stdout, stderr} = getOutput(cmd, {cwd: cwdForTesting});
  if (!stdout && stderr) {
    throw new Error(`${cmd}\n\n${stderr}`);
  }
  return stdout && stdout.trim();
}

/**
 * @param {string} cmd
 * @param {string=} cwdForTesting
 * @return {Array<string>}
 */
function getStdoutLines(cmd, cwdForTesting = '.') {
  const stdout = getStdoutThrowOnError(cmd, cwdForTesting);
  return !stdout ? [] : stdout.split('\n');
}

/**
 * @param {string} str
 * @return {string}
 */
const cmdEscape = (str) => str.replace(/["`]/g, (c) => `\\${c}`);

/**
 * @param {!Array<string>} glob
 * @param {string} string
 * @param {string=} cwdForTesting
 * @return {!Array<string>}
 */
const filesContainingPattern = (glob, string, cwdForTesting = '.') =>
  getStdoutLines(
    `grep -El "${cmdEscape(string)}" {${fastGlob
      .sync(glob, {cwd: cwdForTesting})
      .join(',')}}`,
    cwdForTesting
  );

/**
 * @param {string} fromHash
 * @return {!Array<string>}
 */
const getModifiedSourceFiles = (fromHash) =>
  getStdoutLines(`git diff --name-only ${fromHash}..HEAD | grep .js`).filter(
    (file) => !globalWritablePaths.includes(file)
  );

/**
 * @param {string} id
 * @param {string} experimentsRemovedJson
 * @param {string=} experimentsConfigPathForTesting
 * @return {Array<string>} modified files
 */
function removeFromExperimentsConfig(
  id,
  experimentsRemovedJson,
  experimentsConfigPathForTesting = experimentsConfigPath
) {
  jscodeshift([
    `--transform ${__dirname}/jscodeshift/remove-experiment-config.js`,
    `--experimentId=${id}`,
    `--experimentsRemovedJson=${experimentsRemovedJson}`,
    experimentsConfigPathForTesting,
  ]);
  return [experimentsConfigPathForTesting];
}

/**
 * @param {!Object<string, *>} config
 * @param {string} path
 * @param {string} id
 * @return {Array<string>} modified files
 */
function removeFromJsonConfig(config, path, id) {
  delete config[id];

  for (const allowOptInKey of ['allow-doc-opt-in', 'allow-url-opt-in']) {
    const index = config[allowOptInKey].indexOf(id);
    if (index > -1) {
      config[allowOptInKey].splice(index, 1);
    }
  }

  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  return [path];
}

/**
 * @param {string} id
 * @param {number} percentage
 * @param {Array<string>=} dirsForTesting
 * @return {Array<string>} modified files
 */
function removeFromRuntimeSource(
  id,
  percentage,
  dirsForTesting = containRuntimeSource
) {
  const possiblyModifiedSourceFiles = filesContainingPattern(
    dirsForTesting.map((dir) => `${dir}/**/*.js`),
    id
  );
  if (possiblyModifiedSourceFiles.length > 0) {
    jscodeshift([
      `--transform ${__dirname}/jscodeshift/remove-experiment-runtime.js`,
      `--isExperimentOnLaunched=${percentage}`,
      `--isExperimentOnExperiment=${id}`,
      ...possiblyModifiedSourceFiles,
    ]);
  }
  return possiblyModifiedSourceFiles;
}

/**
 * @param {string} id
 * @param {*} workItem
 * @param {!Array<string>} modified
 * @param {string=} cwdForTesting
 * @return {Array<string>}
 */
function gitCommitSingleExperiment(
  id,
  workItem,
  modified,
  cwdForTesting = '.'
) {
  const messageParagraphs = [readableRemovalId(id, workItem)];
  if (workItem.previousHistory.length > 0) {
    messageParagraphs.push(
      `Previous history on ${prodConfigPath.split('/').pop()}:`,
      workItem.previousHistory
        .map(
          ({hash, authorDate, subject}) =>
            `- ${hash} - ${authorDate} - ${subject}`
        )
        .join('\n')
    );
  }
  return getStdoutLines(
    `git add ${modified.join(' ')} && ` +
      `git commit -m "${cmdEscape(messageParagraphs.join('\n\n'))}"`,
    cwdForTesting
  );
}

/**
 * @param {string} id
 * @param {{percentage: number, previousHistory: Array}} workItem
 * @return {string}
 */
function readableRemovalId(id, {percentage, previousHistory}) {
  const lastCommit = previousHistory[0];
  const prefix = lastCommit
    ? `(${truncateYyyyMmDd(lastCommit.authorDate)}, ${lastCommit.hash})`
    : 'Remove';
  return `${prefix} \`${id}\`: ${percentage}`;
}

/**
 * @param {number=} daysAgo
 * @return {!Date} "Rounded up" to the following day at 00:00:00
 */
function dateDaysAgo(daysAgo = 365) {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - daysAgo - 1);
  pastDate.setHours(0);
  pastDate.setMinutes(0);
  pastDate.setSeconds(0);
  return pastDate;
}

/**
 * @param {string} formattedDate
 * @return {string}
 */
const truncateYyyyMmDd = (formattedDate) =>
  formattedDate.substr(0, 'YYYY-MM-DD'.length);

/**
 * @param {string} cutoffDateFormatted
 * @param {string} configJsonPath
 * @param {string} experiment
 * @param {number} percentage
 * @param {string=} cwdForTesting
 * @return {Array<{hash: string, authorDate: string, subject: string}>}
 */
const findConfigBitCommits = (
  cutoffDateFormatted,
  configJsonPath,
  experiment,
  percentage,
  cwdForTesting = '.'
) => {
  throw new Error(
    [
      'git log',
      `--until=${cutoffDateFormatted}`,
      // Look for entries that contain exact percentage string, like:
      // "my-launched-experiment": 1
      `-S '"${experiment}": ${percentage},'`,
      // %h: hash
      // %aI: authorDate
      // %s: subject
      ' --format="%h %aI %s"',
      configJsonPath,
    ].join(' ')
  );
  return getStdoutLines(
    [
      'git log',
      `--until=${cutoffDateFormatted}`,
      // Look for entries that contain exact percentage string, like:
      // "my-launched-experiment": 1
      `-S '"${experiment}": ${percentage},'`,
      // %h: hash
      // %aI: authorDate
      // %s: subject
      ' --format="%h %aI %s"',
      configJsonPath,
    ].join(' '),
    cwdForTesting
  ).map((line) => {
    const tokens = line.split(' ');
    // PR numbers in subject lines create spammy references when committed,
    // remove them early on.
    if (/^\(#[0-9]+\)$/.test(tokens[tokens.length - 1])) {
      tokens.pop();
    }
    return {
      hash: tokens.shift(),
      authorDate: tokens.shift(),
      subject: tokens.join(' '),
    };
  });
};

const issueUrlToNumberRe = new RegExp(
  [
    '^https://github.com/ampproject/amphtml/issues/(\\d+)',
    '^https://github.com/ampproject/amphtml/pull/(\\d+)',
    '^https://go.amp.dev/issue/(\\d+)',
    '^https://go.amp.dev/pr/(\\d+)',
    '^#?(\\d+)$',
  ].join('|')
);

/**
 * @param {string} url
 * @return {string}
 */
function issueUrlToNumberOrUrl(url) {
  const match = url.match(issueUrlToNumberRe);
  const number = match && match.find((group) => /^\d+$/.test(group));
  return number ? `#${number}` : url;
}

/**
 * @param {string} list
 * @return {string}
 */
const checklistMarkdown = (list) =>
  list.map((item) => `- [ ] ${item}`).join('\n');

/**
 * @return {string}
 */
const readmeMdGithubLink = () =>
  `https://github.com/ampproject/amphtml/blob/master/${path.relative(
    process.cwd(),
    __dirname
  )}/README.md`;

/**
 * @param {{
 *   removed: string,
 *   cleanupIssues: Array<Object>,
 *   cutoffDateFormatted: string,
 *   modifiedSourceFiles: Array<string>,
 *   htmlFilesWithReferences: Array<string>,
 * }} vars
 * @return {string}
 */
function summaryCommitMessage({
  removed,
  cleanupIssues,
  cutoffDateFormatted,
  modifiedSourceFiles,
  htmlFilesWithReferences,
}) {
  const paragraphs = [
    `🚮 Sweep experiments older than ${cutoffDateFormatted}`,
    `Sweep experiments last flipped globally up to ${cutoffDateFormatted}:`,
    removed.join('\n'),
  ];

  if (cleanupIssues.length > 0) {
    paragraphs.push(
      '---',
      '### Cleanup issues',
      "Close these once they've been addressed and this PR has been merged:",
      checklistMarkdown(
        cleanupIssues.map(
          ({id, cleanupIssue}) =>
            `\`${id}\`: ${issueUrlToNumberOrUrl(cleanupIssue)}`
        )
      )
    );
  }

  if (modifiedSourceFiles.length > 0) {
    paragraphs.push(
      '---',
      '### ⚠️ Javascript source files require intervention',
      'The following may contain errors and/or require intervention to remove superfluous conditionals:',
      checklistMarkdown(modifiedSourceFiles.map((file) => `\`${file}\``)),
      `Refer to the removal guide for [suggestions on handling these modified Javascript files.](${readmeMdGithubLink()}#followup)`
    );
  }

  if (htmlFilesWithReferences.length > 0) {
    paragraphs.push(
      '---',
      '### ⚠️ HTML files may still contain references',
      'The following HTML files contain references to experiment names which may be stale and should be manually removed:',
      checklistMarkdown(htmlFilesWithReferences.map((file) => `\`${file}\``)),
      `Refer to the removal guide for [suggestions on handling these HTML files.](${readmeMdGithubLink()}#followup:html)`
    );
  }

  return paragraphs.join('\n\n');
}

/**
 * @param {!Object<string, *>} prodConfig
 * @param {!Object<string, *>} canaryConfig
 * @param {string} cutoffDateFormatted
 * @param {string=} removeExperiment
 * @param {string=} cwdForTesting
 * @return {!{
 *   include: Object<string, {percentage: number, previousHistory: Array}>,
 *   exclude: Object<string, {percentage: number, previousHistory: Array}>
 * }}
 */
function collectWork(
  prodConfig,
  canaryConfig,
  cutoffDateFormatted,
  removeExperiment,
  cwdForTesting = '.'
) {
  const localProdConfigPath = `${cwdForTesting}/${prodConfigPath}`;
  if (removeExperiment) {
    // 0 if not on prodConfig
    const percentage = prodConfig[removeExperiment]
      ? Number(prodConfig[removeExperiment])
      : 0;
    const previousHistory = findConfigBitCommits(
      cutoffDateFormatted,
      localProdConfigPath,
      removeExperiment,
      percentage,
      cwdForTesting
    );
    const entries = {[removeExperiment]: {percentage, previousHistory}};
    return isSpecialCannotBeRemoved(removeExperiment)
      ? {exclude: entries}
      : {include: entries};
  }

  const include = {};
  const exclude = {};
  for (const [experiment, percentage] of Object.entries(prodConfig)) {
    if (
      typeof percentage === 'number' &&
      percentage === canaryConfig[experiment] &&
      experiment !== 'canary' &&
      (percentage >= 1 || percentage <= 0)
    ) {
      const previousHistory = findConfigBitCommits(
        cutoffDateFormatted,
        localProdConfigPath,
        experiment,
        percentage,
        cwdForTesting
      );
      throw new Error(JSON.stringify(previousHistory));
      if (previousHistory.length > 0) {
        const entries = isSpecialCannotBeRemoved(experiment)
          ? exclude
          : include;
        entries[experiment] = {percentage, previousHistory};
      }
    }
  }
  return {include, exclude};
}

async function sweepExperimentsForTesting(
  argvForTesting = argv,
  cwdForTesting = '.'
) {
  const headHash = getStdoutThrowOnError(
    'git log -1 --format=%h',
    cwdForTesting
  );

  const prodConfig = readJsonSync(`${cwdForTesting}/${prodConfigPath}`);
  const canaryConfig = readJsonSync(`${cwdForTesting}/${canaryConfigPath}`);

  const cutoffDateFormatted = dateDaysAgo(
    argv.experiment
      ? 0
      : argvForTesting.days_ago == null
      ? 365
      : argvForTesting.days_ago
  ).toISOString();

  const {exclude, include} = collectWork(
    prodConfig,
    canaryConfig,
    cutoffDateFormatted,
    argv.experiment,
    cwdForTesting
  );

  throw new Error(JSON.stringify({include}));

  if (exclude && Object.keys(exclude).length > 0) {
    log(yellow('The following experiments are excluded as they are special:'));
    for (const experiment in exclude) {
      log(readableRemovalId(experiment, exclude[experiment]));
    }
  }

  const total = include ? Object.keys(include).length : 0;
  if (total === 0) {
    log(cyan('No experiments to remove.'));
    log(`Cutoff at ${cutoffDateFormatted}`);
    return;
  }

  log(cyan('Removing references to the following experiments:'));
  for (const experiment in include) {
    log(readableRemovalId(experiment, include[experiment]));
  }

  if (argv.dry_run) {
    log('❗️ (Not making changes due to --dry_run)');
    return;
  }

  const removed = [];

  const removedFromExperimentsConfigJson = tempy.file();

  Object.entries(include).forEach(([id, workItem], i) => {
    log(`🚮 ${i + 1}/${total}`, magenta(`${id}...`));

    const modified = [
      ...removeFromExperimentsConfig(id, removedFromExperimentsConfigJson),
      ...removeFromJsonConfig(prodConfig, prodConfigPath, id),
      ...removeFromJsonConfig(canaryConfig, canaryConfigPath, id),
      ...removeFromRuntimeSource(
        id,
        workItem.percentage,
        containRuntimeSource.map((dir) => `${cwdForTesting}/${dir}`)
      ),
    ];

    getStdoutThrowOnError(`npx prettier.js --write ${modified.join(' ')}`, {
      cwd: cwdForTesting,
    });

    for (const line of gitCommitSingleExperiment(
      id,
      workItem,
      modified,
      cwdForTesting
    )) {
      log(line);
    }

    log();

    removed.push(`- ${readableRemovalId(id, workItem)}`);
  });

  if (removed.length > 0) {
    const removedFromExperimentsConfig =
      readJsonSync(removedFromExperimentsConfigJson, {throws: false}) || [];

    const cleanupIssues = removedFromExperimentsConfig.filter(
      ({cleanupIssue}) => !!cleanupIssue
    );

    const modifiedSourceFiles = getModifiedSourceFiles(headHash);

    const htmlFilesWithReferences = filesContainingPattern(
      containExampleHtml.map((dir) => `${dir}/**/*.html`),
      `['"](${Object.keys(include).join('|')})['"]`,
      cwdForTesting
    );

    log(
      getStdoutThrowOnError(
        `git commit --allow-empty -m "${cmdEscape(
          summaryCommitMessage({
            removed,
            cleanupIssues,
            modifiedSourceFiles,
            htmlFilesWithReferences,
            cutoffDateFormatted: truncateYyyyMmDd(cutoffDateFormatted),
          })
        )}"`,
        {cwd: cwdForTesting}
      ),
      '\n\n',
      getStdoutThrowOnError('git log -1 --format=%b', {cwd: cwdForTesting}),
      `\n\n`
    );

    const reportHash = getStdoutThrowOnError('git log -1 --format=%h', {
      cwd: cwdForTesting,
    });
    log(cyan('You may recover the above report at any point:'));
    log(`git log ${reportHash}`);
  }
}

/**
 * Entry point to gulp sweep-experiments.
 * See README.md for usage.
 * @return {!Promise}
 */
function sweepExperiments() {
  return sweepExperimentsForTesting(argv.days_ago);
}

module.exports = {
  sweepExperiments,
  sweepExperimentsForTesting,
  removeFromExperimentsConfig,
  removeFromJsonConfig,
  removeFromRuntimeSource,
  gitCommitSingleExperiment,
  findConfigBitCommits,
  collectWork,
};

sweepExperiments.description =
  'Sweep experiments whose configuration is too old, or specified with --experiment.';

sweepExperiments.flags = {
  'days_ago':
    '  How old experiment configuration flips must be for an experiment to be removed. Default is 365 days. This is ignored when using --experiment.',
  'dry_run':
    "  Don't write, but only list the experiments that would be removed by this command.",
  'experiment': '  Remove a specific experiment id.',
};
