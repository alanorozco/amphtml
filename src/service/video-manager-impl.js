
/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
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

import {ActionTrust} from '../action-trust';
import {
  EMPTY_METADATA,
  parseFavicon,
  parseOgImage,
  parseSchemaImage,
  setMediaSession,
} from '../mediasession-helper';
import {
  PlayingStates,
  VideoAnalyticsEvents,
  VideoAttributes,
  VideoEvents,
} from '../video-interface';
import {Services} from '../services';
import {VideoServiceSync} from './video-service-sync-impl';
import {VideoSessionManager} from './video-session-manager';
import {VideoUtils} from '../utils/video';
import {
  createCustomEvent,
  getData,
  listen,
  listenOncePromise,
} from '../event-helper';
import {dev} from '../log';
import {getMode} from '../mode';
import {isFiniteNumber} from '../types';
import {map} from '../utils/object';
import {
  maybeInstallIntersectionObserver,
} from 'intersection-observer/intersection-observer.install';
import {once} from '../utils/function';
import {registerServiceBuilderForDoc} from '../service';
import {removeElement} from '../dom';
import {setStyles} from '../style';
import {startsWith} from '../string';

/** @private @const {string} */
const TAG = 'video-manager';


/** @typedef {../video-interface.VideoAnalyticsDetailsDef} */
let VideoAnalyticsDef; // alias for line length


/**
 * Classname indicating that a video component has been "blessed" via user
 * interaction.
 * @private @const {string}
 */
const BLESSED = 'i-amphtml-blessed';


/** @private @enum {string} */
const Signals = {
  BLESSED: 'blessed',
};


/** @interface */
export class VideoService {

  /** @param {!../video-interface.VideoInterface} unusedVideo */
  register(unusedVideo) {}

  /**
   * Gets the current analytics details for the given video.
   * Fails silently if the video is not registered.
   * @param {!AmpElement} unusedVideo
   * @return {!Promise<!VideoAnalyticsDef>|!Promise<void>}
   */
  getAnalyticsDetails(unusedVideo) {}

  /**
   * Delegates autoplay.
   * @param {!AmpElement} unusedVideo
   * @param {!../observable.Observable<boolean>=} opt_unusedObservable
   *    If provided, video will be played or paused when this observable fires.
   */
  delegateAutoplay(unusedVideo, opt_unusedObservable) {}
}


/**
 * @const {number} Percentage of the video that should be in viewport before it
 * is considered visible.
 */
const VISIBILITY_PERCENT = 75;

/**
 * @private {number} The minimum number of milliseconds to wait between each
 * video-seconds-played analytics event.
 */
const SECONDS_PLAYED_MIN_DELAY = 1000;


/**
 * VideoManager keeps track of all AMP video players that implement
 * the common Video API {@see ../video-interface.VideoInterface}.
 *
 * It is responsible for providing a unified user experience and analytics for
 * all videos within a document.
 *
 * @implements {VideoService}
 */
export class VideoManager {

  /**
   * @param {!./ampdoc-impl.AmpDoc} ampdoc
   */
  constructor(ampdoc) {

    /** @const {!./ampdoc-impl.AmpDoc}  */
    this.ampdoc = ampdoc;

    /** @private {!../service/viewport/viewport-impl.Viewport} */
    this.viewport_ = Services.viewportForDoc(this.ampdoc);

    /** @private {?Array<!VideoEntry>} */
    this.entries_ = null;

    /** @private {boolean} */
    this.scrollListenerInstalled_ = false;

    /** @private {boolean} */
    this.resizeListenerInstalled_ = false;

    /** @private @const */
    this.timer_ = Services.timerFor(ampdoc.win);

    /** @private @const */
    this.actions_ = Services.actionServiceForDoc(ampdoc);

    /** @private @const */
    this.boundSecondsPlaying_ = () => this.secondsPlaying_();

    /** @public @const {function():!Rot82xManager} */
    this.getRot82xManager = once(() => this.createRot82xManager_());

    // TODO(cvializ, #10599): It would be nice to only create the timer
    // if video analytics are present, since the timer is not needed if
    // video analytics are not present.
    this.timer_.delay(this.boundSecondsPlaying_, SECONDS_PLAYED_MIN_DELAY);
  }

  /**
   * Each second, trigger video-seconds-played for videos that are playing
   * at trigger time.
   * @private
   */
  secondsPlaying_() {
    for (let i = 0; i < this.entries_.length; i++) {
      const entry = this.entries_[i];
      if (entry.getPlayingState() !== PlayingStates.PAUSED) {
        analyticsEvent(entry, VideoAnalyticsEvents.SECONDS_PLAYED);
        this.timeUpdateActionEvent_(entry);
      }
    }
    this.timer_.delay(this.boundSecondsPlaying_, SECONDS_PLAYED_MIN_DELAY);
  }

