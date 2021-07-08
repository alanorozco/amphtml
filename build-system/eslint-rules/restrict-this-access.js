/**
 * Copyright 2021 The AMP HTML Authors. All Rights Reserved.
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
'use strict';

/**
 * Restricts use of `this` to a subset of properties when an instance is a
 * of a specific class type, or a subclass of it.
 * See `classNames` of instances and `allowed` properties in plugin's config.
 * @param {import('eslint').Rule.RuleContext} context
 * @return {import('eslint').Rule.RuleListener}
 */
function create(context) {
  const {options = []} = context;
  const [firstOptions = {}] = options;
  const {allowed = [], classNames = []} = firstOptions;

  const used = new Map();

  const matchingClassSelector = `:matches(${classNames
    .flatMap((className) => [
      `ClassDeclaration[id.name=${className}]`,
      `ClassExpression[id.name=${className}]`,
      `ClassDeclaration[superClass.name=${className}]`,
      `ClassExpression[superClass.name=${className}]`,
    ])
    .join(',')})`;

  const thisSelector = `${matchingClassSelector} ThisExpression`;
  const memberSelector = `${matchingClassSelector} MemberExpression[object.type=ThisExpression]`;
  const destructureSelector = `${matchingClassSelector} VariableDeclarator[init.type=ThisExpression]`;

  class NoPushArray extends Array {
    /** */
    push() {}
  }

  const seen = new WeakSet();
  const sourceCode = context.getSourceCode();

  return {
    'Program:exit': function () {
      for (const nodes of used.values()) {
        for (const node of nodes) {
          const source = sourceCode.getText(node);
          context.report({
            node,
            message: [
              `Referenced non-allowed property on \`this\`: \`${source}\`.`,
              'To limit access to restricted properties, each property name must be specifically allowed.',
            ].join('\n\t'),
          });
        }
      }
    },

    [matchingClassSelector]: function (node) {
      node.body.body.forEach((prop) => {
        if (prop.computed) {
          return;
        }

        const {key} = prop;
        if (key.type !== 'Identifier') {
          context.report({
            node: key,
            message: 'unknown key prop key type',
          });
          return;
        }

        used.set(key.name, new NoPushArray());
      });
    },

    [thisSelector](node) {
      if (seen.has(node)) {
        return;
      }

      const ancestors = context.getAncestors().slice().reverse();
      const klass = ancestors.find((a) => a.type.startsWith('Class'));
      if (!klass) {
        return;
      }

      context.report({
        node,
        message: [
          'Non-property access to `this` is banned.',
          'To limit access to restricted properties, each property name must be specifically allowed.',
        ].join('\n\t'),
      });
    },

    [memberSelector](node) {
      seen.add(node.object);

      const {parent, property} = node;

      // Optional users are ok
      if (parent.optional) {
        return;
      }

      const name =
        property.type === 'Identifier'
          ? property.name
          : property.type === 'Literal'
          ? property.value
          : null;

      if (!name) {
        context.report({
          node: property,
          message: 'unknown property type',
        });
      }

      if (allowed.includes(name)) {
        return;
      }

      if (parent.type === 'AssignmentExpression' && parent.left === node) {
        used.set(name, new NoPushArray());
        return;
      }

      if (used.has(name)) {
        used.get(name).push(node);
      } else {
        used.set(name, [node]);
      }
    },

    [destructureSelector](node) {
      const {id} = node;
      if (id.type !== 'ObjectPattern') {
        return;
      }

      seen.add(node.init);

      id.properties.forEach((property) => {
        const {key} = property;
        if (key.type !== 'Identifier') {
          context.report({
            node: key,
            message: 'unknown property type',
          });
          return;
        }

        const {name} = key;
        if (allowed.includes(name)) {
          return;
        }

        if (used.has(name)) {
          used.get(name).push(node);
        } else {
          used.set(name, [node]);
        }
      });
    },
  };
}

module.exports = {
  meta: {
    schema: [
      {
        type: 'object',
        properties: {
          classNames: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          allowed: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create,
};
