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
import {VideoEvents} from '../video-interface';
import {Services} from '../services';
import {VideoObservables} from './video-manager-behavior';
import {listen, listenOnce} from '../event-helper';
import {createElementWithAttributes, removeElement} from '../dom';
import {dev} from '../log';
import {getMode} from '../mode';
import {once} from '../utils/function';
import {getServiceForDoc, registerServiceBuilderForDoc} from '../service';
import {
  installPositionObserverServiceForDoc,
} from './position-observer/position-observer-impl';
import {isFiniteNumber} from '../types';
import {dict, map} from '../utils/object';
import {setStyles, setStyle} from '../style';


/**
 * Detects whether autoplay is supported.
 * Note that even if platfrom supports autoplay, users or browsers can disable
 * autoplay to save data / battery. This function detects both platfrom support
 * and when autoplay is disabled.
 *
 * Service dependencies are taken explicitly for testability.
 *
 * @param {!Window} win
 * @param {boolean} isLiteViewer
 * @return {!Promise<boolean>}
 * @private
 */
function detectSupportsAutoplay(win, isLiteViewer) {
  const doc = win.document;

  // We do not support autoplay in amp-lite viewer regardless of platform.
  if (isLiteViewer) {
    return Promise.resolve(false);
  }

  // To detect autoplay, we create a video element and call play on it, if
  // `paused` is true after `play()` call, autoplay is supported. Although
  // this is unintuitive, it works across browsers and is currently the lightest
  // way to detect autoplay without using a data source.
  const detectionElement = createElementWithAttributes(doc, 'video', dict({
    'muted': '',
    'playsinline': '',
    'webkit-playsinline': '',
    'height': '0',
    'width': '0',
  }));

  // NOTE(aghassemi): We need both attributes and properties due to Chrome and
  // Safari differences when dealing with non-attached elements.
  detectionElement.muted = true;
  detectionElement.playsinline = true;
  detectionElement.webkitPlaysinline = true;

  setStyles(detectionElement, {
    position: 'fixed',
    top: '0',
    width: '0',
    height: '0',
    opacity: '0',
  });

  Promise.resolve(detectionElement.play()).catch(() => {
    // Suppress any errors, useless to report as they are expected.
  });

  return Promise.resolve(!detectionElement.paused);
}


/**
 * @param {!Window} win
 * @param {boolean} isLiteViewer
 * @return {!Promise<boolean>}
 */
export let supportsAutoplay = once(detectSupportsAutoplay);


/** @visibleForTesting */
export function clearSupportsAutoplayCache() {
  supportsAutoplay = once(detectSupportsAutoplay);
}


const {call} = Function.prototype;


/** */
export class Autoplay {
  /**
   * @param {!Window} win
   * @param {} ampdoc
   * @param {} entry
   */
  constructor(win, ampdoc, entry) {
    // super(win, entry);

    const {video} = entry;

    /** @private @const {!Window} */
    this.win = win;

    /** @private @const {!../service/vsync-impl.Vsync} */
    this.vsync_ = Services.vsyncFor(ampdoc.win);

    /** @private @const {!../video-interface.VideoInterface} */
    this.video_ = video;

    /** @private @const {!function():(Element|undefined)} */
    this.icon_ = once(() => this.createIcon_());

    /** @private @const {!function():!Element} */
    this.mask_ = once(() => this.createMask_());
  }

  static get observables() {
    return [
      VideoObservables.VISIBILITY,
    ];
  }

  install(visibility) {
    const {element} = this.video_;

    const mask = this.mask_();
    const icon = this.icon_();

    const displayMask = setStyle.bind(null, mask, 'display');

    const onAdStart = displayMask.bind(null, 'none');
    const onAdEnd = displayMask.bind(null, 'block');

    const isPlaying = isPlaying => this.toggleIcon_(isPlaying);

    const unlisteners = [
      listenOnce(mask, 'click', () => this.onInteraction_()),
      listen(element, VideoEvents.PAUSE, () => isPlaying(false)),
      listen(element, VideoEvents.PLAYING, () => isPlaying(true)),
      listen(element, VideoEvents.AD_START, onAdStart),
      listen(element, VideoEvents.AD_END, onAdEnd),
      visibility.observe(isV => this.onVisibilityChanged_(isV)),
    ];

    element.whenBuilt().then(this.onVideoBuilt_.bind(this));

    return () => unlisteners.forEach(call);
  }

