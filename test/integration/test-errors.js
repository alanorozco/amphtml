/**
 * Copyright 2015 The AMP HTML Authors. All Rights Reserved.
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

import {
  createFixtureIframe,
  expectBodyToBecomeVisible,
  poll,
} from '../../testing/iframe.js';

/** @const {number} */
const TIMEOUT = window.ampTestRuntimeConfig.mochaTimeout;

const t = describe
  .configure()
  .retryOnSaucelabs()
  // TODO(@cramforce): Find out why it does not work with obfuscated props.
  .skipIfPropertiesObfuscated();

t.run('error page', function() {
  this.timeout(TIMEOUT);

  let fixture;
  let messages;

  beforeEach(async () => {
    // Errors are printed as URLs when `transform-log-messages` is on.
    // Fetch table to  URL ids for expected messages.
    messages = await (await fetch('/dist/log-messages.simple.json')).json();

    fixture = await createFixtureIframe(
      'test/fixtures/errors.html',
      1000,
      win => {
        // Trigger dev mode.
        try {
          win.history.pushState({}, '', 'test2.html#development=1');
        } catch (e) {
          // Some browsers do not allow this.
          win.AMP_DEV_MODE = true;
        }
      }
    );

    return poll(
      'errors to happen',
      () => fixture.doc.querySelectorAll('[error-message]').length >= 2,
      () =>
        new Error(
          'Failed to find errors. HTML\n' +
            fixture.doc.documentElement./*TEST*/ innerHTML
        ),
      TIMEOUT - 1000
    );
  });

  it.configure()
    .skipFirefox()
    .skipEdge()
    .run('should show the body in error test', () => {
      return expectBodyToBecomeVisible(fixture.win, TIMEOUT);
    });

  const idsForMessagesThatContain = substr =>
    Object.keys(messages).filter(id => messages[id].indexOf(substr) > -1);

  function expectedErrorRe(element) {
    const substr = element.getAttribute('data-expectederror');
    const ids = idsForMessagesThatContain(substr);
    const valids = [substr].concat(ids.map(id => `&id=${id}&`));
    return new RegExp(valids.map(reEscape).join('|'));
  }

  const reEscape = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function shouldFail(id) {
    // Skip for issue #110
    it.configure()
      .ifChrome()
      .run(`should fail to load #${id}`, () => {
        const e = fixture.doc.getElementById(id);
        const errorRe = expectedErrorRe(e);
        expect(fixture.errors.join('\n')).to.match(errorRe);
        expect(e.getAttribute('error-message')).to.match(errorRe);
        expect(e.className).to.contain('i-amphtml-element-error');
      });
  }

  // Add cases to fixtures/errors.html and add them here.
  shouldFail('yt0');
  shouldFail('iframe0');
});
