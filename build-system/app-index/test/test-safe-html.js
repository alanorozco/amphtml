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
  escapeHtmlSpecialCharsForTesting: escapeHtmlSpecialChars,
  html,
  safeForTesting: safe,
} = require('../safe-html');

describe('safe-html', () => {

  const evilUnescaped = '<script>alert("evil")</script>';
  const evilEscaped = '&lt;script&gt;alert(&quot;evil&quot;)&lt;/script&gt;';

  describe('self-test `evilEscaped` string', () => {
    it('equals escaped `evilUnescaped`', () => {
      expect(escapeHtmlSpecialChars(evilUnescaped)).to.equal(evilEscaped);
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

    it('leaves innocent strings alone', () => {
      const renderer = html`<div>${'benign'}</div>`;
      expect(renderer.toString()).to.equal('<div>benign</div>');
    });

    it('leaves innocent integers alone', () => {
      const renderer = html`<div>${1}</div>`;
      expect(renderer.toString()).to.equal('<div>1</div>');
    });

    it('leaves innocent floats alone', () => {
      const renderer = html `<div>${3.1416}</div>`;
      expect(renderer.toString()).to.equal('<div>3.1416</div>');
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
      expect(() => html`<div>${{
        hello: 'world',
        foo: {
          bar: ['baz'],
        },
      }}</div>`.toString()).to.throw;
    });

    it('concats arrays of safe values', () => {
      const renderer = html`<article>${[
        html`<h2>Header</h2>`,
        html`<p>Lorem Ipsum</p>`,
      ]}</article>`;

      expect(renderer.toString()).to.equal(
          '<article><h2>Header</h2><p>Lorem Ipsum</p></article>');
    });

    it('concats arrays of mixed safety values while escaping unsafe', () => {
      const renderer = html`<div>${[
        evilUnescaped,
        html`<p>Lorem Ipsum</p>`,
        evilUnescaped,
      ]}</div>`;

      expect(renderer.toString()).to.equal(
          `<div>${evilEscaped}<p>Lorem Ipsum</p>${evilEscaped}</div>`);
    });

    it('escapes innerHTML', () => {
      const renderer = html`<div>${evilUnescaped}</div>`;
      expect(renderer.toString()).to.equal(`<div>${evilEscaped}</div>`);
    });

    it('escapes innerHTML (nested)', () => {
      const renderer = html`<div>${
        html`<section>${evilUnescaped}</section>`
      }</div>`;
      expect(renderer.toString()).to.equal(
          `<div><section>${evilEscaped}</section></div>`);
    });
  });
});