  /** @private @return {!Rot82xManager} */
  createRot82xManager_() {
    return new Rot82xManager(this.ampdoc);
  }

  /**
   * Triggers a LOW-TRUST timeupdate event consumable by AMP actions.
   * Frequency of this event is controlled by SECONDS_PLAYED_MIN_DELAY and is
   * every 1 second for now.
   * @private
   */
  timeUpdateActionEvent_(entry) {
    const name = 'timeUpdate';
    const currentTime = entry.video.getCurrentTime();
    const duration = entry.video.getDuration();
    if (isFiniteNumber(currentTime) &&
        isFiniteNumber(duration) &&
        duration > 0) {
      const perc = currentTime / duration;
      const event = createCustomEvent(this.ampdoc.win, `${TAG}.${name}`,
          {time: currentTime, percent: perc});
      this.actions_.trigger(entry.video.element, name, event, ActionTrust.LOW);
    }
  }

  /** @override */
  register(video) {
    dev().assert(video);

    this.registerCommonActions_(video);

    if (!video.supportsPlatform()) {
      return;
    }

    this.entries_ = this.entries_ || [];
    const entry = new VideoEntry(this, video);
    this.maybeInstallVisibilityObserver_(entry);
    this.entries_.push(entry);
    video.element.dispatchCustomEvent(VideoEvents.REGISTERED);

    // Add a class to element to indicate it implements the video interface.
    video.element.classList.add('i-amphtml-video-interface');
  }

  /** @override */
  delegateAutoplay(videoElement, opt_unusedObservable) {
    videoElement.signals().whenSignal(VideoEvents.REGISTERED).then(() => {
      const entry = this.getEntryForElement_(videoElement);
      entry.delegateAutoplay();
    });
  }

  /**
   * Register common actions such as play, pause, etc... on the video element
   * so they can be called using AMP Actions.
   * For example: <button on="tap:myVideo.play">
   *
   * @param {!../video-interface.VideoInterface} video
   * @private
   */
  registerCommonActions_(video) {
    // Only require ActionTrust.LOW for video actions to defer to platform
    // specific handling (e.g. user gesture requirement for unmuted playback).
    video.registerAction('play',
        video.play.bind(video, /* isAutoplay */ false), ActionTrust.LOW);
    video.registerAction('pause', video.pause.bind(video), ActionTrust.LOW);
    video.registerAction('mute', video.mute.bind(video), ActionTrust.LOW);
    video.registerAction('unmute', video.unmute.bind(video), ActionTrust.LOW);
    video.registerAction('fullscreen', video.fullscreenEnter.bind(video),
        ActionTrust.LOW);
  }

  /**
   * Install the necessary listeners to be notified when a video becomes visible
   * in the viewport.
   *
   * Visibility of a video is defined by being in the viewport AND having
   * {@link VISIBILITY_PERCENT} of the video element visible.
   *
   * @param {VideoEntry} entry
   * @private
   */
  maybeInstallVisibilityObserver_(entry) {
    listen(entry.video.element, VideoEvents.VISIBILITY, details => {
      const data = getData(details);
      if (data && data['visible'] == true) {
        entry.updateVisibility(/* opt_forceVisible */ true);
      } else {
        entry.updateVisibility();
      }
    });

    listen(entry.video.element, VideoEvents.RELOAD, () => {
      entry.videoLoaded();
    });

    // TODO(aghassemi, #6425): Use IntersectionObserver
    if (!this.scrollListenerInstalled_) {
      const scrollListener = () => {
        for (let i = 0; i < this.entries_.length; i++) {
          this.entries_[i].updateVisibility();
        }
      };
      this.viewport_.onScroll(scrollListener);
      this.viewport_.onChanged(scrollListener);
      this.scrollListenerInstalled_ = true;
    }
  }

  /**
   * Returns the entry in the video manager corresponding to the video
   * provided
   *
   * @param {!../video-interface.VideoInterface} video
   * @return {VideoEntry} entry
   * @private
   */
  getEntryForVideo_(video) {
    for (let i = 0; i < this.entries_.length; i++) {
      if (this.entries_[i].video === video) {
        return this.entries_[i];
      }
    }
    dev().error(TAG, 'video is not registered to this video manager');
    return null;
  }

  /**
   * Returns the entry in the video manager corresponding to the element
   * provided
   *
   * @param {!AmpElement} element
   * @return {VideoEntry} entry
   * @private
   */
  getEntryForElement_(element) {
    for (let i = 0; i < this.entries_.length; i++) {
      const entry = this.entries_[i];
      if (entry.video.element === element) {
        return entry;
      }
    }
    dev().error(TAG, 'video is not registered to this video manager');
    return null;
  }

