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

const excludedClassRe = /^base|(interface|element)$/i;

/**
 * @param fileInfo
 * @param api
 */
module.exports = function({source}, {j}) {
  return j(source)
    .find(j.ClassDeclaration, n => !excludedClassRe.test(n.id.name))
    .forEach(n => {
      j(n)
        .find(
          j.MethodDefinition,
          n =>
            n.value.params.length &&
            n.value.body.body.length &&
            !n.static &&
            n.key.name !== 'constructor' &&
            !n.key.name.endsWith('_') &&
            j(n)
              .find(j.ThisExpression)
              .size() == 0
        )
        .forEach(p => {
          p.node.key.name = `${p.node.key.name}CouldBePure`;
        });
    })
    .toSource();
};