  /** @return {!Promise<boolean>} */
  isSupported_() {
    const {win} = this;
    const {lite} = getMode(win);
    return supportsAutoplay(win, lite);
  }

  /** @private */
  onVideoBuilt_() {
    const video = this.video_;

    // Hide controls until we know if autoplay is supported, otherwise hiding
    // and showing the controls quickly becomes a bad user experience for the
    // common case where autoplay is supported.
    if (video.isInteractive()) {
      video.hideControls();
    }

    this.isSupported_().then(isSupported => {
      if (!isSupported && video.isInteractive()) {
        // Autoplay is not supported, show the controls so user can manually
        // initiate playback.
        video.showControls();
        return;
      }

      // Only muted videos are allowed to autoplay
      video.mute();

      if (video.isInteractive()) {
        this.onInteractiveVideoBuilt_();
      }
    });
  }

   /**
   * Handles hiding controls, installing autoplay animation and handling
   * user interaction by unmuting and showing controls.
   * @private
   */
  onInteractiveVideoBuilt_() {
    const video = this.video_;
    const {element} = video;

    const icon = this.icon_();
    const mask = this.mask_();

    video.hideControls();

    this.vsync_.mutate(() => {
      element.appendChild(icon);
      element.appendChild(mask);
    });
  }

  /**
   * @param {boolean} isPlaying
   * @private
   */
  toggleIcon_(isPlaying) {
    const {classList} = this.icon_();
    if (!classList) {
      return;
    }
    this.vsync_.mutate(() => {
      classList.toggle('amp-video-eq-play', isPlaying);
    });
  }

  /** @private */
  onInteraction_() {
    const video = this.video_;

    const icon = this.icon_();
    const mask = this.mask_();

    this.userInteracted_ = true;

    video.showControls();
    video.unmute();

    removeElement(icon);
    removeElement(mask);
  }

  /** @return {!Promise} */
  visibilityWaitsFor() {
    return this.isSupported_().then();
  }

  /** @param {boolean} isVisible */
  onVisibilityChanged_(isVisible) {
    const video = this.video_;
    this.isSupported_().then(isSupported => {
      if (!isSupported) {
        return;
      }
      // TODO(alanorozco): This should be brokered by VideoEntry
      if (isVisible) {
        video.play(/* isAutoplay */ true);
      } else {
        video.pause(/* isAutoplay */ true);
      }
    });
  }

  /**
   * Creates a pure CSS animated equalizer icon.
   * @return {!Element}
   * @private
   */
  createIcon_() {
    const video = this.video_;

    if (!video.isInteractive()) {
      return;
    }

    const {win} = this;
    const doc = win.document;
    const platform = Services.platformFor(win);

    const fragment = doc.createDocumentFragment();

    const el = createElementWithAttributes(doc, 'i-amphtml-video-eq', dict({
      'class': 'amp-video-eq',
    }));

    // Columns for the equalizer.
    for (let i = 1; i <= 4; i++) {
      const column = createElementWithAttributes(doc, 'div', dict({
        'class': 'amp-video-eq-col',
      }));

      // Overlapping filler divs that animate at different rates creating
      // randomness illusion.
      for (let j = 1; j <= 2; j++) {
        column.appendChild(createElementWithAttributes(doc, 'div', dict({
          'class': `amp-video-eq-${i}-${j}`,
        })));
      }

      fragment.appendChild(column);
    }

    if (platform.isIos()) {
      // iOS can not pause hardware accelerated animations.
      el.setAttribute('unpausable', '');
    }

    el.appendChild(fragment);

    return el;
  }

  /**
   * Creates a mask overlya to detect the first user interaction. Required since
   * many players are iframe-based and thus we can't capture their click events.
   *
   * Checking `doc.activeElement` would be an unreliable hack, since an event
   * coming from an iframe would be untrusted, thus anything within its call
   * chain would be forbidden from unmuting a <video> (only user-initiated
   * events can).
   *
   * @return {!Element}
   * @private
   */
  // TODO(alanorozco): Check the above comment?
  createMask_() {
    const {ownerDocument} = this.video_.element;
    return createElementWithAttributes(ownerDocument, 'i-amphtml-video-mask',
      dict({
        'class': 'i-amphtml-fill-content',
      }));
  }
}