  /** @override */
  getAnalyticsDetails(videoElement) {
    const entry = this.getEntryForElement_(videoElement);
    return entry ? entry.getAnalyticsDetails() : Promise.resolve();
  }

  /**
   * Returns whether the video is paused or playing after the user interacted
   * with it or playing through autoplay
   *
   * @param {!../video-interface.VideoInterface} video
   * @return {!../video-interface.VideoInterface} PlayingStates
   */
  getPlayingState(video) {
    return this.getEntryForVideo_(video).getPlayingState();
  }

  /**
   * Returns whether the video was interacted with or not
   *
   * @param {!../video-interface.VideoInterface} video
   * @return {boolean}
   */
  userInteractedWithAutoPlay(video) {
    return this.getEntryForVideo_(video).userInteractedWithAutoPlay();
  }
}

/**
 * VideoEntry represents an entry in the VideoManager's list.
 */
class VideoEntry {
  /**
   * @param {!VideoManager} manager
   * @param {!../video-interface.VideoInterface} video
   */
  constructor(manager, video) {
    /** @private @const {!VideoManager} */
    this.manager_ = manager;

    /** @private @const {!./ampdoc-impl.AmpDoc}  */
    this.ampdoc_ = manager.ampdoc;

    /** @private {!../service/viewport/viewport-impl.Viewport} */
    this.viewport_ = Services.viewportForDoc(this.ampdoc_);

    /** @package @const {!../video-interface.VideoInterface} */
    this.video = video;

    /** @private {boolean} */
    this.allowAutoplay_ = true;

    /** @private {?Element} */
    this.autoplayAnimation_ = null;

    /** @private {boolean} */
    this.loaded_ = false;

    /** @private {boolean} */
    this.isPlaying_ = false;

    /** @private {boolean} */
    this.isVisible_ = false;

    /** @private @const {!../service/vsync-impl.Vsync} */
    this.vsync_ = Services.vsyncFor(this.ampdoc_.win);

    /** @private @const */
    this.actionSessionManager_ = new VideoSessionManager();

    this.actionSessionManager_.onSessionEnd(
        () => analyticsEvent(this, VideoAnalyticsEvents.SESSION));

    /** @private @const */
    this.visibilitySessionManager_ = new VideoSessionManager();

    this.visibilitySessionManager_.onSessionEnd(
        () => analyticsEvent(this, VideoAnalyticsEvents.SESSION_VISIBLE));

    /** @private @const {function(): !Promise<boolean>} */
    this.supportsAutoplay_ = () => {
      const {win} = this.ampdoc_;
      return VideoUtils.isAutoplaySupported(win, getMode(win).lite);
    };

    const element = dev().assert(video.element);

    // Autoplay Variables

    /** @private {boolean} */
    this.userInteractedWithAutoPlay_ = false;

    /** @private {boolean} */
    this.playCalledByAutoplay_ = false;

    /** @private {boolean} */
    this.pauseCalledByAutoplay_ = false;

    /** @private {?Element} */
    this.internalElement_ = null;

    /** @private {boolean} */
    this.muted_ = false;

    this.hasAutoplay = element.hasAttribute(VideoAttributes.AUTOPLAY);

    // Media Session API Variables

    /** @private {!../mediasession-helper.MetadataDef} */
    this.metadata_ = EMPTY_METADATA;

    listenOncePromise(element, VideoEvents.LOAD)
        .then(() => this.videoLoaded());
    listen(element, VideoEvents.PAUSE, () => this.videoPaused_());
    listen(element, VideoEvents.PLAYING, () => this.videoPlayed_());
    listen(element, VideoEvents.MUTED, () => this.muted_ = true);
    listen(element, VideoEvents.UNMUTED, () => this.muted_ = false);
    listen(element, VideoEvents.ENDED, () => this.videoEnded_());

    element.whenBuilt().then(() => this.onBuilt_());
  }

  /** Delegates autoplay to a different module. */
  delegateAutoplay() {
    this.allowAutoplay_ = false;

    if (this.isPlaying_) {
      this.video.pause();
    }
  }

  /** @private */
  onBuilt_() {
    const {element} = this.video;

    // Unlike events, signals are permanent. We can wait for `REGISTERED` at any
    // moment in the element's lifecycle and the promise will resolve
    // appropriately each time.
    this.signal_(VideoEvents.REGISTERED);

    if (this.hasFullscreenOnLandscape_()) {
      this.manager_.getRot82xManager().register(element, this);
    }

    this.updateVisibility();
    if (this.hasAutoplay) {
      this.autoplayVideoBuilt_();
    }
  }

