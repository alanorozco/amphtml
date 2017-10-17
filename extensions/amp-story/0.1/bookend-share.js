/**
 * Copyright 2017 The AMP HTML Authors. All Rights Reserved.
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
import {Services} from '../../../src/services';
import {Toast} from './toast';
import {isObject} from '../../../src/types';
import {scopedQuerySelector} from '../../../src/dom';
import {renderAsElement, renderSimpleTemplate} from './simple-template';
import {dev, user} from '../../../src/log';
import {dict} from './../../../src/utils/object';
import {listen} from '../../../src/event-helper';
import {copyToClipboard, isCopyingToClipboardSupported} from './clipboard';


/**
 * Maps share provider type to visible name.
 * If the name only needs to be capitalized (e.g. `facebook` to `Facebook`) it
 * does not need to be included here.
 * @const {!JsonObject}
 */
const SHARE_PROVIDER_NAME = dict({
  'gplus': 'Google+',
  'linkedin': 'LinkedIn',
  'whatsapp': 'WhatsApp',
  'system': 'More',
});


/** @private @const {!./simple-template.ElementDef} */
const SHARE_LIST_TEMPLATE = {
  tag: 'div',
  attrs: dict({'class': 'i-amphtml-story-share-list'}),
  children: [
    {tag: 'ul'},
    {
      tag: 'div',
      attrs: dict({'class': 'i-amphtml-story-share-system'}),
    },
  ],
};


/** @private @const {!./simple-template.ElementDef} */
const SHARE_ITEM_TEMPLATE = {tag: 'li'};


/** @private @const {!Array<!./simple-template.ElementDef>} */
const LINK_SHARE_ITEM_TEMPLATE = [
  {
    tag: 'div',
    attrs: dict({
      'class':
          'i-amphtml-story-share-icon i-amphtml-story-share-icon-link',
    }),
    text: 'Get Link', // TODO(alanorozco): i18n
  },
];


/**
 * @param {!JsonObject=} opt_params
 * @return {!JsonObject}
 */
function buildProviderParams(opt_params) {
  const attrs = dict();

  if (opt_params) {
    Object.keys(opt_params || {}).forEach(field => {
      attrs[`data-param-${field}`] = opt_params[field];
    });
  }

  return attrs;
}


/**
 * @param {!Document} doc
 * @param {string} shareType
 * @param {!JsonObject=} opt_params
 * @return {!Node}
 */
function buildProvider(doc, shareType, opt_params) {
  return renderSimpleTemplate(doc,
      /** @type {!Array<!./simple-template.ElementDef>} */ ([
        {
          tag: 'amp-social-share',
          attrs: /** @type {!JsonObject} */ (Object.assign(
              dict({
                'width': 48,
                'height': 66,
                'class': 'i-amphtml-story-share-icon',
                'type': shareType,
              }),
              buildProviderParams(opt_params))),
          text: SHARE_PROVIDER_NAME[shareType] || shareType,
        },
      ]));
}


/**
 * @param {!Document} doc
 * @param {string} url
 * @return {!Element}
 */
function buildCopySuccessfulToast(doc, url) {
  return renderAsElement(doc, /** @type {!./simple-template.ElementDef} */ ({
    tag: 'div',
    attrs: dict({'class': 'i-amphtml-story-copy-successful'}),
    children: [
      {
        tag: 'div',
        text: 'Link copied!', // TODO(alanorozco): i18n
      },
      {
        tag: 'div',
        attrs: dict({'class': 'i-amphtml-story-copy-url'}),
        text: url,
      },
    ],
  }));
}


/**
 * Social share widget for story bookend.
 */
export class BookendShareWidget {
  /** @param {!../../../src/service/ampdoc-impl.AmpDoc} ampdoc */
  constructor(ampdoc) {
    /** @private {!../../../src/service/ampdoc-impl.AmpDoc} */
    this.ampdoc_ = ampdoc;

    /** @private {!../../../src/service/platform-impl.Platform} */
    this.platform_ = Services.platformFor(this.ampdoc_.win);

    /** @private {!../../../src/service/viewer-impl.Viewer} */
    this.viewer_ = Services.viewerForDoc(this.ampdoc_);

    /** @private @const {!Window} */
    this.win_ = ampdoc.win;

    /** @private {?Element} */
    this.root_ = null;
  }

