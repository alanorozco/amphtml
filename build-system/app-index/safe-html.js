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
const {cacheShallow, cacheByContext} = require('./safe-html-cache');
const {Context} = require('./safe-html-context');

const jsonBodyOpeningRe = /\<script[^>]*\>\s*$/g;
const jsonBodyClosingRe = /\<\/script\>/;

const tagAttrContentRe = /\<([^\/]+)(\s[^>]*)$/;
const attrValueOpeningRe = /(\<[^>]+)?\="([^"]|(\\"))*$/g;
const attrValueClosingRe = /^([^"]|\")*"/;
const attrValueOpeningTagClosingRe = /^([^"]|(\\"))*"[^>]*\>/;

const unsafeHtmlBodyCharsRe = /[&<>"']/g;

const unsafeHtmlBodyCharsMapping = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#039;',
};

/**
 * Takes a set of HTML fragments and concatenates them.
 * @param {!Array<T>} fragments
 * @param {function(T):string} renderer
 * @return {string}
 * @template T
 */
const joinFragments = (fragments, renderer) => fragments.map(renderer).join('');


/**
 * Safe renderer for a string or a rendering function that is known to be safe
 * per any condition.
 */
class Safe {
  constructor(renderFnOrStr) {
    assert(
        typeof renderFnOrStr == 'function' ||
        typeof renderFnOrStr == 'string');

    this.safeStr_ = (typeof renderFnOrStr == 'string') ? renderFnOrStr : null;
    this.safeRenderFn_ = renderFnOrStr;
  }
  /**
   *
   * @param {Context} context
   * @return {string}
   */
  render(context) {
    return this.safeStr_ || this.safeRenderFn_(context);
  }
  toString() {
    return this.render(Context.TAG_BODY);
  }
}

const isSafe = value => (value instanceof Safe);


/**
 * Creates a Safe renderer for a string or a rendering function that is known
 * to be safe per any condition.
 *
 * This is cached since many small units in one document can be static
 * templates, so it's useless to regenerate safe renderers for every request,
 * or when a template is repeated in the same document.
 *
 * @param {string|function(Context):string}
 * @return {!Safe}
 */
const safe = cacheShallow(
    /* ctor */ strOrFn => new Safe(strOrFn),
    /* rejectWhen */ strOrFn => typeof strOrFn == 'function');


const attrValueQuotesRe = /^"|([^\\])"|^$/g
const escapeAttrValueQuote = (_, prefix) => `${prefix || ''}\\"`;

function escapeAttrValue(unsafe) {
  return unsafe.replace(attrValueQuotesRe, escapeAttrValueQuote);
}


function escapeHtmlSpecialChars(unsafe) {
  return unsafe.replace(unsafeHtmlBodyCharsRe,
      c => unsafeHtmlBodyCharsMapping[c]);
}

function escapeJson(unsafe) {
  try {
    JSON.parse(unsafe);
    return unsafe; // valid json
  } catch {
    // invalid json. ignore and escape chars.
  }
  return escapeHtmlSpecialChars(unsafe);
}

function escapeTagAttrContent(unsafe) {
  // TODO(alanorozco): https://infra.spec.whatwg.org/#noncharacter
  return unsafe.replace(/[\s"'>/=]+/, '');
}

function escapeByContext(context, unsafe) {
  if (context == Context.JSON_BODY) {
    return escapeJson(unsafe);
  }
  if (context == Context.ATTR_VALUE) {
    return escapeAttrValue(unsafe);
  }
  if (context == Context.TAG_ATTR_CONTENT) {
    return escapeTagAttrContent(unsafe);
  }
  return escapeHtmlSpecialChars(unsafe);
}

const escapeByContextCached = cacheByContext(escapeByContext);

// TODO(alanorozco): Context should be a stack
let previousBodyContext = null;
function getContext(outerContext, prefix) {
  previousBodyContext =
      previousBodyContext === null ? outerContext : previousBodyContext;

  const attrValueOpeningReMatch = prefix.match(attrValueOpeningRe);
  const attrValueOpeningTagName =
      attrValueOpeningReMatch &&
          attrValueOpeningReMatch[0] &&
          attrValueOpeningReMatch[0].charAt(0) == '<' ?
        attrValueOpeningReMatch[0].substring(1).replace(/[\s][\s\S]+.*$/, '') :
        null;

  if (attrValueOpeningReMatch &&
      attrValueOpeningTagName == 'script') {
    previousBodyContext = Context.JSON_BODY;
    return Context.ATTR_VALUE;
  }
  if (attrValueOpeningReMatch) {
    return Context.ATTR_VALUE;
  }
  const tagAttrContentReMatch = prefix.match(tagAttrContentRe);
  if (tagAttrContentReMatch &&
      tagAttrContentReMatch[1].toLowerCase() == 'script') {
    previousBodyContext = Context.JSON_BODY;
    return Context.TAG_ATTR_CONTENT;
  }
  if (tagAttrContentReMatch) {
    return Context.TAG_ATTR_CONTENT;
  }
  if (prefix.match(jsonBodyOpeningRe)) {
    previousBodyContext = Context.JSON_BODY;
    return Context.JSON_BODY;
  }
  if (outerContext == Context.JSON_BODY &&
    prefix.match(jsonBodyClosingRe)) {
    previousBodyContext = Context.TAG_BODY;
    return Context.TAG_BODY;
  }
  if (prefix.match(attrValueOpeningTagClosingRe)) {
    return previousBodyContext;
  }
  if (outerContext == Context.ATTR_VALUE &&
    prefix.match(attrValueClosingRe)) {
    return Context.TAG_ATTR_CONTENT;
  }
  return outerContext;
}

const getContextCached = cacheByContext(getContext);

/**
 * @param {Context} context
 * @param {*} maybeUnsafe
 * @return {string}
 */
function maybeEscapeByContext(context, maybeUnsafe) {
  if (isSafe(maybeUnsafe)) {
    return maybeUnsafe.render(context);
  }
  if (!maybeUnsafe || maybeUnsafe === true) {
    // Ignore null, undefined and booleans. This allows template expressions in
    // the form of  html`${header && html`<h2>`${header}`</h2>`}<p>${body}<p>`
    return '';
  }
  if (typeof maybeUnsafe == 'number') {
    // Let numbers through. In practice `escapeByContextCached` won't do
    // desctructive changes to number values, but might as well short-circuit
    // execution if we know the value is be safe when unescaped.
    return maybeUnsafe.toString();
  }
  if (Array.isArray(maybeUnsafe) &&
      context != Context.JSON_BODY) {
    // Join framgnents in arrays to allow syntax like
    // html`<ul>${[1, 2, 3].map(n => html`<li>${n}</li>`)}</ul>`.
    return joinFragments(maybeUnsafe, item =>
      maybeEscapeByContextCached(context, item));
  }
  if ((Array.isArray(maybeUnsafe) ||
      typeof maybeUnsafe === 'object') &&
      context == Context.JSON_BODY) {
    // Serialize objects and arrays in JSON context for syntactic sugar:
    // html`<script>${{foo: 'bar'}}</script>` // <script>{"foo":"bar"}</script>
    return JSON.stringify(maybeUnsafe);
  }
  assert.strictEqual(typeof maybeUnsafe, 'string');
  return escapeByContextCached(context, maybeUnsafe);
}

const maybeEscapeByContextCached = cacheByContext(maybeEscapeByContext);


function html(staticStrings, ...values) {
  if (values.length < 1) {
    assert(staticStrings.length == 1);
    return safe(staticStrings[0]);
  }

  return safe(outerContext => {
    return joinFragments(staticStrings, (staticString, i) => {
      if (i >= values.length) {
        return staticString;
      }
      const innerContext = getContextCached(outerContext, staticString);
      const escapedValue = maybeEscapeByContextCached(innerContext, values[i]);

      // Use interpolation instead of concat operator to leverage V8
      // optimizations.
      return `${staticString}${escapedValue}`;
    });
  });
}


function resetAllForTesting() {
  escapeByContextCached.resetForTesting();
  getContextCached.resetForTesting();
  maybeEscapeByContextCached.resetForTesting();
  safe.resetForTesting();
}


function getAllCachesForTesting() {
  return [
    escapeByContextCached.getCacheForTesting(),
    getContextCached.getCacheForTesting(),
    maybeEscapeByContextCached.getCacheForTesting(),
    safe.getCacheForTesting(),
  ];
}


module.exports = {
  html,

  // For testing only.
  getAllCachesForTesting,
  escapeHtmlSpecialCharsForTesting: escapeHtmlSpecialChars,
  resetAllForTesting,
  safeForTesting: safe,
};
