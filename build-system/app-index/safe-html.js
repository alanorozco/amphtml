/**
 * Copyright 2019 The AMP HTML Authors. All Rights Reserved.
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


const assert = require('assert');
const {joinFragments} = require('./html');


const innerJsonOpeningRe = /\<script[^>]*>[\s\S]*$/;
const innerJsonClosingRe = /\<\/script\>/;

const unsafeCharsRe = /[&<>"']/g;

const unsafeCharsMapping = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#039;',
};

/** @enum */
const Context = {
  INNER_HTML: 0,
  INNER_JSON: 1,
};


class Safe {
  constructor(renderFnOrStr) {
    const isStr = typeof renderFnOrStr != 'function';
    this.safeStr_ = isStr ? renderFnOrStr : null;
    this.safeRenderFn_ = renderFnOrStr;
  }
  render(context) {
    return this.safeStr_ || this.safeRenderFn_(context);
  }
  toString() {
    return this.render(Context.INNER_HTML);
  }
}


const safe = str => new Safe(str);

const isSafe = value => (value instanceof Safe);


function escapeHtmlSpecialChars(unsafe) {
  return unsafe.replace(unsafeCharsRe, c => unsafeCharsMapping[c]);
}

function escapeJson(unsafe) {
  try {
    JSON.parse(unsafe);
    return unsafe; // valid  json
  } catch {}
  return escapeHtmlSpecialChars(unsafe);
}

const escapedChunksCache = {
  [Context.INNER_JSON.toString()]: {},
  [Context.INNER_HTML.toString()]: {},
};

function escapeByContextCached(context, unsafe) {
  const contextKey = context.toString();
  if (escapedChunksCache[contextKey][unsafe]) {
    return escapedChunksCache[contextKey][unsafe];
  }
  return (
    escapedChunksCache[contextKey][unsafe] = escapeByContext(context, unsafe));
}

function escapeByContext(context, unsafe) {
  if (context == Context.INNER_JSON) {
    return escapeJson(unsafe);
  }
  return escapeHtmlSpecialChars(unsafe);
}

const chunkContextCache = {
  [Context.INNER_JSON.toString()]: {},
  [Context.INNER_HTML.toString()]: {},
};

function getContextCached(outerContext, prefix) {
  if (chunkContextCache[outerContext][prefix]) {
    return chunkContextCache[outerContext][prefix];
  }
  return (
    chunkContextCache[outerContext][prefix] = getContext(outerContext, prefix));
}

function getContext(outerContext, prefix) {
  if (prefix.match(innerJsonOpeningRe)) {
    return Context.INNER_JSON;
  }
  if (prefix.match(innerJsonClosingRe)) {
    return Context.INNER_HTML;
  }
  return outerContext;
}


function maybeEscape(context, maybeUnsafe) {
  if (isSafe(maybeUnsafe)) {
    return maybeUnsafe.render(context);
  }
  if (maybeUnsafe == null ||
      typeof maybeUnsafe == 'undefined') {
    return '';
  }
  if (typeof maybeUnsafe == 'number') {
    return maybeUnsafe.toString();
  }
  if (Array.isArray(maybeUnsafe)) {
    return joinFragments(maybeUnsafe, s => maybeEscape(context, s));
  }
  if (typeof maybeUnsafe === 'object') {
    assert.strictEqual(context, Context.INNER_JSON);
    return JSON.stringify(maybeUnsafe);
  }
  assert.strictEqual(typeof maybeUnsafe, 'string');
  return escapeByContextCached(context, maybeUnsafe);
}


function html(staticStrings, ...values) {
  // Static template.
  if (values.length < 1) {
    assert(staticStrings.length == 1);
    return safe(staticStrings[0]);
  }

  // Interpolated template.
  return safe(context => {
    return joinFragments(staticStrings, (safe, i) => {
      if (i >= values.length) {
        return safe;
      }
      return safe + maybeEscape(getContextCached(context, safe), values[0]);
    });
  });
}


module.exports = {
  html,

  // For testing only.
  escapeHtmlSpecialCharsForTesting: escapeHtmlSpecialChars,
  safeForTesting: safe,
};
