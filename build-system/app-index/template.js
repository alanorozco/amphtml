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

/* eslint-disable amphtml-internal/html-template */
/* eslint-disable indent */

'use strict';

const headerLinks = require('./header-links');
const ProxyForm = require('./proxy-form');
const {AmpDoc, addRequiredExtensionsToHead} = require('./amphtml-helpers');
const {ampLogo, ampLogoSymbol} = require('./amp-logo-svg');
const {FileList} = require('./file-list');
const {html, htmlOptional, joinFragments} = require('./html');
const {SettingsModal, SettingsOpenButton} = require('./settings');


const listingShortcuts = [
  {href: '/~', basepath: '/', name: html`/ <span>root</span>`},
  {href: '/', basepath: '/examples/'},
  {href: '/test/manual/'},
];


const builtWithLove =
  html`Built with ♡ by <a href="https://ampproject.org">the AMP Project</a>`;


const HeaderLink = ({name, href, divider}) =>
  html`<li class="${divider ? 'divider' : ''}">
    <a target="_blank" rel="noopener noreferrer" href="${href}">
      ${name}
    </a>
  </li>`;


const Header = ({isMainPage, links}) =>
  html`<header>
    <h1 class="amp-logo">
      ${ampLogo} AMP
    </h1>
    <div class="right-of-logo">
      ${htmlOptional(!isMainPage, HeaderBackToMainLink())}
    </div>
    <!-- Hamburger button and sidebar displayed on small viewports -->
    <ul class="hide-on-large">
      <li class="burger icon-button"
          on="tap: header-sidebar.open,
                   header-accordion.expand(section=default-section);"
          role=button
          aria-label="Open sidebar">
        ☰
      </li>
    </ul>
    <!-- Top navigation displayed on large viewports -->
    <ul class="show-on-large">
      ${joinFragments(links, ({name, href, divider}, i) =>
        HeaderLink({
          divider: divider || i == links.length - 1,
          name,
          href,
        }))}
      <li class="icon-button">${SettingsOpenButton()}</li>
    </ul>
  </header>`;


const HeaderFallbackSidebarAccordionSection = ({heading, content, isDefault}) =>
  html`<section ${htmlOptional(isDefault, 'id="default-section" expanded')}>
    <h3>${heading}</h3>
    ${content}
  </section>`;


const HeaderFallbackSidebar = ({isMainPage, links}) =>
  html`<amp-sidebar layout=nodisplay id="header-sidebar" side=right>
    <div class="close">
      <a class="icon-button"
          on="tap: header-sidebar.close"
          role=button
          aria-label="Close sidebar">
        ×
      </a>
    </div>
    <amp-accordion expand-single-section
        disable-session-states
        id="header-accordion">
      ${joinFragments([
        HeaderFallbackSidebarAccordionSection({
          isDefault: true,
          heading: 'Helpful links',
          content: html`<ul class="sidebar-links">
            ${joinFragments(links, HeaderLink)}
          </ul>`,
        }),
        htmlOptional(isMainPage, HeaderFallbackSidebarAccordionSection({
          heading: 'Load URL by proxy',
          content: html`<div class="proxy-form-sidebar-container">
            ${ProxyForm({label: null})}
          </div>`,
        })),
        HeaderFallbackSidebarAccordionSection({
          heading: 'Settings',
          content: html`<div></div>`,
        }),
      ])}
    </amp-accordion>
    <footer>
      ${builtWithLove}
    </footer>
  </amp-sidebar>`;


const HeaderBackToMainLink = () => html`
    <a href="/" class="show-on-large">← Back to main</a>`;


const SvgDefs = symbols => html`
  <svg style="position: absolute; width: 0; height: 0; overflow: hidden;"
      version="1.1" xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs>
      ${joinFragments(symbols)}
    </defs>
  </svg>`;


const ListingShortcut = ({href, name, basepath}, opt_current) =>
  html`<li class="${htmlOptional((basepath || href) == opt_current, 'active')}">
    <a href="${href}">${name || basepath || href}</a>
  </li>`;


const ListingShortcuts = ({listingShortcuts, current}) =>
  html`<ul class="listing-shortcuts wrap">
    ${joinFragments(listingShortcuts, shortcut =>
        ListingShortcut(shortcut, current))}
  </ul>`;


function renderTemplate(opt_params) {
  const {
    basepath,
    css,
    isMainPage,
    fileSet,
    serveMode,
    selectModePrefix,
  } = {
    basepath: '/',
    isMainPage: false,
    fileSet: [],
    serveMode: 'default',
    selectModePrefix: '/',
    ...(opt_params || {}),
  };

  const head =
    html`<link href="https://fonts.googleapis.com/css?family=Poppins:400,700"
      rel="stylesheet" type="text/css">`;

  const body = joinFragments([
    // Undisplayed content first.
    SvgDefs([ampLogoSymbol]),
    HeaderFallbackSidebar({isMainPage, links: headerLinks}),
    SettingsModal({serveMode}),

    html`<div class="header-sticky">
      <div class="wrap">
        ${Header({isMainPage, links: headerLinks})}
      </div>
    </div>`,

    htmlOptional(isMainPage,
        html`<div class="wrap show-on-large proxy-form-wrap">
          ${ProxyForm()}
        </div>`),

    ListingShortcuts({listingShortcuts, current: basepath}),

    FileList({basepath, selectModePrefix, fileSet}),

    html`<footer class="center show-on-large">${builtWithLove}</footer>`,
  ]);

  const docWithoutExtensions = AmpDoc({canonical: basepath, css, body, head});

  return addRequiredExtensionsToHead(docWithoutExtensions);
}


module.exports = {renderTemplate};
