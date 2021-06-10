/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
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

const {VERSION} = require('./internal-version');

// TODO(alanorozco): Use real minification
const removeWhitespace = (str) => str.replace(/\s+/g, '');

// If there is a sync JS error during initial load,
// at least try to unhide the body.
// If "AMP" is already an object then that means another runtime has already
// been initialized and the current runtime must exit early. This can occur
// if multiple AMP libraries are included in the html or when both the module
// and nomodule runtimes execute in older browsers such as safari < 11.
exports.mainBinary =
  'var global=self;self.AMP=self.AMP||[];' +
  'try{(function(_){' +
  'if(self.AMP&&!Array.isArray(self.AMP))return;' +
  '\n<%= contents %>})(AMP._=AMP._||{})}catch(e){' +
  'setTimeout(function(){' +
  'var s=document.body.style;' +
  's.opacity=1;' +
  's.visibility="visible";' +
  's.animation="none";' +
  's.WebkitAnimation="none;"},1000);throw e};';

exports.extension = function (name, version, latest, isModule, loadPriority) {
  const payload = extensionPayload(
    name,
    version,
    latest,
    isModule,
    loadPriority
  );
  return `(self.AMP=self.AMP||[]).push(${payload});`;
};

const bentoTemplate = removeWhitespace(`
  (function (p) {
    self.AMP
      ? self.AMP.push(p)
      : document.head.querySelector(
          'script[src$="v0.js"],script[src$="v0.mjs"]'
        )
      ? (self.AMP = [p])
      : p.f({
          registerElement: function (n, b, s) {
            if (s)
              document.head.appendChild(
                document.createElement("style")
              ).textContent = s;
            customElements.define(n, b.CustomElement(b));
          },
        });
  })(__PAYLOAD__);
`);

exports.bento = function (name, version, latest, isModule, loadPriority) {
  const payload = extensionPayload(
    name,
    version,
    latest,
    isModule,
    loadPriority
  );
  return bentoTemplate.replace('__PAYLOAD__', payload);
};

/**
 *
 * @param {string} name
 * @param {string} version
 * @param {string} latest
 * @param {boolean} isModule
 * @param {'high'=} loadPriority
 * @return {string}
 */
function extensionPayload(name, version, latest, isModule, loadPriority) {
  let priority = '';
  if (loadPriority) {
    if (loadPriority != 'high') {
      throw new Error('Unsupported loadPriority: ' + loadPriority);
    }
    priority = 'p:"high",';
  }
  // Use a numeric value instead of boolean. "m" stands for "module"
  const m = isModule ? 1 : 0;
  return (
    `{n:"${name}",ev:"${version}",l:${latest},` +
    `${priority}` +
    `v:"${VERSION}",m:${m},f:(function(AMP,_){\n` +
    '<%= contents %>\n})}'
  );
}

exports.none = '<%= contents %>';