  /**
   * @retun {boolean}
   * @private
   */
  hasFullscreenOnLandscape_() {
    const {element} = this.video;
    return element.hasAttribute(VideoAttributes.ROT82X);
  }

  /**
   * Callback for when the video starts playing
   * @private
   */
  videoPlayed_() {
    this.isPlaying_ = true;

    if (!this.hasAutoplay) {
      this.markBlessed_();
    }

    if (!this.video.preimplementsMediaSessionAPI()) {
      const playHandler = () => {
        this.video.play(/*isAutoplay*/ false);
      };
      const pauseHandler = () => {
        this.video.pause();
      };
      // Update the media session
      setMediaSession(
          this.ampdoc_.win,
          this.metadata_,
          playHandler,
          pauseHandler
      );
    }

    this.actionSessionManager_.beginSession();
    if (this.isVisible_) {
      this.visibilitySessionManager_.beginSession();
    }
    analyticsEvent(this, VideoAnalyticsEvents.PLAY);
  }

  /**
   * Callback for when the video has been paused
   * @private
   */
  videoPaused_() {
    analyticsEvent(this, VideoAnalyticsEvents.PAUSE);
    this.isPlaying_ = false;

    // Prevent double-trigger of session if video is autoplay and the video
    // is paused by a the user scrolling the video out of view.
    if (!this.pauseCalledByAutoplay_) {
      this.actionSessionManager_.endSession();
    } else {
      // reset the flag
      this.pauseCalledByAutoplay_ = false;
    }
  }

  /**
   * Callback for when the video has ended
   * @private
   */
  videoEnded_() {
    analyticsEvent(this, VideoAnalyticsEvents.ENDED);
  }

  /**
   * Called when the video is loaded and can play.
   */
  videoLoaded() {
    this.loaded_ = true;

    // Get the internal element (the actual video/iframe)
    this.internalElement_ = this.video.element.querySelector('video, iframe');

    this.fillMediaSessionMetadata_();

    this.updateVisibility();
    if (this.isVisible_) {
      // Handles the case when the video becomes visible before loading
      this.loadedVideoVisibilityChanged_();
    }
  }

  /**
   * Gets the provided metadata and fills in missing fields
   * @private
   */
  fillMediaSessionMetadata_() {
    if (this.video.preimplementsMediaSessionAPI()) {
      return;
    }

    if (this.video.getMetadata()) {
      this.metadata_ = map(
          /** @type {!../mediasession-helper.MetadataDef} */
          (this.video.getMetadata())
      );
    }

    const doc = this.ampdoc_.win.document;

    if (!this.metadata_.artwork || this.metadata_.artwork.length == 0) {
      const posterUrl = parseSchemaImage(doc)
                        || parseOgImage(doc)
                        || parseFavicon(doc);

      if (posterUrl) {
        this.metadata_.artwork = [{
          'src': posterUrl,
        }];
      }
    }

    if (!this.metadata_.title) {
      const title = this.video.element.getAttribute('title')
                    || this.video.element.getAttribute('aria-label')
                    || this.internalElement_.getAttribute('title')
                    || this.internalElement_.getAttribute('aria-label')
                    || doc.title;
      if (title) {
        this.metadata_.title = title;
      }
    }
  }

  /**
   * Called when visibility of a video changes.
   * @private
   */
  videoVisibilityChanged_() {
    if (this.loaded_) {
      this.loadedVideoVisibilityChanged_();
    }
  }

  /**
   * Only called when visibility of a loaded video changes.
   * @private
   */
  loadedVideoVisibilityChanged_() {
    if (!Services.viewerForDoc(this.ampdoc_).isVisible()) {
      return;
    }

    this.supportsAutoplay_().then(supportsAutoplay => {
      const canAutoplay = this.hasAutoplay && !this.userInteractedWithAutoPlay_;

      if (canAutoplay && supportsAutoplay) {
        this.autoplayLoadedVideoVisibilityChanged_();
      } else {
        this.nonAutoplayLoadedVideoVisibilityChanged_();
      }
    });
  }

  /* Autoplay Behaviour */

  /**
   * Called when an autoplay video is built.
   * @private
   */
  autoplayVideoBuilt_() {

    // Hide controls until we know if autoplay is supported, otherwise hiding
    // and showing the controls quickly becomes a bad user experience for the
    // common case where autoplay is supported.
    if (this.video.isInteractive()) {
      this.video.hideControls();
    }

    this.supportsAutoplay_().then(supportsAutoplay => {
      if (!supportsAutoplay && this.video.isInteractive()) {
        // Autoplay is not supported, show the controls so user can manually
        // initiate playback.
        this.video.showControls();
        return;
      }

      // Only muted videos are allowed to autoplay
      this.video.mute();

      if (this.video.isInteractive()) {
        this.autoplayInteractiveVideoBuilt_();
      }
    });
  }

