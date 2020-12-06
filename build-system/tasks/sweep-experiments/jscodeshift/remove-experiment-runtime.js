/**
 * Copyright 2020 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {red} from 'ansi-colors';

/**
 * @param {*} file
 * @param {*} api
 * @param {*} options
 * @return {*}
 */
export default function transformer(file, api, options) {
  const j = api.jscodeshift;

  const missingOptions = [
    'isExperimentOnExperiment',
    'isExperimentOnLaunched',
  ].filter((option) => options[option] == null);

  if (missingOptions.length > 0) {
    throw new Error(
      `Missing options for ${options.transform}\n` +
        red(JSON.stringify(missingOptions))
    );
  }

  const {isExperimentOnExperiment, isExperimentOnLaunched} = options;

  return j(file.source)
    .find(
      j.CallExpression,
      (node) =>
        node.callee.type === 'Identifier' &&
        (node.callee.name === 'isExperimentOn' ||
          node.callee.name === 'toggleExperiment') &&
        node.arguments[1].type === 'Literal' &&
        node.arguments[1].value === isExperimentOnExperiment
    )
    .forEach((path) => {
      const {name} = path.node.callee;

      // remove unused imports
      j(path)
        .closest(j.Program)
        .find(
          j.ImportSpecifier,
          (node) => node.imported && node.imported.name === name
        )
        .closest(j.ImportDeclaration)
        .forEach((path) => {
          if (
            j(path.scope.node)
              .find(
                j.CallExpression,
                (node) => node.callee && node.callee.name === name
              )
              .size() > 1
          ) {
            return;
          }
          if (path.node.specifiers.length === 1) {
            j(path).remove();
          } else {
            path.node.specifiers = path.node.specifiers.filter(
              (node) => node.imported && node.imported.name !== name
            );
          }
        });

      // remove or replace call
      if (name === 'isExperimentOn') {
        const booleanLiteral = j.booleanLiteral(!!isExperimentOnLaunched);
        booleanLiteral.comments = [
          j.commentBlock(
            ` experiment: ${isExperimentOnExperiment} `,
            /* leading */ true,
            /* trailing */ false
          ),
        ];
        j(path).replaceWith(booleanLiteral);
      } else {
        j(path).remove();
      }
    })
    .toSource();
}
