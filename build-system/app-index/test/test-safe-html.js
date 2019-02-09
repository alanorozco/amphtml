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

const {expect} = require('chai');
const {
  resetAllForTesting,
  escapeHtmlSpecialCharsForTesting: escapeHtmlSpecialChars,
  getAllCachesForTesting,
  html,
  safeForTesting: safe,
} = require('../safe-html');

describe('safe-html', () => {

  const evil = '<script>alert("evil")</script>';
  const evilEscaped = '&lt;script&gt;alert(&quot;evil&quot;)&lt;/script&gt;';

  function isEmptyObjOrUndef(obj) {
    return obj === undefined || Object.keys(obj).length < 1;
  }

  afterEach(() => {
    resetAllForTesting();
    expect(getAllCachesForTesting()).to.satisfy(caches =>
      caches.every(cache =>
        Object.keys(cache).every(k => isEmptyObjOrUndef(cache[k]))));
  });

  describe('self-test `evilEscaped` string', () => {
    it('equals escaped `evil`', () => {
      expect(escapeHtmlSpecialChars(evil)).to.equal(evilEscaped);
    });

    it('does not contain HTML special chars', () => {
      expect(evilEscaped.indexOf('<')).to.be.below(0);
      expect(evilEscaped.indexOf('>')).to.be.below(0);
      expect(evilEscaped.indexOf('"')).to.be.below(0);
      expect(evilEscaped.indexOf('\'')).to.be.below(0);
    });
  });

  describe('safe', () => {

    it('honors strings', () => {
      const strWithHtml = '<h1>Hello world!</h1>';
      expect(safe(strWithHtml).toString()).to.equal(strWithHtml);
    });

    it('honors renderer', () => {
      const strWithHtml = '<h1>Hello world!</h1>';
      expect(safe(() => strWithHtml).toString()).to.equal(strWithHtml);
    });

  });

  describe('html', () => {

    it('honors static templates', () => {
      const renderer = html`<div class="myClass"></div>`;
      expect(renderer.toString()).to.equal('<div class="myClass"></div>');
    });

    it('honors static templates (nested)', () => {
      const renderer = html`<div>${
        html`<ul>${
          html`<li></li>`
        }</ul>`
      }</div>`;
      expect(renderer.toString()).to.equal('<div><ul><li></li></ul></div>');
    });

    it('concats multiple interpolated args', () => {
      expect(html`a ${'b'} c${' d'}`.toString()).to.equal('a b c d');
    });

    it('escapes multiple interpolated args', () => {
      expect(html`a${evil}b${evil}`.toString())
          .to.equal(`a${evilEscaped}b${evilEscaped}`);
    });

    it('escapes evil', () => {
      const renderer = html`${evil}`;
      expect(renderer.toString()).to.equal(evilEscaped);
    });

    it('leaves innocent strings alone', () => {
      const renderer = html`<div>${'benign'}</div>`;
      expect(renderer.toString()).to.equal('<div>benign</div>');
    });

    it('leaves innocent integers alone', () => {
      const renderer = html`<div>${1}</div>`;
      expect(renderer.toString()).to.equal('<div>1</div>');
    });

    it('leaves innocent floats alone', () => {
      const renderer = html`<div>${3.1416}</div>`;
      expect(renderer.toString()).to.equal('<div>3.1416</div>');
    });

    it('leaves innocent <> chars in attr value alone', () => {
      const renderer = html`<div data-x="${'<>'}"></div>`;
      expect(renderer.toString()).to.equal('<div data-x="<>"></div>');
    });

    it('allows escaped quotes in intepolated attr value', () => {
      const renderer = html`<div data-x="${'\\"'}"></div>`;
      expect(renderer.toString()).to.equal('<div data-x="\\""></div>');
    });

    it('escapes double quote as only char in interpolated attr value', () => {
      const renderer = html`<div data-x="${'"'}"></div>`;
      expect(renderer.toString()).to.equal('<div data-x="\\""></div>');
    });

    it('escapes double quote at tail of interpolated attr value', () => {
      const renderer = html`<div data-x="${'abc "'}"></div>`;
      expect(renderer.toString()).to.equal('<div data-x="abc \\""></div>');
    });

    it('escapes double quote at head of interpolated attr value', () => {
      const renderer = html`<div data-x="${'" abc'}"></div>`;
      expect(renderer.toString()).to.equal('<div data-x="\\" abc"></div>');
    });

    it('escapes double quote in the middle of interpolated attr value', () => {
      const renderer = html`<div data-x="${'abc " def'}"></div>`;
      expect(renderer.toString()).to.equal('<div data-x="abc \\" def"></div>');
    });

    it('escapes multiple double quotes in interpolated attr value', () => {
      const renderer = html`<div data-x="${'" abc " def" hijk'}"></div>`;
      expect(renderer.toString()).to.equal(
        '<div data-x="\\" abc \\" def\\" hijk"></div>');
    });

    it('leaves innocent JSON alone', () => {
      const json = JSON.stringify({
        hello: 'world',
        foo: {
          bar: ['baz'],
        },
      });
      const renderer = html`<script type="application/json">${json}</script>`;
      expect(renderer.toString()).to.equal(
          `<script type="application/json">${json}</script>`);
    });

    it('leaves innocent JSON alone (nested)', () => {
      const json = JSON.stringify({
        hello: 'world',
        foo: {
          bar: ['baz'],
        },
      });
      const renderer = html`<div><script type="application/json">${
        json
      }</script></div>`;
      expect(renderer.toString()).to.equal(
          `<div><script type="application/json">${json}</script></div>`);
    });

    it('stringifies objects in JSON context', () => {
      const obj = {
        hello: 'world',
        foo: {
          bar: ['baz'],
        },
      };
      const json = JSON.stringify(obj);
      const renderer = html`<script type="application/json">${obj}</script>`;
      expect(renderer.toString()).to.equal(
        `<script type="application/json">${json}</script>`);
    });

    it('annuls JSON context (escapes value) when closing <script> tag', () => {
      const obj = {
        hello: 'world',
        foo: {
          bar: ['baz'],
        },
      };
      const json = JSON.stringify(obj);
      const escapedJson = escapeHtmlSpecialChars(json);
      const renderer = html`<script></script>${json}`;
      expect(renderer.toString()).to.equal(`<script></script>${escapedJson}`);
    });

    it('stringifies objects in JSON context (simple <script>)', () => {
      const obj = {
        hello: 'world',
        foo: {
          bar: ['baz'],
        },
      };
      const json = JSON.stringify(obj);
      const renderer = html`<script>${obj}</script>`;
      expect(renderer.toString()).to.equal(`<script>${json}</script>`);
    });

    it('stringifies objects in JSON context (nested)', () => {
      const obj = {
        hello: 'world',
        foo: {
          bar: ['baz'],
        },
      };
      const json = JSON.stringify(obj);
      const renderer = html`<div><script type="application/json">${
        obj
      }</script></div>`;
      expect(renderer.toString()).to.equal(
        `<div><script type="application/json">${json}</script></div>`);
    });

    it('fails to stringify objects when not in JSON context', () => {
      expect(() => {
        html`<div>${{hello: 'world'}}</div>`.toString();
      }).to.throw;
    });

    it('concats arrays of strings containing safe chars', () => {
      const renderer = html`<div>${['a', 'b', 'c']}</div>`;
      expect(renderer.toString()).to.equal('<div>abc</div>');
    });

    it('concats arrays of safe types (number)', () => {
      const renderer = html`<div>${[1, 1.23, 5]}</div>`;
      expect(renderer.toString()).to.equal('<div>11.235</div>');
    });

    it('does not take array with objects when in tag context', () => {
      expect(() => {
        html`<div>${[1, {foo: 'bar'}, 5]}</div>`.toString();
      }).to.throw;
    });

    it('serializes array with objects when in JSON context', () => {
      const arr = [1, {foo: 'bar'}, 'tacos'];
      const json = JSON.stringify(arr);
      const renderer = html`<script>${arr}</script>`;
      expect(renderer.toString()).to.equal(`<script>${json}</script>`);
    });

    it('serializes array of strings when in JSON context', () => {
      const arr = ['a', 'b', 'c'];
      const json = JSON.stringify(arr);
      const renderer = html`<script>${arr}</script>`;
      expect(renderer.toString()).to.equal(`<script>${json}</script>`);
    });

    it('serializes array of strings when in JSON', () => {
      const arr = ['a', 'b', 'c'];
      const json = JSON.stringify(arr);
      const renderer = html`<script id="${'<>'}">${arr}</script>`;
      expect(renderer.toString()).to.equal(`<script id="<>">${json}</script>`);
    });

    it('serializes array of strings when in JSON (nested)', () => {
      const arr = ['a', 'b', 'c'];
      const json = JSON.stringify(arr);
      const renderer = html`<div id="${'<>'}"><script>${arr}</script></div>`;
      expect(renderer.toString()).to.equal(
          `<div id="<>"><script>${json}</script></div>`);
    });

    it('allows partial attributes', () => {
      expect(html`a="${'<>'}"`.toString()).to.equal('a="<>"');
    });


    it('concats arrays of generated safe values', () => {
      const renderer = html`<article>${[
        html`<h2>Header</h2>`,
        html`<p>Lorem Ipsum</p>`,
      ]}</article>`;

      expect(renderer.toString()).to.equal(
          '<article><h2>Header</h2><p>Lorem Ipsum</p></article>');
    });

    it('concats arrays of mixed safety values while escaping unsafe', () => {
      const renderer = html`<div>${[
        evil,
        html`<p>Lorem Ipsum</p>`,
        evil,
      ]}</div>`;

      expect(renderer.toString()).to.equal(
          `<div>${evilEscaped}<p>Lorem Ipsum</p>${evilEscaped}</div>`);
    });

    it('escapes innerHTML', () => {
      const renderer = html`<div>${evil}</div>`;
      expect(renderer.toString()).to.equal(`<div>${evilEscaped}</div>`);
    });

    it('escapes innerHTML (nested)', () => {
      const renderer = html`<div>${html`<section>${evil}</section>`}</div>`;
      expect(renderer.toString()).to.equal(
          `<div><section>${evilEscaped}</section></div>`);
    });

    it('ampstate', () => {
      const id = 'a';
      const state = {foo: 'bar'};
      const renderer =
        html`<amp-state id="${id}">
          <script type="application/json">
            ${state}
          </script>
        </amp-state>`

      const expected =
        `<amp-state id="${id}">
          <script type="application/json">
            ${JSON.stringify(state)}
          </script>
        </amp-state>`

      expect(renderer.toString()).to.equal(expected);
    })

    it('escapes innerHTML (nested and multiple)', () => {
      const renderer = html`<div>${
        html`<section>${evil}</section>`
      }</div><ul><li>${evil}</li></ul>`;

      expect(renderer.toString()).to.equal(
        `<div><section>${evilEscaped}</section></div>` +
        `<ul><li>${evilEscaped}</li></ul>`);
    });

    it('escapes/allows mixed with mixed levels of nesting', () => {
      const obj = {foo: 'bar'};
      const objJson = JSON.stringify(obj);
      const objJsonEscaped = escapeHtmlSpecialChars(objJson);
      const arr = [1, 2, 3];
      const arrJson = JSON.stringify(arr);
      const renderer = html`<div attr="${
        '>ok<' // should not be escaped
      }"><script>${
        obj // should be serialized and unescaped
      }</script><div>${
        objJson // should be escaped
      }</div>${
        evil // should be escaped (obvs)
      }<script type="application/json">${
        arr // should be seralized and unescaped
      }</script><div>${
        html`<ul>${
          evil // should be escaped (obvs)
        }</ul>`
      }<ul>${
        html`<li>${[
          html`<a href="${
            'not"ok' // should be escaped
          }">${
            'Hello & Welcome' // should be escaped
          }</a><br />`,
          'I consist of valid chars only',
          html`<div>I'm a static div</div>`,
        ]}</li>`
      }</ul>`;

      const expected = `<div attr="${
        '>ok<' // should not be escaped
      }"><script>${
        objJson // should be serialized and unescaped
      }</script><div>${
        objJsonEscaped // should be escaped
      }</div>${
        evilEscaped // should be escaped (obvs)
      }<script type="application/json">${
        arrJson // should be seralized and unescaped
      }</script><div>${
        `<ul>${
          evilEscaped // should be escaped (obvs)
        }</ul>`
      }<ul>${
        `<li>${[
          `<a href="${
            'not\\"ok' // should be escaped
          }">${
            'Hello &amp; Welcome' // should be escaped
          }</a><br />`,
          'I consist of valid chars only',
          '<div>I\'m a static div</div>',
        ].join('')}</li>`
      }</ul>`;

      expect(renderer.toString()).to.equal(expected);

    });
  });
});