  /**
   * Called by autoplayVideoBuilt_ when an interactive autoplay video is built.
   * It handles hiding controls, installing autoplay animation and handling
   * user interaction by unmuting and showing controls.
   * @private
   */
  autoplayInteractiveVideoBuilt_() {
    const toggleAnimation = playing => {
      this.vsync_.mutate(() => {
        animation.classList.toggle('amp-video-eq-play', playing);
      });
    };

    // Hide the controls.
    this.video.hideControls();

    // Create autoplay animation and the mask to detect user interaction.
    const animation = this.createAutoplayAnimation_();
    const mask = this.createAutoplayMask_();
    this.vsync_.mutate(() => {
      this.video.element.appendChild(animation);
      this.video.element.appendChild(mask);
    });

    // Listen to pause, play and user interaction events.
    const unlisteners = [];
    unlisteners.push(listen(mask, 'click', onInteraction.bind(this)));
    unlisteners.push(listen(animation, 'click', onInteraction.bind(this)));

    unlisteners.push(listen(this.video.element, VideoEvents.PAUSE,
        toggleAnimation.bind(this, /*playing*/ false)));

    unlisteners.push(listen(this.video.element, VideoEvents.PLAYING,
        toggleAnimation.bind(this, /*playing*/ true)));

    unlisteners.push(listen(this.video.element, VideoEvents.AD_START,
        adStart.bind(this)));

    unlisteners.push(listen(this.video.element, VideoEvents.AD_END,
        adEnd.bind(this)));

    function onInteraction() {
      this.markBlessed_();
      this.userInteractedWithAutoPlay_ = true;
      this.video.showControls();
      this.video.unmute();
      unlisteners.forEach(unlistener => {
        unlistener();
      });
      removeElement(animation);
      removeElement(mask);
    }

    function adStart() {
      setStyles(mask, {
        'display': 'none',
      });
    }

    function adEnd() {
      setStyles(mask, {
        'display': 'block',
      });
    }
  }

  /** @private */
  markBlessed_() {
    const {element} = this.video;
    this.signal_(Signals.BLESSED);
    element.classList.add(BLESSED);
  }

  /**
   * @param {string} signal
   * @private
   */
  signal_(signal) {
    const {element} = this.video;
    element.signals().signal(signal);
  }

  /**
   * Called when visibility of a loaded autoplay video changes.
   * @private
   */
  autoplayLoadedVideoVisibilityChanged_() {
    if (!this.allowAutoplay_) {
      return;
    }
    if (this.isVisible_) {
      this.visibilitySessionManager_.beginSession();
      this.video.play(/*autoplay*/ true);
      this.playCalledByAutoplay_ = true;
    } else {
      if (this.isPlaying_) {
        this.visibilitySessionManager_.endSession();
      }
      this.video.pause();
      this.pauseCalledByAutoplay_ = true;
    }
  }

  /**
   * Called when visibility of a loaded non-autoplay video changes.
   * @private
   */
  nonAutoplayLoadedVideoVisibilityChanged_() {
    if (this.isVisible_) {
      this.visibilitySessionManager_.beginSession();
    } else if (this.isPlaying_) {
      this.visibilitySessionManager_.endSession();
    }
  }

  /**
   * Creates a pure CSS animated equalizer icon.
   * @private
   * @return {!Element}
   */
  createAutoplayAnimation_() {
    const doc = this.ampdoc_.win.document;
    const anim = doc.createElement('i-amphtml-video-eq');
    anim.classList.add('amp-video-eq');
    // Four columns for the equalizer.
    for (let i = 1; i <= 4; i++) {
      const column = doc.createElement('div');
      column.classList.add('amp-video-eq-col');
      // Two overlapping filler divs that animate at different rates creating
      // randomness illusion.
      for (let j = 1; j <= 2; j++) {
        const filler = doc.createElement('div');
        filler.classList.add(`amp-video-eq-${i}-${j}`);
        column.appendChild(filler);
      }
      anim.appendChild(column);
    }
    const platform = Services.platformFor(this.ampdoc_.win);
    if (platform.isIos()) {
      // iOS can not pause hardware accelerated animations.
      anim.setAttribute('unpausable', '');
    }
    return anim;
  }

