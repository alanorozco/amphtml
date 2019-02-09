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

const {Context} = require('./safe-html-context');


function wrapCtor(ctor, opt_initializeCache) {
  const cache = {};

  const reset = opt_initializeCache || (cache => {
    for (const k in cache) {
      delete cache[k];
    }
  });

  if (opt_initializeCache) {
    opt_initializeCache(cache);
  }

  const wrapped = (...args) => ctor(cache, ...args);

  wrapped.resetForTesting = () => reset(cache);
  wrapped.getCacheForTesting = () => cache;

  return wrapped;
}


/**
 * Memoizes a function that takes a single arg.
 * @param {function(Context, string):T} ctor
 * @return {function(Context, string):T}
 * @template T
 */
// TODO(alanorozco): Generalize n-level caching for cacheByContext.
function cacheShallow(ctor, opt_rejectWhen) {
  return wrapCtor((cache, key) => {
    if (opt_rejectWhen && opt_rejectWhen(key)) {
      return ctor(key);
    }
    const keyStr = key.toString();
    if (keyStr in cache) {
      return cache[keyStr];
    }
    return (cache[keyStr] = ctor(key));
  });
}


function initializeContextCache(cache) {
  Object.values(Context).forEach(context => {
    cache[context.toString()] = {};
  });
}

/**
 * Memoizes a function that takes a `Context` and a string. Context and value
 * are the two determinators for escaping strings and recalculating context, so
 * this gives us a useful signal to only partially recompile templates on
 * subsequent rerenders, specially for small, constant units.
 * @param {function(Context, string):T} ctor
 * @return {function(Context, string):T}
 * @template T
 */
function cacheByContext(ctor) {
  return wrapCtor(function(cache, context, stringKey) {
    const contextKey = context.toString();
    if (stringKey in cache[contextKey]) {
      return cache[contextKey][stringKey];
    }
    return (cache[contextKey][stringKey] = ctor(context, stringKey));
  }, initializeContextCache);
}


module.exports = {cacheByContext, cacheShallow};