  /** @param {!../../../src/service/ampdoc-impl.AmpDoc} ampdoc */
  static create(ampdoc) {
    return new BookendShareWidget(ampdoc);
  }

  /** @return {!Element} */
  build() {
    dev().assert(!this.root_, 'Already built.');

    this.root_ = renderAsElement(this.win_.document, SHARE_LIST_TEMPLATE);

    this.maybeAddLinkShareButton_();
    this.maybeAddSystemShareButton_();

    return this.root_;
  }

  /** @private */
  maybeAddLinkShareButton_() {
    if (!isCopyingToClipboardSupported(this.win_.document)) {
      return;
    }

    this.add_(
        renderSimpleTemplate(this.win_.document, LINK_SHARE_ITEM_TEMPLATE));

    // TODO(alanorozco): Listen for proper tap event (i.e. fastclick)
    listen(
        dev().assertElement(
            scopedQuerySelector(
                this.root_, '.i-amphtml-story-share-icon-link')),
        'click',
        e => {
          e.preventDefault();
          this.copyUrlToClipboard_();
        });
  }

  maybeAddSystemShareButton_() {
    if (!this.isSystemShareSupported_()) {
      // `amp-social-share` will hide `system` buttons when unsupported, but
      // we also need to not add it at all for rendering reasons.
      return;
    }

    const container = scopedQuerySelector(dev().assertElement(this.root_),
        '.i-amphtml-story-share-system');

    container.appendChild(buildProvider(this.win_.document, 'system'));
  }

  /** @private */
  // NOTE(alanorozco): This is a duplicate of the logic in the
  // `amp-social-share` component.
  isSystemShareSupported_() {
    // Chrome exports navigator.share in WebView but does not implement it.
    // See https://bugs.chromium.org/p/chromium/issues/detail?id=765923
    const isChromeWebview = this.viewer_.isWebviewEmbedded() &&
        this.platform_.isChrome();

    return ('share' in navigator) && !isChromeWebview;
  }

  /** @private */
  // TODO(alanorozco): i18n for toast.
  copyUrlToClipboard_() {
    const url = Services.documentInfoForDoc(this.ampdoc_).canonicalUrl;

    if (copyToClipboard(this.win_.document, url)) {
      Toast.show(this.win_,
          buildCopySuccessfulToast(this.win_.document, url));
      return;
    }

    Toast.show(this.win_, 'Could not copy link to clipboard :(');
  }

  /**
   * @param {!Object<string, (!JsonObject|boolean)>} providers
   * @public
   */
  // TODO(alanorozco): Set story metadata in share config
  setProviders(providers) {
    this.loadRequiredExtensions_();

    Object.keys(providers).forEach(type => {
      if (type == 'system') {
        user().warn('AMP-STORY',
            '`system` is not a valid share provider type. Native sharing is ' +
            'enabled by default and cannot be turned off.',
            type);
        return;
      }

      if (isObject(providers[type])) {
        this.add_(buildProvider(this.win_.document, type,
            /** @type {!JsonObject} */ (providers[type])));
        return;
      }

      // Bookend config API requires real boolean, not just truthy
      if (providers[type] === true) {
        this.add_(buildProvider(this.win_.document, type));
        return;
      }

      user().warn('AMP-STORY',
          'Invalid amp-story bookend share configuration for %s. ' +
          'Value must be `true` or a params object.',
          type);
    });
  }

  /** @private */
  loadRequiredExtensions_() {
    Services.extensionsFor(this.win_)
        .installExtensionForDoc(this.ampdoc_, 'amp-social-share');
  }

  /**
   * @param {!Node} node
   * @private
   */
  add_(node) {
    const list = dev().assert(this.root_).firstElementChild;
    const item = renderAsElement(this.win_.document, SHARE_ITEM_TEMPLATE);

    item.appendChild(node);
    list.appendChild(item);
  }
}
