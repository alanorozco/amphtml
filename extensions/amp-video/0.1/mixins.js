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
import {MediaPoolEvents} from '../../../extensions/amp-story/0.1/media-pool';
import {Services} from '../../../src/services';
import {VideoUtils} from '../../../src/utils/video';
import {
  createElementWithAttributes,
  fullscreenEnter,
  fullscreenExit,
  insertAfterOrAtStart,
  isFullscreenElement,
} from '../../../src/dom';
import {dev} from '../../../src/log';
import {dict} from '../../../src/utils/object';
import {getMode} from '../../../src/mode';
import {
  installVideoManagerForDoc,
} from '../../../src/service/video-manager-impl';
import {isExperimentOn} from '../../../src/experiments';
import {isLayoutSizeDefined} from '../../../src/layout';
import {listen} from '../../../src/event-helper';
import {toArray} from '../../../src/types';
import {setImportantStyles} from '../../../src/style';


/** @interface @package */
export class AmpVideoMixin {
  /**
   * Creates a base node onto which attributes will be propagated.
   * @return {!Element}
   */
  createBaseNode() {}

  /**
   * Appends a set of sources to the video element. An `Element` can be passed
   * for a single source, a `DocumentFragment` for many.
   * @param {!Node} node
   */
  appendSources(node) {}

  /** Installs event handlers. */
  installEventHandlers(unusedEventsToForward, unusedSetMuted) {}

  /**
   * Returns a promise that resolves when the video has started to load.
   * @return {!Promise<*>}
   */
  whenLoadStarts() {}

  /** @return {boolean} */
  isVideoSupported() {}

  /** @return {!Promise|undefined} */
  pause() {}

  /** @return {!Promise|undefined} */
  play() {}

  /**
   * Toggles video's mute state.
   * @param {boolean} unusedMuted
   * @return {!Promise|undefined}
   */
  toggleMuted(unusedMuted) {}

  /**
   * Toggles video's controls.
   * @param {boolean} unusedShow
   * @return {!Promise|undefined}
   */
  toggleControls(unusedShow) {}

  /** */
  fullscreenEnter() {}

  /** */
  fullscreenExit() {}

  /** @return {boolean} */
  isFullscreen() {}

  /** @return {number} */
  getCurrentTime() {}

  /** @return {number} */
  getDuration() {}

  /** @return {!Array<!Array<number>>} */
  getPlayedRanges() {}
}


/** @implements {AmpVideoMixin} */
export class VideoElementMixin {
  /**
   * @param {!./amp-video.AmpVideo} impl
   */
  constructor(impl) {
    /** @protected @const {!./amp-video.AmpVideo} */
    // TODO(alanorozco): Make private
    this.impl = impl;

    /** @protected {?HTMLMediaElement} */
    // TODO(alanorozco): Make private
    this.video = null;
  }

  isVideoSupported() {
    return !!this.video.play;
  }

  /** @override */
  createBaseNode() {
    const {element} = this.impl;
    const {ownerDocument} = element;

    this.video =
        /** @type {!HTMLMediaElement} */ (ownerDocument.createElement('video'));

    this.impl.getVsync().mutate(() => {
      element.appendChild(this.video);
    });

    return this.video;
  }

  /** @override */
  installEventHandlers(eventsToForward, setMuted) {
    const video = dev().assertElement(this.video);

    this.impl.forwardEvents(eventsToForward, video);

    listen(video, 'volumechange', e => {
      setMuted(video.muted);
    });
  }

  /** @override */
  appendSources(fragment) {
    this.video.appendChild(fragment);
  }

  /** @override */
  whenLoadStarts() {
    // loadPromise for media elements listens to `loadstart`
    return this.impl.loadPromise(this.video);
  }

  /** @override */
  play() {
    new Promise(() => this.video.play()).catch(() => {
      // Empty catch to prevent useless unhandled promise rejection logging.
      // Play can fail for many reasons such as video getting paused before
      // play() is finished.
      // We use events to know the state of the video and do not care about
      // the success or failure of the play()'s returned promise.
    });
  }

  /** @override */
  pause() {
    this.video.pause();
  }

  /** @override */
  toggleMuted(muted) {
    this.video.muted = muted;
  }

  /** @override */
  toggleControls(show) {
    this.video.controls = show;
  }

  /**
   * @override
   */
  fullscreenEnter() {
    fullscreenEnter(dev().assertElement(this.video));
  }

  /**
   * @override
   */
  fullscreenExit() {
    fullscreenExit(dev().assertElement(this.video));
  }

  /** @override */
  isFullscreen() {
    return isFullscreenElement(dev().assertElement(this.video));
  }

  /** @override */
  getCurrentTime() {
    return this.video.currentTime;
  }

  /** @override */
  getDuration() {
    return this.video.duration;
  }

  /** @override */
  getPlayedRanges() {
    return VideoUtils.getPlayedRanges(this.video);
  }
}


/** @implements {AmpVideoMixin} */
// TODO(alanorozco): This mixin should not inherit from `VideoElementMixin`.
// This is blocked by mediapool control coming from `AmpStoryPage`.
export class MediaPoolVideoMixin extends VideoElementMixin {