  /**
   * Creates a mask to overlay on top of an autoplay video to detect the first
   * user tap.
   * We have to do this since many players are iframe-based and we can not get
   * the click event from the iframe.
   * We also can not rely on hacks such as constantly checking doc.activeElement
   * to know if user has tapped on the iframe since they won't be a trusted
   * event that would allow us to unmuted the video as only trusted
   * user-initiated events can be used to interact with the video.
   * @private
   * @return {!Element}
   */
  createAutoplayMask_() {
    const doc = this.ampdoc_.win.document;
    const mask = doc.createElement('i-amphtml-video-mask');
    mask.classList.add('i-amphtml-fill-content');
    return mask;
  }

  /**
   * Called by all possible events that might change the visibility of the video
   * such as scrolling or {@link ../video-interface.VideoEvents#VISIBILITY}.
   * @param {?boolean=} opt_forceVisible
   * @package
   */
  updateVisibility(opt_forceVisible) {
    const wasVisible = this.isVisible_;

    // Measure if video is now in viewport and what percentage of it is visible.
    const measure = () => {
      if (opt_forceVisible == true) {
        this.isVisible_ = true;
      } else {
        // Calculate what percentage of the video is in viewport.
        const change = this.video.element.getIntersectionChangeEntry();
        const visiblePercent = !isFiniteNumber(change.intersectionRatio) ? 0
          : change.intersectionRatio * 100;
        this.isVisible_ = visiblePercent >= VISIBILITY_PERCENT;
      }
    };

    // Mutate if visibility changed from previous state
    const mutate = () => {
      if (this.isVisible_ != wasVisible) {
        this.videoVisibilityChanged_();
      }
    };

    this.vsync_.run({
      measure,
      mutate,
    });
  }


  /**
   * Returns whether the video is paused or playing after the user interacted
   * with it or playing through autoplay
   * @return {!../video-interface.VideoInterface} PlayingStates
   */
  getPlayingState() {
    if (!this.isPlaying_) {
      return PlayingStates.PAUSED;
    }

    if (this.isPlaying_
       && this.playCalledByAutoplay_
       && !this.userInteractedWithAutoPlay_) {
      return PlayingStates.PLAYING_AUTO;
    }

    return PlayingStates.PLAYING_MANUAL;
  }

  /**
   * Returns whether the video was interacted with or not
   * @return {boolean}
   */
  userInteractedWithAutoPlay() {
    return this.userInteractedWithAutoPlay_;
  }


  /**
   * Collects a snapshot of the current video state for video analytics
   * @return {!Promise<!../video-interface.VideoAnalyticsDetailsDef>}
   */
  getAnalyticsDetails() {
    const video = this.video;
    return this.supportsAutoplay_().then(supportsAutoplay => {
      const {width, height} = this.video.element.getLayoutBox();
      const autoplay = this.hasAutoplay && supportsAutoplay;
      const playedRanges = video.getPlayedRanges();
      const playedTotal = playedRanges.reduce(
          (acc, range) => acc + range[1] - range[0], 0);

      return {
        'autoplay': autoplay,
        'currentTime': video.getCurrentTime(),
        'duration': video.getDuration(),
        // TODO(cvializ): add fullscreen
        'height': height,
        'id': video.element.id,
        'muted': this.muted_,
        'playedTotal': playedTotal,
        'playedRangesJson': JSON.stringify(playedRanges),
        'state': this.getPlayingState(),
        'width': width,
      };
    });
  }
}


/**
 * @struct @typedef {{
 *  entry: !VideoEntry,
 *  impl: !../video-interface.VideoInterface,
 * }}
 */
let Rot82xEntryDef;


/** Manages rotate-to-fullscreen video. */
class Rot82xManager {

  /** @param {!./ampdoc-impl.AmpDoc} ampdoc */
  constructor(ampdoc) {
    const {win} = ampdoc;

    /** @private @const {!./ampdoc-impl.AmpDoc} */
    this.ampdoc_ = ampdoc;

    /** @private {number} */
    this.nextId_ = 0;

    /** @private @const {!Window} */
    this.win_ = win;

    /** @private @const {!./timer-impl.Timer} */
    this.timer_ = Services.timerFor(win);

    /** @private {?Rot82xEntryDef} */
    this.currently_ = null;

    /**
     * Maps FOL id to entry.
     * @private @const {!Object<string, !Rot82xEntryDef>}
     */
    this.entries_ = {};

    /** @private @const {function()} */
    const installOrientationObserver =
        this.installOrientationObserver_.bind(this);
    this.installOrientationObserver_ = once(installOrientationObserver);

    /** @private @const {function():!IntersectionObserver} */
    const getIntersectionObserver = this.getIntersectionObserver_.bind(this);
    this.getIntersectionObserver_ =
      /** @type {function():!IntersectionObserver} */ (
        once(getIntersectionObserver));
  }

