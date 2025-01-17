/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @oncall react_native
 */

const {publishPackage} = require('../npm-utils');
const {getPackages} = require('../releases/utils/monorepo');
const {PUBLISH_PACKAGES_TAG} = require('./constants');
const {execSync, spawnSync} = require('child_process');
const path = require('path');

const ROOT_LOCATION = path.join(__dirname, '..', '..');
const NPM_CONFIG_OTP = process.env.NPM_CONFIG_OTP;

async function findAndPublishAllBumpedPackages() {
  let commitMessage;

  try {
    commitMessage = execSync('git log -1 --pretty=%B').toString();
  } catch {
    console.error('Failed to read Git commit message, exiting.');
    process.exitCode = 1;
    return;
  }

  if (!commitMessage.includes(PUBLISH_PACKAGES_TAG)) {
    console.log(
      'Current commit does not include #publish-packages-to-npm keyword, skipping.',
    );
    return;
  }

  const tags = getTagsFromCommitMessage(commitMessage);

  console.log('Traversing all packages inside /packages...');

  const packages = await getPackages({
    includeReactNative: false,
  });

  for (const package of Object.values(packages)) {
    const {stdout: diff, stderr: commitDiffStderr} = spawnSync(
      'git',
      [
        'log',
        '-p',
        '--format=""',
        'HEAD~1..HEAD',
        `${package.path}/package.json`,
      ],
      {cwd: ROOT_LOCATION, shell: true, stdio: 'pipe', encoding: 'utf-8'},
    );

    if (commitDiffStderr) {
      console.log(
        `\u274c Failed to get latest committed changes for ${package.name}:`,
      );
      console.log(commitDiffStderr);

      process.exit(1);
    }

    const previousVersionPatternMatches = diff
      .toString()
      .match(/- {2}"version": "([0-9]+.[0-9]+.[0-9]+)"/);

    if (!previousVersionPatternMatches) {
      console.log(`\uD83D\uDD0E No version bump for ${package.name}`);

      return;
    }

    const [, previousVersion] = previousVersionPatternMatches;
    const nextVersion = package.packageJson.version;

    console.log(
      `\uD83D\uDCA1 ${package.name} was updated: ${previousVersion} -> ${nextVersion}`,
    );

    if (!nextVersion.startsWith('0.')) {
      throw new Error(
        `Package version expected to be 0.x.y, but received ${nextVersion}`,
      );
    }

    const result = publishPackage(package.path, {
      tags,
      otp: NPM_CONFIG_OTP,
    });
    if (result.code !== 0) {
      console.log(
        `\u274c Failed to publish version ${nextVersion} of ${package.name}. npm publish exited with code ${result.code}:`,
      );
      console.log(result.stderr);

      process.exit(1);
    } else {
      console.log(
        `\u2705 Successfully published new version of ${package.name}`,
      );
    }
  }
}

function getTagsFromCommitMessage(msg /*: string */) /*: Array<string> */ {
  // ex message we're trying to parse tags out of
  // `_some_message_here_${PUBLISH_PACKAGES_TAG}&tagA&tagB\n`;
  return msg
    .substring(msg.indexOf(PUBLISH_PACKAGES_TAG))
    .trim()
    .split('&')
    .slice(1);
}

if (require.main === module) {
  // eslint-disable-next-line no-void
  void findAndPublishAllBumpedPackages();
}

module.exports = {
  findAndPublishAllBumpedPackages,
  getTagsFromCommitMessage,
};