  /** @param {!./amp-video.AmpVideo} impl */
  constructor(impl) {
    super(impl);

    /** @private {?Promise<!Element>} */
    this.placeholder_ = null;

    /** @private {boolean} */
    this.isAllocated_ = false;

    /** @private {?../../amp-story/0.1/media-pool.MediaPool} */
    this.mediaPool_ = null;

    /** @private {?../../amp-story/0.1/media-pool.MediaInfoDef} */
    this.mediaInfo_ =
        {duration: 0, currentTime: 0, paused: true, playedRanges: []};

    /** @private @const {!Promise<!../../amp-story/0.1/media-pool.MediaPool>} */
    this.mediaPoolPromise_ = Services.mediaPoolFor(impl.element).then(pool => {
      this.mediaPool_ = pool;
      return pool;
    });
  }

  /** @override */
  isVideoSupported() {
    return true; // Assumption.
  }

  /** @override */
  installEventHandlers(unusedEventsToForward, setMuted) {
    // No need to forward events as MediaPool re-dispatches all playback events
    // from parent element.

    const {element} = this.impl;

    listen(element, MediaPoolEvents.ALLOCATED, () => {
      this.isAllocated_ = true;
      this.hidePlaceholder();
    });

    listen(element, MediaPoolEvents.DEALLOCATED, mediaInfo => {
      this.isAllocated_ = false;
      this.mediaInfo_ = mediaInfo;
      debugger;
      this.showPlaceholder();
    });

    listen(element, 'volumechange', e => {
      const {muted} = e;
      setMuted(muted);
    });
  }

  /** @private */
  isEnabled() {
    return this.isAllocated_;
  }

  /** @visibleForTesting */
  showPlaceholder() {
    if (this.placeholder_) {
      this.togglePlaceholder_(/* show */ false);
      return this.placeholder_;
    }
    const {element} = this.impl;
    const posterSrc = dev().assertString(element.getAttribute('poster'));

    const img = new Image();
    const {win} = this.impl;

    const placeholder = createElementWithAttributes(win.document, 'div', dict({
      'class': 'i-amphtml-placeholder',
    }));

    img.src = posterSrc;

    this.placeholder_ = this.impl.loadPromise(img).then(() => {
      this.impl.getVsync().mutate(() => {
        setImportantStyles(placeholder, {
          'background': `url(${src}) no-repeat center center`,
        });
        this.impl.applyFillContent(placeholder);
        element.appendChild(placeholder);
      });
      return placeholder;
    });

    return this.placeholder_;
  }

  /** @visibleForTesting */
  hidePlaceholder() {
    this.togglePlaceholder_(/* show */ false);
  }

  /**
   * @param {boolean} show
   * @private
   */
  togglePlaceholder_(show) {
    if (!this.placeholder_) {
      return;
    }
    this.placeholder_.then(placeholder => getVsync().mutate(() => {
      if (show) {
        resetStyles(placeholder, ['display']);
      } else {
        this.placeholder_.then(placeholder => getVsync().mutate(() => {
          setImportantStyles(placeholder, {'display': 'none'});
        }));
      }
    }));
  }

  /** @override */
  whenLoadStarts() {
    if (!this.isAllocated_) {
      // Return placeholder promise if not allocated so that there is at least
      // one signal available for `layoutCallback`.
      return this.showPlaceholder();
    }
    return this.impl.loadPromise(this.video);
  }

  /** @override */
  play() {
    const video =
        /** @type {!HTMLMediaElement} */ (dev().assertElement(this.video));
    return this.mediaPoolPromise_.then(mediaPool =>
      mediaPool.play(video));
  }

  /** @override */
  pause() {
    const video =
        /** @type {!HTMLMediaElement} */ (dev().assertElement(this.video));
    return this.mediaPoolPromise_.then(mediaPool =>
      mediaPool.pause(video));
  }

  /** @override */
  toggleMuted(muted) {
    this.mediaPoolPromise_.then(pool =>
      pool.toggleMuted(muted));
  }

  /** @override */
  toggleControls(show) {
    this.mediaPoolPromise_.then(pool =>
      pool.toggleControls(show));
  }

  /** @override */
  fullscreenEnter() {
    // NOOP
  }

  /** @override */
  fullscreenExit() {
    // NOOP
  }

  /** @override */
  isFullscreen() {
    return false;
  }

  /** @override */
  getDuration() {
    return this.getMediaInfo_('duration');
  }

  /** @override */
  getPlayedRanges() {
    return this.getMediaInfo_('playedRanges');
  }

  /** @override */
  getCurrentTime() {
    return this.getMediaInfo_('currentTime');
  }

  /**
   * @param {string} property
   * @private
   */
  // TODO(alanorozco): This seems like logic that belongs in mediapool. Expose
  // a synchronous method.
  getMediaInfo_(property) {
    if (!this.isAllocated_) {
      return this.mediaInfo_[property];
    }
    const video =
        /** @type {!HTMLMediaElement} */ (dev().assertElement(this.video));
    return this.mediaPool_.getMediaInfo(video, property);
  }
}
