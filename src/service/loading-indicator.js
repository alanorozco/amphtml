/**
 * Copyright 2020 The AMP HTML Authors. All Rights Reserved.
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

import {createLoaderElement} from './loader-element';
import {createViewportObserver} from '../viewport-observer';
import {htmlFor} from '../static-template';
import {registerServiceBuilderForDoc} from '../service';
import {removeElement} from '../dom';

const MIN_SIZE = 20;

/**
 * @typedef {{
 *   shown: boolean,
 *   loader: !Element,
 *   container: !Element,
 * }}
 */
let LoadingIndicatorStateDef;

/**
 * @param {!Node|!./ampdoc-impl.AmpDoc} nodeOrDoc
 */
export function installLoadingIndicatorForDoc(nodeOrDoc) {
  registerServiceBuilderForDoc(
    nodeOrDoc,
    'loadingIndicator',
    LoadingIndicatorImpl
  );
}

/**
 * @implements {../service.Disposable}
 */
export class LoadingIndicatorImpl {
  /**
   * @param {!./ampdoc-impl.AmpDoc} ampdoc
   */
  constructor(ampdoc) {
    /** @private @const */
    this.ampdoc_ = ampdoc;

    const {win} = ampdoc;
    const inViewport = this.inViewport_.bind(this);
    const ioCallback = (records) =>
      /** @type {!Array<!IntersectionObserverEntry>} */ (records).forEach(
        inViewport
      );
    /** @private @const {!IntersectionObserver} */
    this.io_ = createViewportObserver(ioCallback, win);

    /** @private @const {!WeakMap<!AmpElement, !LoadingIndicatorStateDef>} */
    this.states_ = new WeakMap();
  }

  /** @override */
  dispose() {
    this.io_.disconnect();
  }

  /**
   * @param {!AmpElement} element
   */
  track(element) {
    this.io_.observe(element);
  }

  /**
   * @param {!AmpElement} element
   */
  untrack(element) {
    this.io_.unobserve(element);
    this.cleanup_(element);
  }

  /**
   * @param {!IntersectionObserverEntry} record
   * @private
   */
  inViewport_(record) {
    const {target, isIntersecting, boundingClientRect} = record;
    const {width, height} = boundingClientRect;
    const element = /** @type {!AmpElement} */ (target);

    const show = isIntersecting && width > MIN_SIZE && height > MIN_SIZE;

    let state = this.states_.get(element);
    const isCurrentlyShown = (state && state.shown) || false;
    if (show === isCurrentlyShown) {
      // Loading state is the same.
      return;
    }

    if (show && !state) {
      state = this.createLoaderState_(element, width, height);
      this.states_.set(element, state);
    }
    if (state) {
      state.shown = show;
      state.container.classList.toggle('amp-hidden', !show);
      state.loader.classList.toggle('amp-active', show);
    }
  }

  /**
   * @param {!AmpElement} element
   * @param {number} width
   * @param {number} height
   * @return {!LoadingIndicatorStateDef}
   * @private
   */
  createLoaderState_(element, width, height) {
    const startTime = Date.now();

    const loader = createLoaderElement(
      this.ampdoc_,
      element,
      width,
      height,
      startTime
    );

    const html = htmlFor(this.ampdoc_.win.document);
    const container = html`
      <div
        slot="i-amphtml-svc"
        class="i-amphtml-svc i-amphtml-loading-container i-amphtml-fill-content
            amp-hidden"
      ></div>
    `;
    container.appendChild(loader);
    element.appendChild(container);

    return /** @type {!LoadingIndicatorStateDef} */ ({
      shown: false,
      loader,
      container,
    });
  }

  /**
   * @param {!AmpElement} element
   * @private
   */
  cleanup_(element) {
    const state = this.states_.get(element);
    if (!state) {
      return;
    }

    this.states_.delete(element);
    removeElement(state.container);
  }
}