  /**
   * @param {!AmpElement} element
   * @param {!VideoEntry} entry
   */
  register(element, entry) {
    const id = this.nextId_++;

    element.setAttribute('data-amp-fol-id', id);

    element.getImpl().then(impl => {
      this.entries_[id.toString()] = {entry, impl};
    });

    // Wait until the video is "blessed" in order to have fullscreen access.
    element.signals().whenSignal(Signals.BLESSED).then(() => {
      this.installOrientationObserver_();
      this.getIntersectionObserver_().observe(element);
    });
  }

  /** @private */
  // Overridden in constructor
  installOrientationObserver_() {
    // TODO(alanorozco) Update based on support
    const win = this.win_;
    const screen = win.screen;
    // Chrome considers 'orientationchange' to be an untrusted event, but
    // 'change' on screen.orientation is considered a user interaction.
    // We still need to listen to 'orientationchange' on Chrome in order to
    // exit fullscreen since 'change' does not fire in this case.
    if (screen && 'orientation' in screen) {
      const orient = /** @type {!ScreenOrientation} */ (screen.orientation);
      listen(orient, 'change', () => this.onOrientationChange_());
    }
    // iOS Safari does not have screen.orientation but classifies
    // 'orientationchange' as a user interaction.
    listen(win, 'orientationchange', () => this.onOrientationChange_());
  }

  /** @private */
  onOrientationChange_() {
    if (!isLandscape(this.win_)) {
      const entries = this.getIntersectionObserver_().takeRecords();
      this.updatePortraitVisibility_(entries);
      if (this.currently_) {
        this.exit_(this.currently_);
      }
      return;
    }
    const root = this.ampdoc_.getRootNode();
    const centeredVideoSelector = `.i-amphtml-fol-centered.${BLESSED}`;
    const video = root.querySelector(centeredVideoSelector);
    if (!video) {
      return;
    }
    console.log('enter fullscreen', video);
    const id = this.getId_(video);
    this.enter_(dev().assert(this.entries_[id]));
  }

  /**
   * @param {!Rot82xEntryDef} folEntry
   * @private
   */
  enter_(folEntry) {
    const {impl, entry} = folEntry;

    if (entry.getPlayingState() == PlayingStates.PAUSED) {
      return;
    }

    const platform = Services.platformFor(this.win_);

    this.currently_ = folEntry;

    if (platform.isAndroid() && platform.isChrome()) {
      // Chrome on Android somehow knows what we're doing and executes a nice
      // transition by default. Delegating to browser.
      impl.fullscreenEnter();
      return;
    }

    const {video} = entry;
    this.maybeScrollTo_(video).then(() => impl.fullscreenEnter());
  }

  /**
   * @param {!Rot82xEntryDef} folEntry
   * @private
   */
  exit_(folEntry) {
    this.currently_ = null;

    const {entry, impl} = folEntry;
    const {video} = entry;

    this.maybeScrollTo_(video).then(() => impl.fullscreenExit());
  }

  /**
   * Scrolls to a video if it's not in view.
   * @param {!../video-interface.VideoInterface} impl
   * @private
   */
  maybeScrollTo_(impl) {
    const {element} = impl;
    let stillInView = false;
    return this.onceOrientationChanges_().then(() =>
      (/** @type {!../base-element.BaseElement} */ (impl))
          .measureMutateElement(() => {
            const {top, bottom} = element.getBoundingClientRect();
            // TODO(alanorozco): Use viewport service
            stillInView = top >= 0 && bottom <= this.win_.innerHeight;
          }, () => {
            if (!stillInView) {
              return this.scrollTo_(element);
            }
          }));
  }

  scrollTo_(element) {
    const pxPerFrame = 24;
    const timeout = 1000;

    const viewport = Services.viewportForDoc(this.ampdoc_);
    const rect = element.getBoundingClientRect();
    const vh = viewport.getSize().height;
    const scrollY = viewport.getScrollTop();
    const top = scrollY + rect.top;
    const {height} = rect;

    const y = top - (vh / 2 - height / 2);

    const delta = Math.abs(scrollY - y);

    const frames = Math.min(Math.floor(delta / pxPerFrame));
    const direction = y < scrollY ? -1 : 1;

    const scrollPromise = new Promise(resolve => {
      let nextY = scrollY + direction * pxPerFrame;
      let curFrame = 0;

      const scroll = () => {
        const shouldStop =
            curFrame++ >= frames ||
            direction > 0 && nextY >= y ||
            direction < 0 && nextY <= y;

        if (shouldStop) {
          const magicNumber = 200;
          this.win_.scrollTo(0, y);
          this.timer_.delay(resolve, magicNumber);
          return;
        }

        this.win_.scrollTo(0, nextY);
        nextY += direction * pxPerFrame;
        requestAnimationFrame(scroll);
      };
      scroll();
    });

    return this.timer_.timeoutPromise(timeout, /* race */ scrollPromise);
  }

