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

import {
  VideoAnalyticsEvents,
  VideoAttributes,
  VideoEvents,
} from '../video-interface';
import {VideoObservables} from './video-manager-behavior';
import {dev} from '../log';
import {getMode} from '../mode';
import {supportsAutoplay} from './video-manager-autoplay';


const {call} = Function.prototype;


const FORWARD_PLAYBACK_EVENTS = {
  [VideoEvents.PAUSE]: VideoAnalyticsEvents.PAUSE,
  [VideoEvents.PLAYING]: VideoAnalyticsEvents.PLAYING,
  [VideoEvents.ENDED]: VideoAnalyticsEvents.ENDED,
};


export class VideoAnalytics {
  constructor(win, unusedAmpdoc, entry) {
    // super(win, entry);

    this.win = win;

    this.entry_ = entry;

    this.video_ = entry.video;

    this.isMuted_ = false;
  }

  static get observables() {
    return [
      VideoObservables.PLAYBACK,
      VideoObservables.ACTION_SESSION,
      VideoObservables.VISIBILITY_SESSION,
    ];
  }

  /** @return {!UnlistenDef} */
  install(playback, action, visibility) {
    const unlisteners = [
      playback.observe(e => this.onPlaybackEvent_(e)),
      action.onSessionEnd(() => this.event_(VideoAnalyticsEvents.SESSION)),
      visibility.onSessionEnd(() =>
          this.event_(VideoAnalyticsEvents.SESSION_VISIBLE)),
    ];

    return () => unlisteners.forEach(call);
  }

  onPlaybackEvent_(e) {
    if (e in FORWARD_PLAYBACK_EVENTS) {
      this.event_(FORWARD_PLAYBACK_EVENTS[e]);
      return;
    }
    switch(e) {
      case VideoEvents.MUTED:
        this.isMuted_ = true;
        break;
      case VideoEvents.UNMUTED:
        this.isMuted_ = false;
        break;
      default: dev().warn('VIDEO-ANALYTICS', 'Unknown VideoEvent %s', e);
    }
  }

  /**
   * Triggers an analytics event.
   * @param {!VideoAnalyticsEvents} eventType
   * @param {?../video-interface.VideoAnalyticsDetailsDef=} details
   */
  event_(eventType, details = null) {
    const video = this.video_;
    const {element} = video;

    Promise.resolve(details || this.getDetails_())
        .then(details => element.dispatchCustomEvent(eventType, details));
  }

  /** @private @return {!Promise<boolean>} */
  hasAutoplay_() {
    const {element} = this.video_;
    const {win} = this;
    const {lite} = getMode(win);
    return Promise.resolve(element.hasAttribute(VideoAttributes.AUTOPLAY) &&
        supportsAutoplay(win, lite));
  }

  /**
   * Collects a snapshot of the current video state for video analytics
   * @return {!Promise<!../video-interface.VideoAnalyticsDetailsDef>}
   */
  getDetails_() {
    return this.hasAutoplay_().then(hasAutoplay => {
      const video = this.video_;
      const {element} = video;
      const {id} = element;
      const {width, height} = element.getLayoutBox();
      const muted = this.isMuted_;
      const playedRanges = video.getPlayedRanges();
      const playedTotal = playedRanges.reduce(
          (acc, range) => acc + range[1] - range[0], 0);

      return {
        // TODO(cvializ): add fullscreen
        'autoplay': hasAutoplay,
        'currentTime': video.getCurrentTime(),
        'duration': video.getDuration(),
        'height': height,
        'id': id,
        'muted': muted,
        'playedTotal': playedTotal,
        'playedRangesJson': JSON.stringify(playedRanges),
        'state': this.entry_.getPlayingState(),
        'width': width,
      };
    });
  }
}