  /** @private @return {!Promise} */
  onceOrientationChanges_() {
    const magicNumber = 330;
    return this.timer_.promise(magicNumber);
  }

  /** @private @return {!IntersectionObserver} */
  // Overridden in constructor
  getIntersectionObserver_() {
    maybeInstallIntersectionObserver(this.win_, this.ampdoc_.getRootNode());

    const threshold = [0, 0.1, 0.2, 0.3, 0.7, 0.8, 0.9, 1];
    const rootMargin = '0px 0px 25% 0px';

    return new IntersectionObserver(
        entries => this.onIntersectionChange_(entries),
        {threshold, rootMargin});
  }

  /**
   * @param {!Array<!IntersectionObserverEntry>} intersectionEntries
   * @private
   */
  onIntersectionChange_(intersectionEntries) {
    if (!isLandscape(this.win_)) {
      this.updatePortraitVisibility_(intersectionEntries);
    }
  }

  /**
   * @param {!Array<!IntersectionObserverEntry>} intersectionEntries
   * @private
   */
  updatePortraitVisibility_(intersectionEntries) {
    intersectionEntries
        .sort((a, b) => this.compareIntersectionEntries_(a, b))
        .forEach((entry, i) => {
          // Best centered element that is fully in-view is be considered
          // in range.
          const inRange = entry.intersectionRatio >= 1 && i == 0;
          entry.target.classList.toggle('i-amphtml-fol-centered', inRange);
        });
  }

  /**
   * Compares two intersection entries in order to sort them by "best centered".
   * @param {!IntersectionObserverEntry} a
   * @param {!IntersectionObserverEntry} b
   * @return {number}
   */
  compareIntersectionEntries_(a, b) {
    if (a.intersectionRatio > b.intersectionRatio) {
      return -1;
    }
    if (a.intersectionRatio < b.intersectionRatio) {
      return 1;
    }

    const viewport = Services.viewportForDoc(this.ampdoc_);
    const aCenter = centerDist(viewport, a.boundingClientRect);
    const bCenter = centerDist(viewport, b.boundingClientRect);

    if (aCenter > bCenter) {
      return -1;
    }
    if (aCenter < bCenter) {
      return 1;
    }

    if (a.boundingClientRect.top < b.boundingClientRect.top) {
      return -1;
    }
    if (a.boundingClientRect.top > b.boundingClientRect.top) {
      return 1;
    }

    return 0;
  }

  /**
   * @return {string}
   * @private
   */
  getId_(element) {
    return dev().assertString(element.getAttribute('data-amp-fol-id'));
  }
}


/**
 * @param {!./viewport/viewport-impl.Viewport} viewport
 * @param {{top: number, height: number}} rect
 * @return {number}
 */
function centerDist(viewport, rect) {
  const centerY = rect.top + rect.height / 2;
  const centerViewport = viewport.getSize().height / 2;
  return Math.abs(centerY - centerViewport);
}


/**
 * @param {!Window} win
 * @return {boolean}
 */
function isLandscape(win) {
  if (win.screen && 'orientation' in win.screen) {
    return startsWith(screen.orientation.type, 'landscape');
  }
  return Math.abs(win.orientation) == 90;
}


/**
 * @param {!VideoEntry} entry
 * @param {!VideoAnalyticsEvents} eventType
 * @param {!Object<string, string>=} opt_vars A map of vars and their values.
 * @private
 */
function analyticsEvent(entry, eventType, opt_vars) {
  const video = entry.video;
  const detailsPromise = opt_vars ? Promise.resolve(opt_vars) :
    entry.getAnalyticsDetails();

  detailsPromise.then(details => {
    video.element.dispatchCustomEvent(
        eventType, details);
  });
}


/** @param {!Node|!./ampdoc-impl.AmpDoc} nodeOrDoc */
// TODO(alanorozco, #13674): Rename to `installVideoServiceForDoc`
export function installVideoManagerForDoc(nodeOrDoc) {
  // TODO(alanorozco, #13674): Rename to `video-service`
  registerServiceBuilderForDoc(nodeOrDoc, 'video-manager', ampdoc => {
    const {win} = ampdoc;
    if (VideoServiceSync.shouldBeUsedIn(win)) {
      return new VideoServiceSync(ampdoc);
    }
    return new VideoManager(ampdoc);
  });
}


